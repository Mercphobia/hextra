#!/usr/bin/env bash
# Hextra installer (OpenCode/Hermes style): curl -fsSL https://github.com/Mercphobia/hextra/releases/latest/download/install.sh | bash
set -euo pipefail

REPO="${HEXTRA_REPO:-Mercphobia/hextra}"
VERSION="${HEXTRA_VERSION:-latest}"
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
mkdir -p "$DEST"

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/$REPO/releases/latest/download/hextra-$OS-$ARCH.tar.gz"
else
  URL="https://github.com/$REPO/releases/download/$VERSION/hextra-$OS-$ARCH.tar.gz"
fi

echo "installing hextra $OS-$ARCH -> $DEST"
if curl -fsSL "$URL" -o /tmp/hextra.tgz; then
  tar -xzf /tmp/hextra.tgz -C "$DEST"
  chmod +x "$DEST/hextra"
  rm -f /tmp/hextra.tgz
  echo "installed. Run: hextra setup"
  "$DEST/hextra" doctor || true
else
  echo "no prebuilt binary yet ($URL)"
  echo "source install instead:"
  echo "  git clone https://github.com/$REPO && cd hextra && npm ci && npm run build"
  echo "  ln -sf \$PWD/apps/tui/dist/app.js $DEST/hextra"
  exit 1
fi
