#!/usr/bin/env bash
# Parse the canonical Breeze release inventory *after* its Ed25519 signature
# has been verified by scripts/release/verify-release-images.sh.
set -euo pipefail
[[ $# -eq 1 && -f "$1" ]] || { echo 'usage: list-verified-images.sh VERIFIED_MANIFEST.json' >&2; exit 2; }
awk '
  /^  "images": \[$/ { in_images=1; next }
  in_images && /^  \],?$/ { in_images=0; exit }
  in_images && /^    \{$/ { digest=""; name=""; repository=""; next }
  in_images && /^      "digest": "/ { value=$0; sub(/^      "digest": "/, "", value); sub(/",?$/, "", value); digest=value; next }
  in_images && /^      "name": "/ { value=$0; sub(/^      "name": "/, "", value); sub(/",?$/, "", value); name=value; next }
  in_images && /^      "repository": "/ { value=$0; sub(/^      "repository": "/, "", value); sub(/",?$/, "", value); repository=value; next }
  in_images && /^    \},?$/ {
    if (digest == "" || name == "" || repository == "") exit 41
    print name "\t" repository "\t" digest
  }
' "$1"
