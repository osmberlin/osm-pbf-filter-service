#!/usr/bin/env bash
#
# DRAFT — bring the local planet up to date with OSMF replication diffs,
# then record timestamps for the status files (PLAN.md §B1).
set -euo pipefail

OSM_ROOT="${OSM_ROOT:-/srv/osm}"
PLANET="$OSM_ROOT/planet/planet.osm.pbf"
STATE="$OSM_ROOT/planet/update-state.json"

# NOTE: GitHub parses workflow commands (::error::) from STDOUT, not stderr.
if [[ ! -f "$PLANET" ]]; then
  echo "::error::No planet at $PLANET — run the 'seed-planet' workflow first."
  exit 1
fi

update_run_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
start=$SECONDS

echo "==> Applying replication diffs with pyosmium-up-to-date"
# Exit codes (see pyosmium-up-to-date(1)): 0 = fully up to date; 1 = updates
# applied but MORE remain (the ~1 GB per-invocation download cap was hit — a
# routine partial success after any gap, NOT an error); >1 = real error.
# Loop on 1 so a multi-day catch-up completes in one run, bounded so a
# persistent network error can't loop forever.
for attempt in $(seq 1 10); do
  rc=0
  pyosmium-up-to-date --server https://planet.openstreetmap.org/replication/day "$PLANET" || rc=$?
  case "$rc" in
    0) break ;;
    1) echo "==> More diffs pending after pass $attempt (download cap reached); continuing" ;;
    *) echo "::error::pyosmium-up-to-date failed with exit code $rc"; exit "$rc" ;;
  esac
  if [[ "$attempt" -eq 10 ]]; then
    echo "::error::Planet still behind after 10 update passes — giving up for this run (progress is kept)."
    exit 1
  fi
done

duration=$(( SECONDS - start ))

# The real "as-of" date of the OSM data (osmosis_replication_timestamp).
# Tolerate missing fields (|| true) so set -e doesn't abort after the update ran.
data_timestamp="$(osmium fileinfo -e -g data.timestamp.last "$PLANET" 2>/dev/null || true)"
seqno="$(osmium fileinfo -e -g header.option.osmosis_replication_sequence_number "$PLANET" 2>/dev/null || true)"

# Emit proper JSON types: data_timestamp as string-or-null, sequence as number-or-null.
jq -n \
  --arg update_run_at "$update_run_at" \
  --arg data_timestamp "$data_timestamp" \
  --argjson update_duration_seconds "$duration" \
  --arg planet_sequence_number "$seqno" \
  '{update_run_at: $update_run_at,
    data_timestamp: (if $data_timestamp == "" then null else $data_timestamp end),
    update_duration_seconds: $update_duration_seconds,
    planet_sequence_number: (if $planet_sequence_number == "" then null else ($planet_sequence_number | tonumber? // null) end)}' > "$STATE"

echo "==> Planet updated: data=$data_timestamp seq=$seqno (${duration}s)"
