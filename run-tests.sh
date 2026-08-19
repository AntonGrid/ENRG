#!/usr/bin/env bash
set -euo pipefail

# Repository root — the directory where this script lives
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Running Python tests (pytest)..."
cd "$ROOT_DIR"

if [ -d ".venv" ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
else
  echo "WARN: .venv not found. Make sure dependencies are installed globally or create a virtualenv."
fi

pytest -q

echo
echo "==> Running Foundry tests (forge)..."
cd "$ROOT_DIR/onchain"

# source ~/.bashrc in case the forge PATH is picked up there
# shellcheck disable=SC1090
if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi

if ! command -v forge >/dev/null 2>&1; then
  echo "ERROR: forge not found in PATH. Make sure Foundry is installed and added to PATH."
  exit 1
fi

forge test -q

echo
echo "==> All tests passed (pytest + forge)."
