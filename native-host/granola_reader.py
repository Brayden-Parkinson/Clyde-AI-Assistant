#!/opt/homebrew/bin/python3
"""
Chrome Native Messaging host that reads Granola meetings via the
Granola cloud API (with local cache-v4.json as fallback) and manages
extension backup state on disk.

Communicates via length-prefixed JSON on stdin/stdout.

Commands:
  ping           - Health check, returns whether Granola API is reachable
  list_meetings  - List meetings, optionally filtered by 'since' (ISO 8601)
  get_transcript - Get transcript for a meeting by 'meeting_id'
  save_state     - Persist extension state to ~/.commitment-tracker/backup-{ext_id}.json
  load_state     - Load persisted extension state from disk
"""

import gzip
import json
import os
import platform
import struct
import sys
import tempfile
import time
from datetime import datetime, timezone


def _parse_dt(s: str) -> datetime:
    """Parse ISO datetime, ensuring timezone-aware (defaults to UTC)."""
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Maximum message size for Chrome Native Messaging (1 MB)
MAX_MESSAGE_BYTES = 1024 * 1024

# Granola cloud API
GRANOLA_API_BASE = "https://api.granola.ai/v1"
GRANOLA_CLIENT_VERSION = "7.54.0"

# Granola local paths — cross-platform
if platform.system() == "Darwin":
    GRANOLA_DIR = Path.home() / "Library" / "Application Support" / "Granola"
elif platform.system() == "Windows":
    GRANOLA_DIR = Path(os.environ.get("APPDATA", "")) / "Granola"
else:  # Linux
    GRANOLA_DIR = Path.home() / ".config" / "Granola"

CACHE_CANDIDATES = ["cache-v6.json", "cache-v5.json", "cache-v4.json", "cache-v3.json"]
SUPABASE_PATH = GRANOLA_DIR / "supabase.json"
ACCOUNTS_PATH = GRANOLA_DIR / "stored-accounts.json"

# Token expiry buffer — refresh 5 minutes before actual expiry
TOKEN_EXPIRY_BUFFER_S = 300


# ─── Auth Token Management ───


