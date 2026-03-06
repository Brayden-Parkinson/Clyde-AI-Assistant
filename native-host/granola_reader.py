#!/opt/homebrew/bin/python3
"""
Chrome Native Messaging host that reads Granola's local cache file
and manages extension backup state on disk.
Communicates via length-prefixed JSON on stdin/stdout.

Commands:
  ping           - Health check, returns whether cache file exists
  list_meetings  - List meetings, optionally filtered by 'since' (ISO 8601)
  get_transcript - Get transcript for a meeting by 'meeting_id'
  save_state     - Persist extension state to ~/.commitment-tracker/backup-{ext_id}.json
  load_state     - Load persisted extension state from disk
"""

import json
import os
import struct
import sys
import tempfile
from datetime import datetime
from pathlib import Path

# Maximum message size for Chrome Native Messaging (1 MB)
MAX_MESSAGE_BYTES = 1024 * 1024

# Granola cache file candidates (try in order)
CACHE_DIR = Path.home() / "Library" / "Application Support" / "Granola"
CACHE_CANDIDATES = ["cache-v4.json", "cache-v3.json", "cache-v5.json"]


def find_cache_file() -> Path | None:
    """Find the first existing Granola cache file."""
    for name in CACHE_CANDIDATES:
        path = CACHE_DIR / name
        if path.exists():
            return path
    return None


