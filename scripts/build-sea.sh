#!/usr/bin/env bash
# Build a single-executable hextra binary with Node SEA (--build-sea).
# Requires Node >= 25.5 (for mainFormat: module). Usage: ./scripts/build-sea.sh
set -euo pipefail
cd "$(dirname "$0")/.."

node --version
npm run build
node scripts/bundle-sea.mjs
node --build-sea scripts/sea-config.json
chmod +x dist-sea/hextra
./dist-sea/hextra doctor || true
echo "sea binary: dist-sea/hextra"
