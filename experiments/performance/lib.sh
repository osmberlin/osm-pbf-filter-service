#!/usr/bin/env bash
# Sourced inside the container before a scenario. Provides measure() + finalize()
# and the shared BBOX / TAGS so every scenario is comparable.
set -uo pipefail   # NOT -e: we want to record a failing step, not abort

: "${INPUT:?}"; : "${WORK:?}"; : "${RESULTS:?}"; : "${SCENARIO:?}"

# ~Hessen (same region the real spieli project targets).
BBOX="${BBOX:-7.77,49.39,10.24,51.66}"

# Union of our real projects: admin boundaries + a few playground POIs (sparse).
TAGS=(
  nwr/boundary=administrative
  nwr/admin_level
  n/leisure=playground
  w/leisure=playground
  n/amenity=cafe
)

mkdir -p "$WORK" "$RESULTS"
OUT="$RESULTS/$SCENARIO.jsonl"
: > "$OUT"   # reset this scenario's results (idempotent per run)

# measure <label> <outfile|-> -- <command...>
measure() {
  local label="$1" outfile="$2"; shift 2
  [ "${1:-}" = "--" ] && shift
  local tf st wall maxrss xstat size
  tf="$(mktemp)"
  if /usr/bin/time -o "$tf" -f '%e %M %x' "$@" >"$WORK/$SCENARIO.$label.osmium.log" 2>&1; then
    st=ok
  else
    st=fail
  fi
  read -r wall maxrss xstat <"$tf" || true
  rm -f "$tf"
  size=0
  [ "$outfile" != "-" ] && [ -f "$outfile" ] && size="$(stat -c%s "$outfile")"
  printf '{"scenario":"%s","step":"%s","status":"%s","wall_s":%s,"max_rss_kb":%s,"out_bytes":%s}\n' \
    "$SCENARIO" "$label" "$st" "${wall:-0}" "${maxrss:-0}" "${size:-0}" >>"$OUT"
  echo "[$SCENARIO/$label] ${wall:-?}s  $(numfmt --to=iec $(( ${maxrss:-0} * 1024 )) 2>/dev/null)B RSS  out=$(numfmt --to=iec ${size:-0} 2>/dev/null)B  ($st)"
}

# Cross-check: the container's peak memory across the whole scenario (cgroup v2).
finalize() {
  local peak
  peak="$(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo 0)"
  printf '{"scenario":"%s","step":"_container_peak","status":"ok","wall_s":0,"max_rss_kb":%s,"out_bytes":0}\n' \
    "$SCENARIO" "$(( peak / 1024 ))" >>"$OUT"
  echo "[$SCENARIO] container peak: $(numfmt --to=iec ${peak:-0} 2>/dev/null)B"
}
