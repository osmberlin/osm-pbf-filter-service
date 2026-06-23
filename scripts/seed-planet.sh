#!/usr/bin/env bash
#
# DRAFT — full re-download of the planet, verified, then swapped in atomically
# (PLAN.md §B1). Triggered manually by the seed-planet workflow only.
#
# Needs ~2x planet free disk temporarily (old + new). Check space first!
set -euo pipefail

OSM_ROOT="${OSM_ROOT:-/srv/osm}"
PLANET_DIR="$OSM_ROOT/planet"
PLANET="$PLANET_DIR/planet.osm.pbf"
TMP="$PLANET_DIR/planet.osm.pbf.download"
BASE="https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf"

mkdir -p "$PLANET_DIR"

echo "==> Downloading planet + checksum"
curl -fSL --retry 3 -o "$TMP"        "$BASE"
curl -fSL --retry 3 -o "$TMP.md5"    "$BASE.md5"

echo "==> Verifying md5"
# planet .md5 references "planet-latest.osm.pbf"; verify against our temp file.
expected="$(awk '{print $1}' "$TMP.md5")"
actual="$(md5sum "$TMP" | awk '{print $1}')"
if [[ "$expected" != "$actual" ]]; then
  echo "::error::Checksum mismatch (expected $expected, got $actual)" >&2
  rm -f "$TMP" "$TMP.md5"
  exit 1
fi

echo "==> Swapping in new planet"
mv -f "$TMP" "$PLANET"
rm -f "$TMP.md5"
echo "==> Seed complete: $(osmium fileinfo -e -g data.timestamp.last "$PLANET")"
