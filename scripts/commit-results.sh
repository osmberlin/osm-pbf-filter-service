#!/usr/bin/env bash
#
# DRAFT — commit the resolved plan + status metadata so git history is the audit
# log (PLAN.md §B6). Binaries are NOT committed (they live under nginx).
set -euo pipefail

git config user.name  "osm-extract-bot"
git config user.email "osm-extract-bot@users.noreply.github.com"

# Stage only metadata that exists — never the .osm.pbf binaries. Listing a
# missing pathspec makes `git add` abort and stage nothing, so add each
# separately and only if present.
staged=0
for p in status plan.json; do
  if [[ -e "$p" ]]; then git add -- "$p"; staged=1; fi
done
if [[ "$staged" -eq 0 ]]; then
  echo "==> Nothing to stage (no status/ or plan.json)."
  exit 0
fi

if git diff --cached --quiet; then
  echo "==> No metadata changes to commit."
  exit 0
fi

stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# [skip ci] so this metadata commit doesn't re-trigger the test workflow.
git commit -m "chore(extracts): update plan + status ($stamp) [skip ci]"

# actions/checkout leaves a detached HEAD, so push HEAD explicitly to the branch.
# In CI use an ephemeral token-in-URL (nothing persisted in .git/config on the
# shared runner); locally fall back to whatever 'origin' is configured.
branch="${GITHUB_REF_NAME:-main}"
if [[ -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
  git push "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:${branch}"
else
  git push origin "HEAD:${branch}"
fi
echo "==> Committed + pushed extract metadata to ${branch}."
