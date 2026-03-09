#!/bin/bash
# Install the Granola cache reader as a Chrome Native Messaging host.
#
# Usage:
#   ./install.sh <chrome-extension-id>
#
# Example:
#   ./install.sh abcdefghijklmnopqrstuvwxyzabcdef

set -euo pipefail

HOST_NAME="com.commitment_tracker.granola_reader"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/granola_reader.py"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <chrome-extension-id>"
  echo ""
  echo "Find your extension ID at chrome://extensions (enable Developer mode)"
  exit 1
fi

EXT_ID="$1"

# Validate extension ID format (32 lowercase letters)
if ! echo "$EXT_ID" | grep -qE '^[a-z]{32}$'; then
  echo "Warning: Extension ID doesn't look like a standard Chrome ID (expected 32 lowercase letters)."
  echo "Continuing anyway..."
fi

# ─── Detect OS and set manifest directory ───

OS="$(uname -s)"
case "$OS" in
  Darwin)
    MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  Linux)
    MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    ;;
  *)
    echo "Error: Unsupported OS ($OS). This script supports macOS and Linux."
    exit 1
    ;;
esac

# ─── Find python3 and write absolute path into shebang ───

PYTHON3_PATH="$(command -v python3 2>/dev/null || true)"
if [ -z "$PYTHON3_PATH" ]; then
  echo "Error: python3 not found. Please install Python 3 first."
  echo "  macOS: brew install python3"
  echo "  Linux: sudo apt install python3"
  exit 1
fi

# Resolve symlinks to get the real path (Chrome's sandbox may not follow symlinks)
PYTHON3_REAL="$(realpath "$PYTHON3_PATH" 2>/dev/null || readlink -f "$PYTHON3_PATH" 2>/dev/null || echo "$PYTHON3_PATH")"

echo "Found python3: $PYTHON3_REAL"

# Rewrite the shebang in granola_reader.py to use the absolute python3 path
# This avoids issues with Chrome's sandbox not finding /usr/bin/env python3
sed -i.bak "1s|^#!.*|#!${PYTHON3_REAL}|" "$HOST_PATH"
rm -f "$HOST_PATH.bak"

# Make the Python host executable
chmod +x "$HOST_PATH"

# Clear macOS quarantine/provenance flags that silently block execution
if [ "$OS" = "Darwin" ]; then
  xattr -d com.apple.quarantine "$HOST_PATH" 2>/dev/null || true
  xattr -d com.apple.provenance "$HOST_PATH" 2>/dev/null || true
fi

# Create the manifest directory if it doesn't exist
mkdir -p "$MANIFEST_DIR"

# Write the native messaging host manifest
cat > "$MANIFEST_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Reads Granola meeting cache for Commitment Tracker",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo ""
echo "Native messaging host installed successfully!"
echo ""
echo "  Host name:  $HOST_NAME"
echo "  Host path:  $HOST_PATH"
echo "  Python:     $PYTHON3_REAL"
echo "  Manifest:   $MANIFEST_DIR/$HOST_NAME.json"
echo "  Extension:  $EXT_ID"
echo ""
echo "Next steps:"
echo "  1. Quit Chrome completely (Cmd+Q / Ctrl+Q) and reopen it"
echo "  2. Open extension Settings — should show 'Connected (Local)'"
