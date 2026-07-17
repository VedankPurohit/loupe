#!/usr/bin/env bash

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

failures=0

require_text() {
  local file="$1"
  local text="$2"

  if [[ ! -f "$file" ]] || ! grep -Fq -- "$text" "$file"; then
    printf 'missing required text in %s: %s\n' "$file" "$text" >&2
    failures=$((failures + 1))
  fi
}

require_text README.md "docs/operator-guide.md"
require_text README.md "docs/architecture-and-data-model.md"
require_text README.md "scripts/docs-validate.sh"

for heading in \
  "## Native PostgreSQL development" \
  "## Docker Compose deployment" \
  "## Configuration reference" \
  "## Migrations and upgrades" \
  "## Backup, restore, and persistence" \
  "## Bootstrap, members, and devices" \
  "## Codex setup, disconnect, and uninstall" \
  "## Analysis CLI and companion skill" \
  "## Organization-standard synchronization" \
  "## Troubleshooting"; do
  require_text docs/operator-guide.md "$heading"
done

for heading in \
  "## Runtime architecture" \
  "## PostgreSQL data model" \
  "## Evidence states" \
  "## Credential scopes" \
  "## Security and persistence boundaries" \
  "## Known limitations"; do
  require_text docs/architecture-and-data-model.md "$heading"
done

while IFS= read -r source; do
  while IFS= read -r reference; do
    target="${reference%%#*}"
    [[ -z "$target" ]] && continue
    if [[ "$target" == /* ]]; then
      resolved=".$target"
    else
      resolved="$(dirname "$source")/$target"
    fi
    if [[ ! -e "$resolved" ]]; then
      printf 'broken documentation link in %s: %s\n' "$source" "$reference" >&2
      failures=$((failures + 1))
    fi
  done < <(
    grep -hoE '\]\([^):]+\.md(#[^)]+)?\)' "$source" \
      | sed -E 's/^\]\(//; s/\)$//' \
      | sort -u
  )
done < <(find README.md docs -type f -name '*.md' | sort)

if ((failures > 0)); then
  printf 'documentation validation failed with %d issue(s)\n' "$failures" >&2
  exit 1
fi

printf 'documentation validation passed\n'