def _read_supabase_tokens() -> dict:
    """Read the full WorkOS token dict from supabase.json."""
    try:
        if SUPABASE_PATH.exists():
            with open(SUPABASE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            workos = data.get("workos_tokens", "{}")
            if isinstance(workos, str):
                workos = json.loads(workos)
            if isinstance(workos, dict) and workos.get("access_token"):
                return workos
    except (json.JSONDecodeError, IOError, KeyError):
        pass
    return {}


def _save_supabase_tokens(tokens: dict) -> None:
    """Persist updated tokens back to supabase.json (atomic write)."""
    try:
        existing = {}
        if SUPABASE_PATH.exists():
            with open(SUPABASE_PATH, "r", encoding="utf-8") as f:
                existing = json.load(f)

        existing["workos_tokens"] = json.dumps(tokens)

        fd, tmp = tempfile.mkstemp(
            dir=str(SUPABASE_PATH.parent), suffix=".tmp", prefix="supabase-"
        )
        try:
            os.write(fd, json.dumps(existing).encode("utf-8"))
            os.close(fd)
            os.replace(tmp, str(SUPABASE_PATH))
        except Exception:
            try:
                os.close(fd)
            except OSError:
                pass
            if os.path.exists(tmp):
                os.unlink(tmp)
    except (IOError, json.JSONDecodeError):
        pass


def _is_token_expired(tokens: dict) -> bool:
    """Check if the access token has expired (or will expire within the buffer)."""
    obtained_ms = tokens.get("obtained_at", 0)
    expires_in_s = tokens.get("expires_in", 0)
    if not obtained_ms or not expires_in_s:
        return False  # Can't determine — assume valid
    expires_at_s = (obtained_ms / 1000) + expires_in_s
    return time.time() > (expires_at_s - TOKEN_EXPIRY_BUFFER_S)


def _refresh_token(tokens: dict) -> dict | None:
    """Attempt to refresh the access token via Granola's API.
    Returns updated token dict or None on failure."""
    refresh_tok = tokens.get("refresh_token")
    if not refresh_tok:
        return None

    payload = json.dumps({"refresh_token": refresh_tok}).encode("utf-8")
    req = Request(
        f"{GRANOLA_API_BASE}/refresh-access-token",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Client-Version": GRANOLA_CLIENT_VERSION,
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=10) as resp:
            raw = resp.read()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            new_tokens = json.loads(raw.decode("utf-8"))
            if isinstance(new_tokens, dict) and new_tokens.get("access_token"):
                new_tokens["obtained_at"] = int(time.time() * 1000)
                # Preserve fields not returned by refresh
                for key in ("session_id", "external_id", "sign_in_method"):
                    if key not in new_tokens and key in tokens:
                        new_tokens[key] = tokens[key]
                _save_supabase_tokens(new_tokens)
                return new_tokens
    except (HTTPError, URLError, json.JSONDecodeError, OSError):
        pass

    return None


def get_access_token() -> str | None:
    """Get a valid Granola access token, refreshing if expired."""
    tokens = _read_supabase_tokens()
    if tokens:
        if _is_token_expired(tokens):
            refreshed = _refresh_token(tokens)
            if refreshed:
                return refreshed["access_token"]
            # Token expired and refresh failed — still try the old token
            # (Granola's app may have refreshed it since we read the file)
        return tokens.get("access_token")

    # Fallback: stored-accounts.json
    try:
        if ACCOUNTS_PATH.exists():
            with open(ACCOUNTS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            accounts_raw = data.get("accounts", "[]")
            if isinstance(accounts_raw, str):
                accounts_raw = json.loads(accounts_raw)
            if isinstance(accounts_raw, list) and accounts_raw:
                acct_tokens = accounts_raw[0].get("tokens", {})
                if isinstance(acct_tokens, str):
                    acct_tokens = json.loads(acct_tokens)
                return acct_tokens.get("access_token") or acct_tokens.get("accessToken")
    except (json.JSONDecodeError, IOError, KeyError):
        pass

    return None


# ─── Granola API Client ───


def _raw_api_request(
    endpoint: str,
    token: str,
    body: dict | None = None,
    timeout: int = 15,
) -> tuple[int, str]:
    """Low-level API call. Returns (status_code, response_text).
    Raises on network errors."""
    url = f"{GRANOLA_API_BASE}/{endpoint}"
    payload = json.dumps(body or {}).encode("utf-8")

    req = Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Client-Version": GRANOLA_CLIENT_VERSION,
            "Accept-Encoding": "gzip",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            return (resp.status, raw.decode("utf-8"))
    except HTTPError as e:
        body_text = ""
        try:
            raw = e.read()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            body_text = raw.decode("utf-8")
        except Exception:
            pass
        return (e.code, body_text)


def api_request(
    endpoint: str,
    body: dict | None = None,
    timeout: int = 15,
) -> dict | list | str | None:
    """Make an authenticated POST request to the Granola API.
    Handles 401 by refreshing the token and retrying once.
    Returns parsed JSON (or raw text), or None on failure."""
    token = get_access_token()
    if not token:
        return None

    try:
        status, text = _raw_api_request(endpoint, token, body, timeout)
    except (URLError, OSError):
        return None

    # On 401, try refreshing the token and retry once
    if status == 401:
        tokens = _read_supabase_tokens()
        refreshed = _refresh_token(tokens) if tokens else None
        if refreshed:
            try:
                status, text = _raw_api_request(
                    endpoint, refreshed["access_token"], body, timeout
                )
            except (URLError, OSError):
                return None

    # On 5xx, retry once after a short delay
    if status >= 500:
        time.sleep(1)
        try:
            status, text = _raw_api_request(endpoint, token, body, timeout)
        except (URLError, OSError):
            return None

    if status < 200 or status >= 300:
        return None

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text  # Some endpoints return plain text


# ─── Local Cache Fallback ───


def find_cache_file() -> Path | None:
    """Find the first existing Granola cache file."""
    for name in CACHE_CANDIDATES:
        path = GRANOLA_DIR / name
        if path.exists():
            return path
    return None


def load_cache() -> dict:
    """Load and parse the Granola cache file."""
    path = find_cache_file()
    if not path:
        raise FileNotFoundError(
            f"No Granola cache found in {GRANOLA_DIR}. "
            f"Tried: {', '.join(CACHE_CANDIDATES)}"
        )
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_state(cache: dict) -> dict:
    if "cache" in cache and isinstance(cache["cache"], dict):
        inner = cache["cache"]
        if "state" in inner:
            return inner["state"]
    if "state" in cache:
        return cache["state"]
    return cache


def extract_documents(cache: dict) -> dict:
    state = get_state(cache)
    return state.get("documents", state.get("docs", {}))


def extract_transcripts(cache: dict) -> dict:
    state = get_state(cache)
    return state.get("transcripts", {})


def extract_transcript_text(transcript_data) -> str | None:
    if isinstance(transcript_data, str):
        return transcript_data
    if isinstance(transcript_data, list):
        segments = []
        for seg in transcript_data:
            if isinstance(seg, dict) and seg.get("text"):
                segments.append(seg["text"])
            elif isinstance(seg, str):
                segments.append(seg)
        return " ".join(segments) if segments else None
    if isinstance(transcript_data, dict):
        return (
            transcript_data.get("text")
            or transcript_data.get("content")
            or transcript_data.get("transcript")
        )
    return None


def extract_doc_text(doc: dict) -> str | None:
    for field in ("notes_plain", "notes_markdown", "summary", "overview"):
        val = doc.get(field)
        if val and isinstance(val, str) and val.strip():
            return val
    notes = doc.get("notes")
    if isinstance(notes, str) and notes.strip():
        return notes
    return None


def extract_people(doc: dict) -> tuple[str, list[str]]:
    """Extract creator name and attendee names from a document."""
    creator_name = ""
    attendee_names = []

    people = doc.get("people", {})
    if isinstance(people, str):
        try:
            people = json.loads(people)
        except json.JSONDecodeError:
            return creator_name, attendee_names
    if not isinstance(people, dict):
        return creator_name, attendee_names

    # Creator
    creator_info = people.get("creator", {})
    if isinstance(creator_info, dict):
        creator_name = creator_info.get("name", "")
        if not creator_name:
            details = creator_info.get("details", {})
            if isinstance(details, dict):
                person = details.get("person", {})
                if isinstance(person, dict):
                    name_obj = person.get("name", {})
                    if isinstance(name_obj, dict):
                        creator_name = name_obj.get("fullName", "")

    # Attendees
    attendees_raw = people.get("attendees", [])
    if isinstance(attendees_raw, list):
        for a in attendees_raw:
            if isinstance(a, dict):
                details = a.get("details", {})
                person = details.get("person", {}) if isinstance(details, dict) else {}
                name_obj = person.get("name", {}) if isinstance(person, dict) else {}
                full_name = name_obj.get("fullName", "") if isinstance(name_obj, dict) else ""
                if full_name:
                    attendee_names.append(full_name)
                else:
                    email = a.get("email", "")
                    if email:
                        attendee_names.append(email)
            elif isinstance(a, str):
                attendee_names.append(a)

    # Fallback: google calendar attendees
    if not attendee_names:
        gcal = doc.get("google_calendar_event", {})
        if isinstance(gcal, dict):
            for att in gcal.get("attendees", []):
                if isinstance(att, dict):
                    email = att.get("email", "")
                    if email:
                        attendee_names.append(email)

    return creator_name, attendee_names


# ─── Chrome Native Messaging Protocol ───


def read_message() -> dict:
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) != 4:
        sys.exit(0)
    length = struct.unpack("=I", raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(msg: dict) -> None:
    encoded = json.dumps(msg, default=str).encode("utf-8")
    if len(encoded) > MAX_MESSAGE_BYTES - 100:
        msg["truncated"] = True
        for key in ("transcript", "meetings"):
            if key in msg and isinstance(msg[key], (str, list)):
                if isinstance(msg[key], str):
                    msg[key] = msg[key][: MAX_MESSAGE_BYTES // 2] + "...[truncated]"
                elif isinstance(msg[key], list):
                    msg[key] = msg[key][:50]
        encoded = json.dumps(msg, default=str).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


# ─── Command Handlers ───


def handle_ping() -> dict:
    """Health check — try API first, fall back to cache file."""
    token = get_access_token()
    if token:
        # Quick API check
        result = api_request("hello", timeout=5)
        if result is not None:
            return {
                "ok": True,
                "source": "api",
                "api_reachable": True,
                "has_token": True,
            }

    # Fallback: cache file
    path = find_cache_file()
    if path:
        stat = path.stat()
        return {
            "ok": True,
            "source": "cache",
            "cache_file": str(path),
            "cache_size_mb": round(stat.st_size / (1024 * 1024), 2),
            "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "api_reachable": False,
            "has_token": token is not None,
        }

    return {
        "ok": token is not None,
        "error": "No Granola API token or cache file found" if not token else "API unreachable, no cache file",
        "api_reachable": False,
        "has_token": token is not None,
    }


def handle_list_meetings(since: str | None = None) -> dict:
    """List meetings — API first, cache fallback."""
    since_dt = None
    if since:
        try:
            since_dt = _parse_dt(since)
        except ValueError:
            pass

    # ── Try API ──
    api_docs = api_request("get-documents", {}, timeout=15)
    if api_docs is not None and isinstance(api_docs, list):
        meetings = []
        for doc in api_docs:
            if not isinstance(doc, dict):
                continue

            date_str = doc.get("created_at") or doc.get("updated_at") or ""
            if since_dt and date_str:
                try:
                    doc_dt = _parse_dt(date_str)
                    if doc_dt < since_dt:
                        continue
                except ValueError:
                    pass

            creator, attendees = extract_people(doc)
            summary = doc.get("notes_plain") or doc.get("summary") or doc.get("overview") or ""

            meetings.append({
                "id": str(doc.get("id", "")),
                "title": doc.get("title", "Untitled Meeting"),
                "date": date_str,
                "creator": creator,
                "attendees": attendees,
                "has_transcript": bool(doc.get("transcribe") or doc.get("valid_meeting")),
                "summary": summary if isinstance(summary, str) else "",
            })

        meetings.sort(key=lambda m: m["date"] or "", reverse=True)
        return {"ok": True, "source": "api", "meetings": meetings}

    # ── Fallback: local cache ──
    try:
        cache = load_cache()
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e), "meetings": []}

    documents = extract_documents(cache)
    transcripts = extract_transcripts(cache)
    meetings = []

    for doc_id, doc in documents.items():
        if not isinstance(doc, dict):
            continue

        date_str = (
            doc.get("created_at")
            or doc.get("date")
            or doc.get("start_time")
            or doc.get("updated_at")
            or ""
        )

        if since_dt and date_str:
            try:
                doc_dt = _parse_dt(date_str)
                if doc_dt < since_dt:
                    continue
            except ValueError:
                pass

        creator, attendees = extract_people(doc)

        meetings.append({
            "id": str(doc_id),
            "title": doc.get("title", "Untitled Meeting"),
            "date": date_str,
            "creator": creator,
            "attendees": attendees,
            "has_transcript": str(doc_id) in transcripts,
            "summary": extract_doc_text(doc) or "",
        })

    meetings.sort(key=lambda m: m["date"] or "", reverse=True)
    return {"ok": True, "source": "cache", "meetings": meetings}


_cached_api_docs: list | None = None


def _get_api_docs() -> list:
    """Fetch and cache the documents list for the lifetime of this process."""
    global _cached_api_docs
    if _cached_api_docs is None:
        result = api_request("get-documents", {}, timeout=15)
        _cached_api_docs = result if isinstance(result, list) else []
    return _cached_api_docs


def _find_api_doc(meeting_id: str) -> dict | None:
    """Find a document by ID in the cached API documents list."""
    for doc in _get_api_docs():
        if isinstance(doc, dict) and doc.get("id") == meeting_id:
            return doc
    return None


def handle_get_transcript(meeting_id: str) -> dict:
    """Get transcript for a meeting — API first, cache fallback."""
    if not meeting_id:
        return {"ok": False, "error": "meeting_id is required", "transcript": None}

    # ── Try API ──
    api_result = api_request(
        "get-document-transcript",
        {"document_id": meeting_id},
        timeout=20,
    )

    if api_result is not None:
        segments = []
        if isinstance(api_result, list):
            for chunk in api_result:
                if isinstance(chunk, dict) and chunk.get("text"):
                    segments.append({
                        "text": chunk["text"],
                        "source": chunk.get("source", ""),
                        "start": chunk.get("start_timestamp"),
                    })

        if segments:
            creator = ""
            attendees = []
            doc = _find_api_doc(meeting_id)
            if doc:
                creator, attendees = extract_people(doc)

            flat_text = " ".join(s["text"] for s in segments)
            return {
                "ok": True,
                "source": "api",
                "segments": segments,
                "creator": creator,
                "attendees": attendees,
                "transcript": flat_text,
            }

    # ── Fallback: local cache ──
    try:
        cache = load_cache()
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e), "transcript": None}

    transcripts = extract_transcripts(cache)
    documents = extract_documents(cache)
    doc = documents.get(meeting_id, {})
    creator, attendees = extract_people(doc) if isinstance(doc, dict) else ("", [])

    transcript_data = transcripts.get(meeting_id)
    if transcript_data:
        if isinstance(transcript_data, list):
            segments = []
            for seg in transcript_data:
                if isinstance(seg, dict) and seg.get("text"):
                    segments.append({
                        "text": seg["text"],
                        "source": seg.get("source", ""),
                        "start": seg.get("start", None),
                    })
                elif isinstance(seg, str):
                    segments.append({"text": seg, "source": "", "start": None})
            if segments:
                flat_text = extract_transcript_text(transcript_data)
                return {
                    "ok": True,
                    "source": "cache",
                    "segments": segments,
                    "creator": creator,
                    "attendees": attendees,
                    "transcript": flat_text or "",
                }

        text = extract_transcript_text(transcript_data)
        if text:
            return {
                "ok": True,
                "source": "cache",
                "segments": [],
                "creator": creator,
                "attendees": attendees,
                "transcript": text,
            }

    # Fallback: document text
    if isinstance(doc, dict):
        text = extract_doc_text(doc)
        if text:
            return {
                "ok": True,
                "source": "cache",
                "segments": [],
                "creator": creator,
                "attendees": attendees,
                "transcript": text,
            }

    return {
        "ok": True,
        "segments": [],
        "creator": creator,
        "attendees": attendees,
        "transcript": None,
    }


