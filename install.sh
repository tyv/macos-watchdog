#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.watchdog.monitor"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
NODE_BIN="$(which node)"
CLI_JS="$SCRIPT_DIR/dist/cli.js"

echo "=== macos-watchdog installer ==="
echo ""

# Verify build exists
if [ ! -f "$CLI_JS" ]; then
  echo "Error: dist/cli.js not found. Run 'npm run build' (or 'tsc') first."
  exit 1
fi

# Create a personalised plist with the correct paths
mkdir -p "$HOME/Library/LaunchAgents"
sed \
  -e "s|/Users/yuriitkachenko/.local/share/fnm/node-versions/v20.19.2/installation/bin/node|$NODE_BIN|g" \
  -e "s|/Users/yuriitkachenko/projects/macos-watchdog/dist/cli.js|$CLI_JS|g" \
  -e "s|/Users/yuriitkachenko|$HOME|g" \
  "$PLIST_SRC" > "$PLIST_DST"

echo "Installed plist to: $PLIST_DST"
echo "  Node:    $NODE_BIN"
echo "  CLI:     $CLI_JS"
echo ""

# Symlink the CLI for convenience
if [ -d "$HOME/.local/bin" ]; then
  ln -sf "$CLI_JS" "$HOME/.local/bin/watchdog"
  echo "Symlinked: ~/.local/bin/watchdog"
fi

echo ""
echo "To start the background service now:"
echo "  launchctl load $PLIST_DST"
echo ""
echo "To stop it:"
echo "  launchctl unload $PLIST_DST"
echo ""
echo "Or just run manually:"
echo "  node $CLI_JS start"
echo ""
