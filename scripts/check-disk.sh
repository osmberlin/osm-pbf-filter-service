#!/usr/bin/env bash
#
# DRAFT — fail the run if free disk on the OSM volume is too low (PLAN.md §A6).
# The planet grows over time and a re-seed needs ~2x planet; guard against
# silently filling the disk we share with uMap.
set -euo pipefail

OSM_ROOT="${OSM_ROOT:-/srv/osm}"
MIN_FREE_GB="${MIN_FREE_GB:-120}"   # tune for the 585 GB shared disk

avail_gb="$(df -BG --output=avail "$OSM_ROOT" | tail -1 | tr -dc '0-9')"
echo "==> Free on $OSM_ROOT: ${avail_gb} GB (min ${MIN_FREE_GB} GB)"

if (( avail_gb < MIN_FREE_GB )); then
  echo "::error::Only ${avail_gb} GB free on $OSM_ROOT (< ${MIN_FREE_GB} GB). Aborting." >&2
  exit 1
fi