# ─── Voice Inbox ───

INBOX_PATH = Path.home() / "Documents" / "clyde-inbox.txt"


def handle_read_inbox() -> dict:
    if not INBOX_PATH.exists():
        return {"ok": True, "lines": []}
    try:
        text = INBOX_PATH.read_text(encoding="utf-8").strip()
        if not text:
            return {"ok": True, "lines": []}
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        return {"ok": True, "lines": lines}
    except Exception as e:
        return {"ok": False, "error": f"Failed to read inbox: {e}", "lines": []}


def handle_clear_inbox() -> dict:
    try:
        if INBOX_PATH.exists():
            INBOX_PATH.write_text("", encoding="utf-8")
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": f"Failed to clear inbox: {e}"}


# ─── Backup State Management ───

BACKUP_DIR = Path.home() / ".commitment-tracker"


def get_backup_path(extension_id: str) -> Path:
    safe_id = "".join(c for c in extension_id if c.isalnum())
    return BACKUP_DIR / f"backup-{safe_id}.json"


def handle_save_state(state: dict, extension_id: str) -> dict:
    if not extension_id:
        return {"ok": False, "error": "extension_id is required"}

    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        backup_path = get_backup_path(extension_id)

        encoded = json.dumps(state, default=str).encode("utf-8")
        size_kb = len(encoded) / 1024

        fd, tmp_path = tempfile.mkstemp(
            dir=str(BACKUP_DIR), suffix=".tmp", prefix="backup-"
        )
        try:
            os.write(fd, encoded)
            os.close(fd)
            os.replace(tmp_path, str(backup_path))
        except Exception:
            os.close(fd) if not os.get_inheritable(fd) else None
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

        return {"ok": True, "size_kb": round(size_kb, 1), "path": str(backup_path)}
    except Exception as e:
        return {"ok": False, "error": f"Failed to save state: {e}"}


