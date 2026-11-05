#!/usr/bin/env bash
set -euo pipefail

# Claude Deck installer for Claude Code plugin + VS Code / Cursor / Windsurf extension.
# Can be run directly from repo: ./install.sh
# Or piped from curl: curl -fsSL https://raw.githubusercontent.com/kaiketsu-labs/claude-deck/main/install.sh | bash

REPO="kaiketsu-labs/claude-deck"

echo "=== Claude Deck Installer ==="

# 1. Claude Code Plugin
echo ""
echo "1. Checking Claude Code..."
if command -v claude >/dev/null 2>&1; then
  echo "   Adding marketplace and installing 'deck' plugin..."
  claude plugin marketplace add "$REPO" 2>/dev/null || claude plugin marketplace update 2>/dev/null || true
  claude plugin install deck@claude-deck
  echo "   ✓ Claude Code plugin installed."
else
  echo "   ⚠️  'claude' CLI not found in PATH."
  echo "      Run this later once Claude Code is installed:"
  echo "      claude plugin marketplace add $REPO && claude plugin install deck@claude-deck"
fi

# 2. VS Code / Cursor / Windsurf Extension
echo ""
echo "2. Installing editor extension..."

# Detect available editor CLIs
EDITORS=()
for cmd in code cursor windsurf code-insiders codium vscodium; do
  if command -v "$cmd" >/dev/null 2>&1; then
    EDITORS+=("$cmd")
  fi
done

if [ ${#EDITORS[@]} -eq 0 ]; then
  echo "   ⚠️  No editor CLI ('code', 'cursor', 'windsurf', etc.) found in PATH."
  echo "      In VS Code / Cursor, run Cmd+Shift+P (or Ctrl+Shift+P) -> 'Shell Command: Install '\''code'\'' command in PATH'."
  echo "      Then re-run this installer."
  exit 0
fi

# Find or fetch VSIX
TEMP_DIR=""
VSIX_PATH=""

# If running inside the repo checkout and package.py exists, package on the fly
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/vscode/package.py" ]; then
  echo "   Found local checkout. Packaging VSIX with python3..."
  (cd "$SCRIPT_DIR/vscode" && python3 package.py >/dev/null)
  VSIX_PATH=$(ls -t "$SCRIPT_DIR"/vscode/claude-deck-*.vsix 2>/dev/null | head -n 1 || true)
fi

# If not in repo or local packaging didn't produce a file, download latest release
if [ -z "$VSIX_PATH" ] || [ ! -f "$VSIX_PATH" ]; then
  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TEMP_DIR"' EXIT
  TARGET="$TEMP_DIR/claude-deck.vsix"
  echo "   Downloading latest VSIX from GitHub Releases..."

  # Try unversioned alias first, fall back to GitHub API resolution
  if ! curl -fsSL "https://github.com/$REPO/releases/latest/download/claude-deck.vsix" -o "$TARGET" 2>/dev/null; then
    DOWNLOAD_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | grep -o 'https://[^"]*claude-deck-[^"]*\.vsix' | head -n 1 || true)
    if [ -n "$DOWNLOAD_URL" ]; then
      curl -fsSL "$DOWNLOAD_URL" -o "$TARGET"
    fi
  fi

  if [ -f "$TARGET" ]; then
    VSIX_PATH="$TARGET"
  fi
fi

if [ -n "$VSIX_PATH" ] && [ -f "$VSIX_PATH" ]; then
  for editor in "${EDITORS[@]}"; do
    echo "   Installing into $editor ($($editor --version 2>/dev/null | head -n 1 || echo "ready"))..."
    "$editor" --install-extension "$VSIX_PATH" --force
  done
  echo "   ✓ Extension installed successfully."
else
  echo "   ⚠️  Could not locate or download the .vsix package."
  echo "      Please download from https://github.com/$REPO/releases/latest and install with:"
  echo "      code --install-extension <path-to-vsix>"
  exit 1
fi

echo ""
echo "=== Claude Deck is ready! ==="
echo "Open the Claude Deck icon in your sidebar to get started."
