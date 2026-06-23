#!/usr/bin/env bash
#
# DRAFT — bring the local planet up to date with OSMF replication diffs,
# then record timestamps for the status files (PLAN.md §B1).
set -euo pipefail

OSM_ROOT="${OSM_ROOT:-/srv/osm}"
PLANET="$OSM_ROOT/planet/planet.osm.pbf"
STATE="$OSM_ROOT/planet/update-state.json"

if [[ ! -f "$PLANET" ]]; then
  echo "::error::No planet at $PLANET — run the 'seed-planet' workflow first." >&2
  exit 1
fi

update_run_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
start=$SECONDS

echo "==> Applying replication diffs with pyosmium-up-to-date"
# Uses daily diffs to keep the number of changes small; tracks its own sequence.
pyosmium-up-to-date --server https://planet.openstreetmap.org/replication/day "$PLANET"

duration=$(( SECONDS - start ))

# The real "as-of" date of the OSM data (osmosis_replication_timestamp).
data_timestamp="$(osmium fileinfo -e -g data.timestamp.last "$PLANET")"
seqno="$(osmium fileinfo -e -g header.option.osmosis_replication_sequence_number "$PLANET" 2>/dev/null || echo null)"

jq -n \
  --arg update_run_at "$update_run_at" \
  --arg data_timestamp "$data_timestamp" \
  --argjson update_duration_seconds "$duration" \
  --arg planet_sequence_number "$seqno" \
  '{update_run_at:$update_run_at, data_timestamp:$data_timestamp,
    update_duration_seconds:$update_duration_seconds,
    planet_sequence_number:$planet_sequence_number}' > "$STATE"

echo "==> Planet updated: data=$data_timestamp seq=$seqno (${duration}s)"
