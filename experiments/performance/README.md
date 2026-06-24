# Performance experiment — osmium filtering on a country extract

An isolated benchmark to answer the open performance questions from
[PLAN.md §B8](../../PLAN.md) before we commit to a pipeline shape on the shared
FOSSGIS/uMap server.

Everything runs **inside Docker** (Linux + GNU `/usr/bin/time`), so it doesn't
touch the host toolchain and the numbers resemble the Linux server. The host only
needs Docker.

## Questions under test (from §B8)

1. **Strategy cost & RAM** — `osmium extract` with `simple` vs `complete_ways` vs
   `smart`: how much wall-time and **peak RAM** does each cost? (Drives the
   "does the server RAM fit?" worry, and our per-region strategy choice.)
2. **`-R` / referenced objects** — `osmium tags-filter` default (include
   referenced, up to 3 passes) vs `-R/--omit-referenced` (1 pass): time/RAM delta.
3. **Order** — for our *sparse* tag set (boundaries + a few POIs), is it cheaper to
   **region-then-tag** (cut the area first, then filter) or **tag-then-region**
   (filter the whole country first, then cut)?

## Method — how we log RAM, timing, logging

- **Input:** the Germany extract (`germany-latest.osm.pbf`, ~4.4 GB), symlinked at
  [`data/input/germany-latest.osm.pbf`](data/input/) (gitignored). It's a good
  proxy: osmium's RAM is driven by the **node-ID space** (a bitmap ~`maxNodeID/8`),
  which is global, so a country file exercises realistic memory while running fast.
- **Sub-region:** a Hessen-ish bbox (`7.77,49.39,10.24,51.66`) — the same region
  the real `spieli` project targets.
- **Tags:** the union of our real projects (admin boundaries + playground POIs),
  defined once in [`lib.sh`](lib.sh).
- **Per osmium step we record** (via `/usr/bin/time -f '%e %M %x'`): wall seconds
  (`%e`), **peak resident set size** (`%M`, KB), exit status, and the output file
  size. Each step's raw osmium stdout/stderr goes to `work/<scenario>.<step>.osmium.log`.
- **Cross-check:** at the end of each scenario we also read the container's cgroup
  `memory.peak` as `_container_peak`, to sanity-check the per-step `%M` numbers.
- Results are written as JSON Lines to `results/<scenario>.jsonl` (committed).
  [`report.ts`](report.ts) aggregates them into [`REPORT.md`](REPORT.md).

## Layout

```
Dockerfile          # debian + osmium-tool + GNU time
lib.sh              # measure() helper + shared BBOX/TAGS (runs in the container)
scenarios/*.sh      # one file per scenario; each calls measure()
run.sh              # host: build image, run scenario(s) in Docker, capture results
report.ts           # host (bun): results/*.jsonl -> REPORT.md (between AUTO markers)
results/*.jsonl     # per-scenario measurements (committed)
work/, data/        # gitignored (pbf outputs, logs, the input symlink)
```

## Run

```bash
cd experiments/performance
./run.sh                 # run ALL scenarios
./run.sh 03-strategy-smart 06-region-then-tag   # run only some
bun report.ts            # regenerate REPORT.md from whatever results exist
```

**Add a scenario without rerunning everything:** drop a new
`scenarios/NN-name.sh`, run `./run.sh NN-name`, then `bun report.ts`. Existing
`results/*.jsonl` are reused; only the new scenario runs.

> Caveat: Docker Desktop on macOS runs a Linux VM, so **wall-time is indicative,
> not absolute** (volume I/O differs from a bare server); **peak RAM** transfers
> well. Re-run on the real server before final sizing.
