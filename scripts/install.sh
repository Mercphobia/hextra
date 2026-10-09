#!/usr/bin/env bash
# Hextra installer (OpenCode/Hermes style): curl -fsSL https://.../install.sh | bash
set -euo pipefail

OS="linux"
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) ARCH="arm64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

if [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux" ]; then
  OS="android"
  DEST="${PREFIX:-$HOME/.local}/bin"
else
  DEST="$HOME/.hextra/bin"
fi

BASE_URL="${HEXTRA_BASE_URL:-https://github.com/Mercphobia/hextra/releases/latest/download}"
echo "installing hextra $OS-$ARCH -> $DEST"
mkdir -p "$DEST"
echo "P0: source install. TODO: download $BASE_URL/hextra-$OS-$ARCH.tar.gz"
echo "next: hextra setup"
