# native-host/ — Local CLI + Python bridge

Chrome Native Messaging host (Python). Originally just a Granola transcript reader; now also the data layer for the `clyde` CLI.

## Files
- `granola_reader.py` — the host script. Handles all Native Messaging commands.
- `clyde` — Python CLI. Reads `~/.commitment-tracker/backup-*.json` directly; writes queue as drop files under `~/.commitment-tracker/ops/`.
- `install.sh` — installs the host manifest for Chrome AND symlinks `clyde` to `~/.local/bin/`.
- `clyde-voice-capture.sh` — pre-existing voice-inbox helper.

## Disk layout
```
~/.commitment-tracker/
  backup-<extId>.json     ← service worker writes on every Dexie change (10s debounce)
  ops/                    ← CLI / external writers drop one self-contained file per op-batch
    <unix-ns>-<pid>-<rand>.json
  ops/applied/            ← curator-sync moves successful files here
  curator-ops.json        ← legacy single-file path (Cowork curator); read but no longer the primary write surface
```

## Reads — pure file access, no Chrome required
`clyde dump`, `clyde stats`, `clyde get`, `clyde list` all open `backup-*.json` directly. They work when Chrome is closed.

**Pruning caveats (inherited from `backup-sync.ts`):**
- `done`/`dismissed` commitments older than 30 days are NOT in the backup.
- `actioned` status is excluded (pre-existing — track separately if it matters).
- `conversation_messages` are stripped if the total payload would exceed 900KB (Chrome Native Messaging limit).
- `raw_messages` table is NOT included.

If a query needs unpruned data, query Dexie via DevTools.

## Writes — drop directory
Each `clyde mark-done` / `mark-dismissed` / `flag-review` writes ONE self-contained JSON file in `ops/`. The service worker's `curator-sync` (alarm-driven, `CURATOR_SYNC_PERIOD_MIN = 10`) scans the directory each cycle, applies ops, and moves successful files to `ops/applied/`. Files containing unknown-hash ops, malformed JSON, or unknown op types stay on disk so a future SW build can pick them up.

**Latency**
- Typical (Chrome running, SW awake): ≤30s.
- Worst case (alarm cycle): ≤10 minutes.
- Chrome closed: ops queue indefinitely; apply on next startup.

**Concurrency:** writers never edit a shared file. Each op-batch is a unique filename (`unix-ns-pid-random.json`) created via tempfile + atomic rename. Multiple CLI processes can write simultaneously without locking.

## CLI cheatsheet

```bash
# Read — work offline
clyde stats                                  # status histogram, source histogram, age buckets
clyde dump --status=new                      # human-readable table
clyde dump --status=new --json | jq '.[].text'
clyde dump --source=meeting --since=2026-04-01
clyde get e27ec8ae74                         # one record by hash prefix (≥4 chars)
clyde list --limit=20

# Write — drop files for the SW to apply
clyde mark-done e27ec8ae74 -e "shipped via PR #10520"
clyde mark-done e27e 24705f c3b5             # multiple at once
clyde mark-dismissed 4abc -r "no longer relevant"
clyde flag-review e27e -e "saw a related Slack thread" -c 0.7

# Status
clyde status                                 # backup mtime, pending op count, Chrome running?
```

Hash resolution: prefix matches if unique. Ambiguous prefix → CLI exits 1 and shows matches.

## Cron examples

```cron
# Every weekday morning: snapshot the open list
0 9 * * 1-5 /Users/braydenparkinson/.local/bin/clyde dump --status=new --json > ~/Desktop/clyde-today.json

# Every 30 min during work hours: ask Claude to triage and auto-dismiss anything obviously dead
*/30 9-17 * * 1-5 /Users/braydenparkinson/.local/bin/clyde dump --status=new --json | claude -p "These are open commitments. Return JSON of {hash, action: 'dismiss' | 'keep', reason}. Conservative — only dismiss when explicit dead signal." > /tmp/triage.json && jq -r '.[] | select(.action=="dismiss") | "\(.hash)\t\(.reason)"' /tmp/triage.json | while IFS=$'\t' read h r; do /Users/braydenparkinson/.local/bin/clyde mark-dismissed "$h" -r "$r"; done

# Once a day: log stats for a longitudinal record
0 23 * * * /Users/braydenparkinson/.local/bin/clyde stats >> ~/Documents/clyde-daily-stats.txt
```

## Native messaging commands (host API)
The CLI invokes `granola_reader.py` as a subprocess using the same length-prefixed JSON protocol Chrome uses. The script doesn't enforce origin — Chrome does that at launch time when the manifest's `allowed_origins` is checked. **A CLI invocation bypasses that gate.**

| Command | Purpose | Caller |
|---|---|---|
| `ping` | Health check | SW (granola startup) |
| `list_meetings` / `get_transcript` | Granola transcript fetch | SW (granola-poller) |
| `save_state` / `load_state` / `load_latest_state` | Backup persistence | SW (backup-sync) |
| `get_curator_ops` / `get_curator_ops_since` | Single-file ops read | SW (curator-sync) |
| `read_op_files` / `consume_op_files` | Drop-directory ops scan | SW (curator-sync) |
| `read_inbox` / `clear_inbox` | Voice inbox | SW (voice-inbox) |
| `list_commitments` / `get_commitment` / `stats` | CLI read surface | `clyde` |
| `apply_ops` | CLI write — drops a file in `ops/` | `clyde` |

## Security
- CLI bypasses Chrome's origin gate. Anyone with shell access to this user account can read or mutate commitments. Trust boundary = the user account.
- Backup may contain sensitive Slack messages, Gmail context, internal-only commitments. Don't share `~/.commitment-tracker/` like a config file.
- API tokens (Anthropic, Slack, Google) live in `chrome.storage.local`, NOT in the backup. They're never on disk via this layer.

## Uninstall
```bash
rm ~/.local/bin/clyde
rm -rf ~/.commitment-tracker/   # ⚠ destroys local backup + queued ops
rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.commitment_tracker.granola_reader.json"
```

## Adding a new write op type
Five places to touch (the safety guard catches mistakes — see "Forward-compat" below):
1. `src/shared/types.ts` — extend `CuratorOpType`, declare the op interface, add to the union.
2. `src/background/curator-sync.ts` — add a branch in `applyOp` for the new type.
3. `src/background/curator-sync.test.ts` — add an apply case + an undo case.
4. `native-host/granola_reader.py` — add to `ALLOWED_OP_TYPES` and `OP_REQUIRED_FIELDS`.
5. `native-host/clyde` — add a subcommand that builds the op.

**Forward-compat:** `applyOp` throws on unknown op types instead of silently marking them applied. If an old SW build sees an op type it doesn't know, the file stays in `ops/` un-consumed, and a newer SW can pick it up later. This is enforced by tests in `curator-sync.test.ts`. The op-type guard is sufficient to close the forward-compat hole, so `CuratorOpsFile.version` is intentionally kept at `1`.

## Compaction
Neither `ops/applied/` nor stuck files in `ops/` (unknown-hash, malformed) are pruned automatically. For a single-user laptop this is fine for years, but:

- `clyde stats` reports `applied_ops` (count in `ops/applied/`) and `pending_ops` (count in `ops/`).
- Manual GC is safe: `rm -rf ~/.commitment-tracker/ops/applied/` at any time.
- Stuck files in `ops/` (e.g. ops referencing commitments that have since been pruned from IndexedDB) keep getting an "unknown-hash" log line every sync — inspect with `ls ~/.commitment-tracker/ops/` and `rm` manually.
- A `clyde gc --older-than=30d` subcommand is a reasonable follow-up if this becomes annoying.
