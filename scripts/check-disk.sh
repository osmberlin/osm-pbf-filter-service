#!/usr/bin/env bash
#
# Fail the run if free disk on the OSM volume is too low (PLAN.md §A6).
# Updating or re-downloading a source briefly needs room for a second copy of it
# (Europe ~35 GB), plus intermediate extracts.
set -euo pipefail

OSM_ROOT="${OSM_ROOT:-/srv/osm}"
MIN_FREE_GB="${1:-50}"   # GB; optional first argument. Largest source (Europe ~35 GB) + work files

# -P forces a single, fixed-column line per filesystem (no wrapping); column 4 is
# Available. Strip the unit suffix; bail if we couldn't parse a number.
# NOTE: GitHub parses ::error:: from STDOUT, not stderr.
avail_gb="$(df -P -BG "$OSM_ROOT" | awk 'NR==2 { v = $4; sub(/[A-Za-z]+$/, "", v); print v }')"
if ! [[ "$avail_gb" =~ ^[0-9]+$ ]]; then
  echo "::error::Could not read free space for $OSM_ROOT (got '${avail_gb}')."
  exit 1
fi
echo "==> Free on $OSM_ROOT: ${avail_gb} GB (min ${MIN_FREE_GB} GB)"

if (( avail_gb < MIN_FREE_GB )); then
  echo "::error::Only ${avail_gb} GB free on $OSM_ROOT (< ${MIN_FREE_GB} GB). Aborting."
  exit 1
fi
