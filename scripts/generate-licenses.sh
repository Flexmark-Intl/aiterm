#!/bin/bash
# Generate THIRD_PARTY_LICENSES.md from Rust and npm dependencies.
# Run from project root: ./scripts/generate-licenses.sh

set -euo pipefail
cd "$(dirname "$0")/.."

OUT="THIRD_PARTY_LICENSES.md"

echo "Generating Rust dependency licenses..."
RUST_LICENSES=$(cd src-tauri && cargo about generate about.hbs 2>/dev/null)

echo "Generating npm dependency licenses..."
NPM_LICENSES=$(npx --yes license-report --output=markdown --fields=name --fields=licenseType --fields=link --fields=installedVersion --fields=author 2>/dev/null || echo "(license-report not available — run: npm install -g license-report)")

cat > "$OUT" <<EOF
# Third-Party Licenses

This file lists all third-party dependencies used in aiTerm and their licenses.

Generated on: $(date -u +"%Y-%m-%d")

---

## Rust Dependencies

$RUST_LICENSES

---

## JavaScript/npm Dependencies

$NPM_LICENSES
EOF

echo "Written to $OUT ($(wc -l < "$OUT") lines)"
