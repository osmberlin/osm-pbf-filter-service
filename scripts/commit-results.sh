#!/usr/bin/env bash
#
# DRAFT — commit the resolved plan + status metadata so git history is the audit
# log (PLAN.md §B6). Binaries are NOT committed (they live under nginx).
set -euo pipefail

git config user.name  "osm-extract-bot"
git config user.email "osm-extract-bot@users.noreply.github.com"

# Only metadata — never the .osm.pbf files.
git add status/ plan.json 2>/dev/null || true

if git diff --cached --quiet; then
  echo "==> No metadata changes to commit."
  exit 0
fi

stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
git commit -m "chore(extracts): update plan + status ($stamp)"
git push
echo "==> Committed + pushed extract metadata."
