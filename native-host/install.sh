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
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
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

# Make the Python host executable
chmod +x "$HOST_PATH"

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

echo "Native messaging host installed successfully!"
echo ""
echo "  Host name:  $HOST_NAME"
echo "  Host path:  $HOST_PATH"
echo "  Manifest:   $MANIFEST_DIR/$HOST_NAME.json"
echo "  Extension:  $EXT_ID"
echo ""
echo "Next steps:"
echo "  1. Remove and re-load the extension in chrome://extensions"
echo "  2. Open extension Options — should show 'Connected (Local)'"
