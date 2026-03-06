#!/bin/bash
# Called by Apple Shortcuts to append a dictated task to the Clyde inbox.
# Usage: ./clyde-voice-capture.sh "Send the proposal to Sarah by Friday"

INBOX="$HOME/Documents/clyde-inbox.txt"

if [ $# -eq 0 ]; then
  echo "No task provided" >&2
  exit 1
fi

echo "$*" >> "$INBOX"
echo "Task added to Clyde inbox"
