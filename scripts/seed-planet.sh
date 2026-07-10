#!/usr/bin/env bash
#
# DRAFT — full re-download of the planet, verified, then swapped in atomically
# (PLAN.md §B1). Triggered manually by the seed-planet workflow only.
#
# Needs ~2x planet free disk temporarily (old + new); the workflow runs
# check-disk.sh with a raised threshold before invoking this.
set -euo pipefail

OSM_ROOT="${OSM_ROOT:-/srv/osm}"
PLANET_DIR="$OSM_ROOT/planet"
PLANET="$PLANET_DIR/planet.osm.pbf"
TMP="$PLANET_DIR/planet.osm.pbf.download"
BASE="https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf"

mkdir -p "$PLANET_DIR"

# Always clean up temp files on exit (incl. a curl failure mid-download), so a
# partial ~87GB file never lingers on the disk shared with uMap. On success the
# data file has already been mv'd away, so this only removes leftovers.
# No resume (-C -): planet-latest.osm.pbf rotates weekly, so resuming a stale
# partial would splice two different planets together; restart from scratch.
trap 'rm -f "$TMP" "$TMP.md5"' EXIT

echo "==> Downloading planet + checksum"
curl -fSL --retry 3 -o "$TMP"        "$BASE"
curl -fSL --retry 3 -o "$TMP.md5"    "$BASE.md5"

echo "==> Verifying md5"
# planet .md5 references "planet-latest.osm.pbf"; verify against our temp file.
# NOTE: GitHub parses ::error:: from STDOUT, not stderr.
expected="$(awk '{print $1}' "$TMP.md5")"
actual="$(md5sum "$TMP" | awk '{print $1}')"
if [[ "$expected" != "$actual" ]]; then
  echo "::error::Checksum mismatch (expected $expected, got $actual)"
  exit 1   # trap removes the partial download
fi

echo "==> Swapping in new planet"
mv -f "$TMP" "$PLANET"
echo "==> Seed complete: $(osmium fileinfo -e -g data.timestamp.last "$PLANET")"
