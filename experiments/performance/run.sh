#!/usr/bin/env bash
# Host runner: build the image (cached) and run scenario(s) in Docker, capturing
# per-step RAM/timing into results/. Runs ALL scenarios, or just the ones named.
#
#   ./run.sh                          # all
#   ./run.sh 03-strategy-smart        # one (others' results are reused)
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="osm-perf"
# Real path of the input (the data/input symlink documents the source). Override
# with INPUT_HOST=... if your checkout lives elsewhere.
INPUT_HOST="${INPUT_HOST:-/Users/tordans/Development/OSM/osm-processing-pipeline-comparison/data/raw/germany-latest.osm.pbf}"

[ -f "$INPUT_HOST" ] || { echo "ERROR: input not found: $INPUT_HOST" >&2; exit 1; }

echo "==> building image (cached)"
docker build -q -t "$IMAGE" . >/dev/null

mkdir -p work results
# Record the toolchain versions once, for the report.
docker run --rm "$IMAGE" sh -c 'osmium --version | head -1; /usr/bin/time --version 2>&1 | head -1' >results/_env.txt || true

# Which scenarios?
if [ "$#" -gt 0 ]; then
  scenarios=("$@")
else
  scenarios=()
  for f in scenarios/*.sh; do scenarios+=("$(basename "$f" .sh)"); done
fi

mem_flag=()
[ -n "${MEM:-}" ] && mem_flag=(--memory "$MEM")

for s in "${scenarios[@]}"; do
  [ -f "scenarios/$s.sh" ] || { echo "ERROR: no scenario scenarios/$s.sh" >&2; exit 1; }
  echo "==> running $s"
  docker run --rm ${mem_flag[@]+"${mem_flag[@]}"} \
    -v "$INPUT_HOST":/data/input.osm.pbf:ro \
    -v "$PWD/work":/work \
    -v "$PWD/results":/results \
    -v "$PWD/lib.sh":/lib.sh:ro \
    -v "$PWD/scenarios":/scenarios:ro \
    -e SCENARIO="$s" -e INPUT=/data/input.osm.pbf -e WORK=/work -e RESULTS=/results \
    "$IMAGE" bash -c 'source /lib.sh && source "/scenarios/$SCENARIO.sh" && finalize'
done

echo "==> done. Regenerate the report with:  bun report.ts"
