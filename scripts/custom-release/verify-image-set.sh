#!/usr/bin/env bash
# Compare two lists emitted ONLY after signature verification by
# scripts/release/verify-release-images.sh --emit-images.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo 'usage: verify-image-set.sh OFFICIAL_IMAGES.tsv CUSTOM_IMAGES.tsv CUSTOM_OWNER/REPO' >&2
  exit 2
fi
official="$1"
custom="$2"
custom_repo="$(printf '%s' "$3" | tr '[:upper:]' '[:lower:]')"
[[ -f "$official" && -f "$custom" && "$custom_repo" =~ ^[a-z0-9_.-]+/[a-z0-9_.-]+$ ]] || {
  echo 'Missing verified image lists or invalid custom repository' >&2; exit 1;
}

# Both inventories have already passed signature, schema, name, duplicate,
# repository and digest validation in the existing official verifier.
[[ "$(wc -l < "$official" | tr -d ' ')" == 7 && "$(wc -l < "$custom" | tr -d ' ')" == 7 ]] || {
  echo 'Verified release image lists are incomplete' >&2; exit 1;
}

changed=0
while IFS=$'\t' read -r name repository digest; do
  baseline="$(awk -F '\t' -v n="$name" '$1 == n { print $2 "@" $3 }' "$official")"
  [[ -n "$baseline" ]] || { echo "Missing upstream image: $name" >&2; exit 1; }
  actual="${repository}@${digest}"
  if [[ "$actual" != "$baseline" ]]; then
    case "$name" in
      api|web|portal)
        [[ "$repository" == "ghcr.io/${custom_repo}/${name}" ]] || {
          echo "Custom $name image must be in ghcr.io/${custom_repo}/${name}" >&2; exit 1;
        }
        changed=$((changed + 1))
        ;;
      *)
        echo "Custom inventory replaces protected upstream $name image" >&2
        exit 1
        ;;
    esac
  fi
done < "$custom"

(( changed > 0 )) || { echo 'Custom release must replace at least one server image' >&2; exit 1; }
printf 'Validated %s custom server image override(s); binaries and executors are official.\n' "$changed"
