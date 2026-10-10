#!/usr/bin/env bash
# Hextra installer: curl -fsSL https://github.com/Mercphobia/hextra/releases/latest/download/install.sh | bash
set -euo pipefail

REPO="${HEXTRA_REPO:-Mercphobia/hextra}"
VERSION="${HEXTRA_VERSION:-latest}"

is_termux() { [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux" ]; }

install_termux() {
  local src="${HEXTRA_SRC_DIR:-$HOME/hextra}"
  if [ -z "${HEXTRA_SKIP_PKG:-}" ]; then
    pkg update -y && pkg install -y nodejs git
    pkg install -y uv 2>/dev/null || echo "(optional) uv skipped: Python MCP servers need 'pkg install uv' or pip install uv"
  fi
  if [ -d "$src/.git" ]; then
    echo "updating $src"
    git -C "$src" pull --ff-only
  else
    echo "cloning into $src"
    git clone "${HEXTRA_CLONE_URL:-https://github.com/$REPO}" "$src"
  fi
  cd "$src"
  npm ci
  npm run build
  local bindir="${PREFIX:-$HOME/.local}/bin"
  mkdir -p "$bindir"
  cat > "$bindir/hextra" <<EOF
#!/bin/sh
exec node "$src/apps/tui/dist/app.js" "\$@"
EOF
  chmod +x "$bindir/hextra"
  echo "installed wrapper -> $bindir/hextra"
  "$bindir/hextra" doctor || true
  echo "next: hextra setup"
}

install_binary() {
  local os="linux"
  if [ "$(uname -s)" = "Darwin" ]; then os="darwin"; fi
  local arch
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64) arch="arm64" ;;
    x86_64|amd64) arch="x64" ;;
    *) echo "unsupported arch: $arch" >&2; exit 1 ;;
  esac
  local dest="$HOME/.hextra/bin"
  mkdir -p "$dest"
  local url
  if [ "$VERSION" = "latest" ]; then
    url="https://github.com/$REPO/releases/latest/download/hextra-$os-$arch.tar.gz"
  else
    url="https://github.com/$REPO/releases/download/$VERSION/hextra-$os-$arch.tar.gz"
  fi
  echo "installing hextra $os-$arch -> $dest"
  if curl -fsSL "$url" -o /tmp/hextra.tgz; then
    tar -xzf /tmp/hextra.tgz -C "$dest"
    chmod +x "$dest/hextra"
    rm -f /tmp/hextra.tgz
    echo "installed. Run: $dest/hextra setup"
    "$dest/hextra" doctor || true
  else
    echo "no prebuilt binary yet ($url); rerun with a published VERSION" >&2
    exit 1
  fi
}

if is_termux; then
  install_termux
else
  install_binary
fi
