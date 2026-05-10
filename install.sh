#!/usr/bin/env bash
# install.sh — Install opencode-runes globally for OpenCode CLI
#
# Usage:
#   ./install.sh            # install to ~/.config/opencode/plugins/
#   ./install.sh --uninstall
#
# Requirements:
#   - OpenCode CLI installed (https://opencode.ai)
#   - Node.js ≥18 or Bun (for TypeScript compilation)
#   - @opencode-ai/plugin installed in ~/.config/opencode/
#     (opencode does this automatically when you run it)

set -euo pipefail

PLUGIN_NAME="opencode-runes"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCODE_CONFIG="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
INSTALL_DIR="$OPENCODE_CONFIG/plugins/$PLUGIN_NAME"
FLAG_FILE="$OPENCODE_CONFIG/.runes-active"
CONFIG_FILE="$OPENCODE_CONFIG/opencode.json"

# Colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[opencode-runes]${NC} $*"; }
success() { echo -e "${GREEN}[opencode-runes]${NC} $*"; }
warn()    { echo -e "${YELLOW}[opencode-runes]${NC} $*"; }
error()   { echo -e "${RED}[opencode-runes]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--uninstall" ]]; then
  info "Uninstalling $PLUGIN_NAME..."
  rm -rf "$INSTALL_DIR"
  rm -f "$FLAG_FILE"
  success "Uninstalled. Remove the plugin entry from $CONFIG_FILE manually if needed."
  exit 0
fi

# ---------------------------------------------------------------------------
# Build (TypeScript → JavaScript)
# ---------------------------------------------------------------------------
info "Building TypeScript..."
cd "$PLUGIN_DIR"

if command -v bun &>/dev/null; then
  bun install --frozen-lockfile 2>/dev/null || bun install
  bun run build
elif command -v npm &>/dev/null; then
  npm ci 2>/dev/null || npm install
  npm run build
else
  error "Neither bun nor npm found. Install one of them and retry."
  exit 1
fi

success "Build complete."

# ---------------------------------------------------------------------------
# Install compiled output
# ---------------------------------------------------------------------------
info "Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

cp -r dist/ "$INSTALL_DIR/dist/"
cp package.json "$INSTALL_DIR/"

# Install runtime dependencies inside the plugin dir (peerDeps are provided
# by opencode's global node_modules, but we bring our own copy to be safe)
cd "$INSTALL_DIR"
if command -v bun &>/dev/null; then
  bun add @opencode-ai/plugin 2>/dev/null || true
else
  npm install --omit=dev 2>/dev/null || true
fi

success "Plugin files installed."

# ---------------------------------------------------------------------------
# Register plugin in opencode.json
# ---------------------------------------------------------------------------
info "Registering plugin in $CONFIG_FILE..."

if [[ ! -f "$CONFIG_FILE" ]]; then
  warn "$CONFIG_FILE not found. Creating minimal config."
  echo '{"$schema":"https://opencode.ai/config.json"}' > "$CONFIG_FILE"
fi

# Use python3 for safe JSON merging (available on macOS by default)
if command -v python3 &>/dev/null; then
  python3 - "$CONFIG_FILE" "$INSTALL_DIR" <<'EOF'
import json, sys, os

config_path = sys.argv[1]
plugin_path = sys.argv[2]

with open(config_path, "r") as f:
    config = json.load(f)

plugins = config.get("plugin", [])
# Use relative-style path that opencode accepts — local path string
local_entry = plugin_path

if local_entry not in plugins:
    plugins.append(local_entry)
    config["plugin"] = plugins
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print("Plugin registered.")
else:
    print("Plugin already registered.")
EOF
else
  warn "python3 not found. Add this to $CONFIG_FILE manually:"
  echo ""
  echo "  \"plugin\": [\"$INSTALL_DIR\"]"
  echo ""
fi

# ---------------------------------------------------------------------------
# Register slash commands in opencode.json
# ---------------------------------------------------------------------------
info "Registering slash commands (/runes, /runes-help, /runes-stats)..."

if command -v python3 &>/dev/null; then
  python3 - "$CONFIG_FILE" "$PLUGIN_DIR/commands.json" <<'EOF'
import json, sys

config_path = sys.argv[1]
commands_path = sys.argv[2]

with open(config_path, "r") as f:
    config = json.load(f)

with open(commands_path, "r") as f:
    new_commands_data = json.load(f)

new_commands = new_commands_data.get("command", {})
existing = config.get("command", {})
merged = {**new_commands, **existing}  # existing wins if same key
config["command"] = merged

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)

print("Commands registered.")
EOF
else
  warn "Add the contents of commands.json to the 'command' key in $CONFIG_FILE."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
success "opencode-runes installed successfully!"
echo ""
echo "  Try it:"
echo "    opencode                      # start a session"
echo "    /runes                        # activate (full mode)"
echo "    /runes ultra                  # switch to ultra"
echo "    /runes-stats                  # show token stats"
echo "    /runes-help                   # show documentation"
echo "    normal mode                   # deactivate"
echo ""
