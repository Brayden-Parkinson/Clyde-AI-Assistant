"""Smoke tests for the new clyde-CLI handlers in granola_reader.py.

Runs the host as a subprocess against a fixture BACKUP_DIR so tests don't
clobber the user's real ~/.commitment-tracker/.

Run with:
    python3 native-host/test_clyde_data.py
or via vitest's bash:
    bash -c 'python3 native-host/test_clyde_data.py'

Exits 0 on success, 1 on failure. No external deps.
"""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "granola_reader.py"
# Prefer the same interpreter that's running the tests (works on macOS + Linux CI).
PYTHON = sys.executable


# ─── Helpers ───


def call(env: dict, command: str, **kwargs):
    """Invoke the host with our isolated $HOME so BACKUP_DIR points at the fixture."""
    msg = {"command": command, **kwargs}
    body = json.dumps(msg).encode("utf-8")
    payload = struct.pack("<I", len(body)) + body
    p = subprocess.run(
        [PYTHON, str(SCRIPT)],
        input=payload,
        capture_output=True,
        env=env,
        timeout=10,
    )
    if p.returncode != 0:
        raise AssertionError(f"host crashed: rc={p.returncode}, stderr={p.stderr.decode()[:500]}")
    out = p.stdout
    if len(out) < 4:
        raise AssertionError(f"short response: {out!r}")
    length = struct.unpack("<I", out[:4])[0]
    return json.loads(out[4 : 4 + length])


def make_env(home: Path) -> dict:
    e = os.environ.copy()
    e["HOME"] = str(home)
    return e


# ─── Fixture ───


SAMPLE_BACKUP = {
    "version": 1,
    "lastSaved": "2026-05-12T20:00:00Z",
    "commitments": [
        {
            "id": 1,
            "hash": "aaaa1111" + "0" * 56,
            "text": "Send Q1 report to Sarah",
            "status": "new",
            "source_type": "meeting",
            "message_timestamp": "2026-05-10T15:00:00Z",
            "context": "#Q1 Review",
            "deadline": "2026-05-15",
            "conversation_messages": [{"sender": "system", "text": "Meeting: Q1 Review"}],
        },
        {
            "id": 2,
            "hash": "bbbb2222" + "0" * 56,
            "text": "Review the design doc",
            "status": "done",
            "source_type": "slack",
            "message_timestamp": "2026-04-01T10:00:00Z",
            "context": "#design",
            "deadline": None,
            "conversation_messages": [],
        },
        {
            "id": 3,
            "hash": "aaaa3333" + "0" * 56,  # shares prefix with #1
            "text": "Other commitment with same prefix",
            "status": "new",
            "source_type": "meeting",
            "message_timestamp": "2026-05-09T10:00:00Z",
            "context": "#Q1 Review",
            "deadline": None,
            "conversation_messages": [],
        },
    ],
    "settings_db": [],
    "dismissals": [],
    "action_log": [],
    "kanban_columns": [],
    "kanban_assignments": [],
    "tags": [],
    "briefs": [],
    "chrome_storage": {},
    "watermarks": {},
}


def setup_fixture() -> tuple[Path, dict]:
    """Create a temp HOME with a fake ~/.commitment-tracker/backup-fixture.json."""
    home = Path(tempfile.mkdtemp(prefix="clyde-test-home-"))
    backup_dir = home / ".commitment-tracker"
    backup_dir.mkdir()
    with open(backup_dir / "backup-fixture.json", "w") as f:
        json.dump(SAMPLE_BACKUP, f)
    return home, make_env(home)


# ─── Tests ───


def test_stats():
    home, env = setup_fixture()
    try:
        r = call(env, "stats")
        assert r["ok"] is True
        assert r["total"] == 3
        assert r["by_status"]["new"] == 2
        assert r["by_status"]["done"] == 1
        assert r["by_source_type"]["meeting"] == 2
        assert r["by_source_type"]["slack"] == 1
        assert r["pending_ops"] == 0
        assert r["applied_ops"] == 0
    finally:
        shutil.rmtree(home, ignore_errors=True)


def test_list_commitments_filters():
    home, env = setup_fixture()
    try:
        # No filter: all 3
        r = call(env, "list_commitments", filter={})
        assert r["ok"] is True
        assert len(r["commitments"]) == 3

        # status=new: 2
        r = call(env, "list_commitments", filter={"status": "new"})
        assert len(r["commitments"]) == 2

        # source_type=slack: 1
        r = call(env, "list_commitments", filter={"source_type": "slack"})
        assert len(r["commitments"]) == 1

        # has_deadline=True: 1
        r = call(env, "list_commitments", filter={"has_deadline": True})
        assert len(r["commitments"]) == 1
        assert r["commitments"][0]["deadline"] == "2026-05-15"

        # since filter
        r = call(env, "list_commitments", filter={"since": "2026-05-01T00:00:00Z"})
        assert len(r["commitments"]) == 2

        # slim mode (default): no conversation_messages
        r = call(env, "list_commitments", filter={"status": "new"})
        assert "conversation_messages" not in r["commitments"][0]

        # verbose mode: includes conversation_messages
        r = call(env, "list_commitments", filter={"status": "new"}, verbose=True)
        sample = next(c for c in r["commitments"] if c["hash"].startswith("aaaa1111"))
        assert "conversation_messages" in sample
        assert sample["conversation_messages"][0]["sender"] == "system"
    finally:
        shutil.rmtree(home, ignore_errors=True)


