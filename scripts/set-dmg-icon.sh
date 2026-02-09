#!/usr/bin/env bash
# Stamp the app icon onto the DMG file so it shows in Finder.
# Uses Swift + AppKit (available with Xcode command-line tools).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ICNS="$ROOT_DIR/src-tauri/icons/icon.icns"
DMG_DIR="$ROOT_DIR/src-tauri/target/release/bundle/dmg"

DMG=$(find "$DMG_DIR" -name '*.dmg' -maxdepth 1 | head -1)

if [[ -z "$DMG" ]]; then
  echo "No DMG found in $DMG_DIR"
  exit 1
fi

echo "Setting icon on $(basename "$DMG")..."

swift - "$ICNS" "$DMG" <<'SWIFT'
import AppKit
let args = CommandLine.arguments
guard args.count == 3,
      let icon = NSImage(contentsOfFile: args[1]) else {
    fputs("Usage: set-dmg-icon <icon.icns> <file.dmg>\n", stderr)
    exit(1)
}
NSWorkspace.shared.setIcon(icon, forFile: args[2], options: [])
SWIFT

echo "Done."
