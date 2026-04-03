#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: DMG creation requires macOS (hdiutil not available on this OS)."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/desktop/src-tauri"
DIST_DIR="$ROOT_DIR/dist"
STAGING_DIR="$DIST_DIR/dmg-staging"
DMG_PATH="$DIST_DIR/Project-Archivist.dmg"

mkdir -p "$DIST_DIR"

cd "$APP_DIR"
cargo tauri build

APP_BUNDLE="$(find target/release/bundle/macos -maxdepth 1 -name '*.app' | head -n 1)"
if [[ -z "$APP_BUNDLE" ]]; then
  echo "Error: .app bundle not found."
  exit 1
fi

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R "$APP_BUNDLE" "$STAGING_DIR/"

hdiutil create -volname "Project Archivist" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH"

echo "DMG created at: $DMG_PATH"