def test_get_commitment():
    home, env = setup_fixture()
    try:
        # Unique prefix
        r = call(env, "get_commitment", hash_prefix="bbbb")
        assert r["ok"] is True
        assert len(r["matches"]) == 1
        assert r["matches"][0]["text"] == "Review the design doc"

        # Ambiguous prefix — returns both for caller to handle
        r = call(env, "get_commitment", hash_prefix="aaaa")
        assert r["ok"] is True
        assert len(r["matches"]) == 2

        # Too short
        r = call(env, "get_commitment", hash_prefix="aa")
        assert r["ok"] is False
        assert "at least 4" in r["error"]
    finally:
        shutil.rmtree(home, ignore_errors=True)


def test_apply_ops_writes_dropfile():
    home, env = setup_fixture()
    try:
        op = {
            "id": "op:test-1",
            "type": "dismiss",
            "commitment_hash": "aaaa1111" + "0" * 56,
            "snapshot_at": "2026-05-12T20:00:00Z",
            "generated_at": "2026-05-12T20:00:01Z",
            "rationale": "smoke test",
        }
        r = call(env, "apply_ops", ops=[op])
        assert r["ok"] is True
        assert "filename" in r
        assert r["op_ids"] == ["op:test-1"]

        # File exists in ops/
        ops_dir = home / ".commitment-tracker" / "ops"
        files = list(ops_dir.glob("*.json"))
        assert len(files) == 1

        with open(files[0]) as f:
            data = json.load(f)
        assert data["operations"][0]["id"] == "op:test-1"
        assert data["operations"][0]["type"] == "dismiss"
    finally:
        shutil.rmtree(home, ignore_errors=True)


def test_apply_ops_validation():
    home, env = setup_fixture()
    try:
        # Unknown type
        r = call(env, "apply_ops", ops=[{"id": "x", "type": "delete_commitment"}])
        assert r["ok"] is False
        assert "unknown op type" in r["error"]

        # Missing required field (no commitment_hash)
        r = call(env, "apply_ops", ops=[{"id": "x", "type": "dismiss"}])
        assert r["ok"] is False
        assert "missing required fields" in r["error"]

        # Empty list
        r = call(env, "apply_ops", ops=[])
        assert r["ok"] is False
    finally:
        shutil.rmtree(home, ignore_errors=True)


def test_read_consume_op_files():
    home, env = setup_fixture()
    try:
        # Write 2 ops
        for i in range(2):
            op = {
                "id": f"op:rc-{i}",
                "type": "dismiss",
                "commitment_hash": "aaaa1111" + "0" * 56,
                "snapshot_at": "2026-05-12T20:00:00Z",
                "generated_at": "2026-05-12T20:00:01Z",
                "rationale": f"rc test {i}",
            }
            call(env, "apply_ops", ops=[op])

        # read_op_files sees both
        r = call(env, "read_op_files")
        assert r["ok"] is True
        assert len(r["files"]) == 2
        filenames = [f["filename"] for f in r["files"]]

        # consume one
        r = call(env, "consume_op_files", filenames=[filenames[0]])
        assert r["ok"] is True
        assert r["consumed"] == 1

        # remaining: one in ops/, one in ops/applied/
        ops_dir = home / ".commitment-tracker" / "ops"
        assert len(list(ops_dir.glob("*.json"))) == 1
        assert (ops_dir / "applied" / filenames[0]).exists()
    finally:
        shutil.rmtree(home, ignore_errors=True)


def test_consume_rejects_path_traversal():
    home, env = setup_fixture()
    try:
        r = call(env, "consume_op_files", filenames=["../etc/passwd"])
        assert r["ok"] is True
        # Refused with an error in errors[], not a crash
        assert r["consumed"] == 0
        assert len(r["errors"]) == 1
        assert "suspicious" in r["errors"][0]
    finally:
        shutil.rmtree(home, ignore_errors=True)


def test_no_backup_file():
    """When no backup exists yet, handlers return empty results, not errors."""
    home = Path(tempfile.mkdtemp(prefix="clyde-test-home-"))
    env = make_env(home)
    try:
        r = call(env, "list_commitments", filter={})
        assert r["ok"] is True
        assert r["commitments"] == []
        assert r["backup_mtime"] is None

        r = call(env, "stats")
        assert r["ok"] is True
        assert r["total"] == 0
    finally:
        shutil.rmtree(home, ignore_errors=True)


# ─── Runner ───


def main() -> int:
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failures = []
    for t in tests:
        try:
            t()
            print(f"✓ {t.__name__}")
        except Exception as e:
            failures.append((t.__name__, e))
            print(f"✗ {t.__name__}: {e}")

    print()
    if failures:
        print(f"FAILED {len(failures)}/{len(tests)}")
        return 1
    print(f"OK ({len(tests)} tests)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
