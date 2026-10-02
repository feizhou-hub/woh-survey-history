#!/bin/bash
# Stage a Chrome MV3 folder at dist/chrome (manifest.chrome.json → manifest.json).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/dist/chrome"
rm -rf "$dest"
mkdir -p "$dest"
rsync -a \
  --exclude 'manifest.json' \
  --exclude 'manifest.firefox.json' \
  --exclude 'manifest.chrome.json' \
  "$root/extension/" "$dest/"
cp "$root/extension/manifest.chrome.json" "$dest/manifest.json"
echo "$dest"
