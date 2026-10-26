#!/usr/bin/env bash
#
# Runs ON the nightly server as osmrunner, from the copied repo (/srv/osm/repo).
# daily.yml pipes it in over SSH. Sources and extracts live in R2 between nights;
# the server itself is thrown away afterwards.
#
# Optional env: RESEED="europe ..." re-downloads those sources from Geofabrik.
set -euo pipefail

# R2 bucket (rclone remote "r2" is configured by daily.yml).
BUCKET="r2:osm-extracts"
RCLONE=(rclone --transfers 4 --multi-thread-streams 8 --s3-chunk-size 64M --s3-upload-concurrency 8 --stats 1m --stats-one-line)

cd /srv/osm/repo

echo "==> Fetching sources from R2"
"${RCLONE[@]}" copy "$BUCKET/sources" /srv/osm/sources

if [[ -n "${RESEED:-}" ]]; then
  # shellcheck disable=SC2086 # word splitting is intended: a list of ids
  python3 -m extractor seed $RESEED
fi

./scripts/check-disk.sh
python3 -m extractor update

# Push updated sources right away, so the progress survives a failing build.
echo "==> Saving sources to R2"
"${RCLONE[@]}" copy /srv/osm/sources "$BUCKET/sources"

./scripts/check-disk.sh
python3 -m extractor build

# copy, not sync: a project skipped tonight (e.g. a config error) keeps its
# last good file instead of disappearing from the public bucket.
echo "==> Publishing extracts to R2"
"${RCLONE[@]}" copy /srv/osm/extracts "$BUCKET/extracts"