def read_message() -> dict:
    """Read a length-prefixed JSON message from stdin."""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) != 4:
        sys.exit(0)
    length = struct.unpack("=I", raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(msg: dict) -> None:
    """Write a length-prefixed JSON message to stdout."""
    encoded = json.dumps(msg, default=str).encode("utf-8")
    # Truncate if over the limit (leave room for wrapper)
    if len(encoded) > MAX_MESSAGE_BYTES - 100:
        msg["truncated"] = True
        # Try to reduce by trimming large text fields
        for key in ("transcript", "meetings"):
            if key in msg and isinstance(msg[key], (str, list)):
                if isinstance(msg[key], str):
                    msg[key] = msg[key][: MAX_MESSAGE_BYTES // 2] + "...[truncated]"
                elif isinstance(msg[key], list):
                    msg[key] = msg[key][:50]  # Keep first 50 items
        encoded = json.dumps(msg, default=str).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def load_cache() -> dict:
    """Load and parse the Granola cache file."""
    path = find_cache_file()
    if not path:
        raise FileNotFoundError(
            f"No Granola cache found in {CACHE_DIR}. "
            f"Tried: {', '.join(CACHE_CANDIDATES)}"
        )
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_state(cache: dict) -> dict:
    """Navigate to the state object, handling cache.cache.state or cache.state."""
    if "cache" in cache and isinstance(cache["cache"], dict):
        inner = cache["cache"]
        if "state" in inner:
            return inner["state"]
    if "state" in cache:
        return cache["state"]
    return cache


def extract_documents(cache: dict) -> dict:
    """Extract the documents map from the cache. Handles nested structures."""
    state = get_state(cache)
    return state.get("documents", state.get("docs", {}))


def extract_transcripts(cache: dict) -> dict:
    """Extract the transcripts map from the cache."""
    state = get_state(cache)
    return state.get("transcripts", {})


def extract_transcript_text(transcript_data) -> str | None:
    """Extract plain text from a transcript, handling various formats."""
    if isinstance(transcript_data, str):
        return transcript_data
    if isinstance(transcript_data, list):
        # List of segment objects with 'text' fields
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
    """Extract readable text from a document, trying multiple fields."""
    for field in ("notes_plain", "notes_markdown", "summary", "overview"):
        val = doc.get(field)
        if val and isinstance(val, str) and val.strip():
            return val
    notes = doc.get("notes")
    if isinstance(notes, str) and notes.strip():
        return notes
    return None


def handle_ping() -> dict:
    """Health check — report whether cache file exists and its path."""
    path = find_cache_file()
    if path:
        stat = path.stat()
        return {
            "ok": True,
            "cache_file": str(path),
            "cache_size_mb": round(stat.st_size / (1024 * 1024), 2),
            "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        }
    return {
        "ok": False,
        "error": f"No cache file found in {CACHE_DIR}",
    }


def handle_list_meetings(since: str | None = None) -> dict:
    """List meetings, optionally filtered to those after 'since' timestamp."""
    try:
        cache = load_cache()
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e), "meetings": []}

    documents = extract_documents(cache)
    transcripts = extract_transcripts(cache)
    meetings = []

    since_dt = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            pass

    for doc_id, doc in documents.items():
        if not isinstance(doc, dict):
            continue

        # Extract meeting date — try multiple field names
        date_str = (
            doc.get("created_at")
            or doc.get("date")
            or doc.get("start_time")
            or doc.get("updated_at")
            or ""
        )

        # Apply 'since' filter
        if since_dt and date_str:
            try:
                doc_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if doc_dt < since_dt:
                    continue
            except ValueError:
                pass

        # Extract attendees and creator from doc["people"]
        people = doc.get("people", {})
        creator_info = people.get("creator", {})
        creator = creator_info.get("name", "") if isinstance(creator_info, dict) else ""

        attendees = []
        attendees_raw = people.get("attendees", [])
        if isinstance(attendees_raw, list):
            for a in attendees_raw:
                if isinstance(a, dict):
                    # Nested: details.person.name.fullName
                    details = a.get("details", {})
                    person = details.get("person", {}) if isinstance(details, dict) else {}
                    name_obj = person.get("name", {}) if isinstance(person, dict) else {}
                    full_name = name_obj.get("fullName", "") if isinstance(name_obj, dict) else ""
                    if full_name:
                        attendees.append(full_name)
                    else:
                        # Fallback to email
                        attendees.append(a.get("email", str(a)))
                elif isinstance(a, str):
                    attendees.append(a)

        meetings.append({
            "id": str(doc_id),
            "title": doc.get("title", "Untitled Meeting"),
            "date": date_str,
            "creator": creator,
            "attendees": attendees,
            "has_transcript": str(doc_id) in transcripts,
            "summary": extract_doc_text(doc) or "",
        })

    # Sort by date descending (most recent first)
    meetings.sort(key=lambda m: m["date"] or "", reverse=True)

    return {"ok": True, "meetings": meetings}


def handle_get_transcript(meeting_id: str) -> dict:
    """Get the full transcript for a specific meeting, with structured segments."""
    if not meeting_id:
        return {"ok": False, "error": "meeting_id is required", "transcript": None}

    try:
        cache = load_cache()
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e), "transcript": None}

    transcripts = extract_transcripts(cache)
    documents = extract_documents(cache)
    doc = documents.get(meeting_id, {})

    # Extract attendee info from doc["people"]
    creator_name = ""
    attendee_names = []
    if isinstance(doc, dict):
        people = doc.get("people", {})
        creator_info = people.get("creator", {})
        creator_name = creator_info.get("name", "") if isinstance(creator_info, dict) else ""

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
                        attendee_names.append(a.get("email", str(a)))
                elif isinstance(a, str):
                    attendee_names.append(a)

    # Try direct transcript lookup by ID
    transcript_data = transcripts.get(meeting_id)
    if transcript_data:
        # Build structured segments if transcript_data is a list of segment dicts
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
                    "segments": segments,
                    "creator": creator_name,
                    "attendees": attendee_names,
                    "transcript": flat_text or "",
                }

        # Non-list transcript data — use flat text fallback
        text = extract_transcript_text(transcript_data)
        if text:
            return {
                "ok": True,
                "segments": [],
                "creator": creator_name,
                "attendees": attendee_names,
                "transcript": text,
            }

    # Fallback: check if document itself has readable text
    if isinstance(doc, dict):
        text = extract_doc_text(doc)
        if text:
            return {
                "ok": True,
                "segments": [],
                "creator": creator_name,
                "attendees": attendee_names,
                "transcript": text,
            }

    return {
        "ok": True,
        "segments": [],
        "creator": creator_name,
        "attendees": attendee_names,
        "transcript": None,
    }


# ─── Voice Inbox ───

INBOX_PATH = Path.home() / "Documents" / "clyde-inbox.txt"


def handle_read_inbox() -> dict:
    """Read pending voice tasks from the inbox file."""
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
    """Clear the inbox file after processing."""
    try:
        if INBOX_PATH.exists():
            INBOX_PATH.write_text("", encoding="utf-8")
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": f"Failed to clear inbox: {e}"}


BACKUP_DIR = Path.home() / ".commitment-tracker"


def get_backup_path(extension_id: str) -> Path:
    """Get the backup file path for a given extension ID."""
    # Sanitize extension_id to prevent directory traversal
    safe_id = "".join(c for c in extension_id if c.isalnum())
    return BACKUP_DIR / f"backup-{safe_id}.json"


def handle_save_state(state: dict, extension_id: str) -> dict:
    """Atomically write extension state to disk (tmp + rename)."""
    if not extension_id:
        return {"ok": False, "error": "extension_id is required"}

    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        backup_path = get_backup_path(extension_id)

        encoded = json.dumps(state, default=str).encode("utf-8")
        size_kb = len(encoded) / 1024

        # Atomic write: write to temp file, then rename
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
    """Read persisted extension state from disk."""
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


def main():
    """Read one command from stdin, process it, write response, exit."""
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