def handle_load_state(extension_id: str) -> dict:
    if not extension_id:
        return {"ok": False, "error": "extension_id is required", "state": None}

    backup_path = get_backup_path(extension_id)
    if not backup_path.exists():
        return {"ok": True, "state": None}

    try:
        with open(backup_path, "r", encoding="utf-8") as f:
            state = json.load(f)
        return {"ok": True, "state": state}
    except (json.JSONDecodeError, IOError) as e:
        return {"ok": False, "error": f"Failed to load state: {e}", "state": None}


def handle_load_latest_state() -> dict:
    if not BACKUP_DIR.exists():
        return {"ok": True, "state": None}

    backups = sorted(
        BACKUP_DIR.glob("backup-*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not backups:
        return {"ok": True, "state": None}

    try:
        with open(backups[0], "r", encoding="utf-8") as f:
            state = json.load(f)
        return {"ok": True, "state": state, "source": backups[0].name}
    except (json.JSONDecodeError, IOError) as e:
        return {"ok": False, "error": f"Failed to load latest state: {e}", "state": None}


# ─── Main ───


def main():
    try:
        msg = read_message()
    except Exception as e:
        send_message({"ok": False, "error": f"Failed to read message: {e}"})
        return

    command = msg.get("command", "")

    try:
        if command == "ping":
            result = handle_ping()
        elif command == "list_meetings":
            result = handle_list_meetings(since=msg.get("since"))
        elif command == "get_transcript":
            result = handle_get_transcript(meeting_id=msg.get("meeting_id", ""))
        elif command == "save_state":
            result = handle_save_state(
                state=msg.get("state", {}),
                extension_id=msg.get("extension_id", ""),
            )
        elif command == "load_state":
            result = handle_load_state(
                extension_id=msg.get("extension_id", ""),
            )
        elif command == "load_latest_state":
            result = handle_load_latest_state()
        elif command == "read_inbox":
            result = handle_read_inbox()
        elif command == "clear_inbox":
            result = handle_clear_inbox()
        else:
            result = {"ok": False, "error": f"Unknown command: {command}"}
    except Exception as e:
        result = {"ok": False, "error": f"Internal error: {e}"}

    send_message(result)


if __name__ == "__main__":
    main()
