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
#
# Credential handling: the token must NOT appear in the remote URL — argv is
# world-readable via /proc on this SHARED server. A credential helper reads it
# from the environment instead (the single-quoted helper string carries the
# variable reference, not its value).
branch="${GITHUB_REF_NAME:-main}"
push() {
  if [[ -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
    git -c credential.helper= \
        -c credential.helper='!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f' \
        push "https://github.com/${GITHUB_REPOSITORY}.git" "HEAD:${branch}"
  else
    git push origin "HEAD:${branch}"
  fi
}

# The pipeline runs for hours; a commit landing on the branch meanwhile makes the
# push non-fast-forward. Rebase our single metadata commit and retry a few times.
# The fetch/rebase must not blow through `set -e`: a rebase conflict should abort
# the rebase, report, and exit cleanly — not leave a mid-rebase checkout.
for attempt in 1 2 3; do
  if push; then
    echo "==> Committed + pushed extract metadata to ${branch}."
    exit 0
  fi
  echo "==> Push rejected (attempt $attempt); rebasing onto latest ${branch}"
  if ! git fetch origin "$branch" || ! git rebase FETCH_HEAD; then
    git rebase --abort 2>/dev/null || true
    echo "::error::Rebase onto latest ${branch} failed (conflicting metadata commit?); giving up."
    exit 1
  fi
done
echo "::error::Could not push extract metadata after 3 attempts."
exit 1
