# CI / compute alternatives for full-planet OSM filtering

> **Status:** research note for maintainers (not a decision yet).  
> **Date:** 2026-08-05.  
> **Purpose:** Compare GitHub-hosted Actions and SaaS/CI alternatives against a dedicated Hetzner baseline for two pipelines (osmium-only extracts; osmium + daily throwaway PostGIS + pmtiles/gpkg). Prefer a GitHub-Actions-like UI for volunteer maintainers; cost is critical (no sponsors yet).  
> **Related design:** [`PLAN.md`](../PLAN.md) (self-hosted runner on FOSSGIS uMap server — not production).

Locked assumptions for this note:

1. Cover **both** pipelines: **(A)** osmium-only extracts; **(B)** osmium + osm2pgsql into a wipeable Postgres/PostGIS, then export pmtiles/GeoPackage. Final artifacts go to **S3-compatible object storage** for SaaS options (not nginx-on-same-box).
2. Preferred data pattern: **persist full planet once** (~88 GB PBF today), apply daily OSMF diffs. Continent-split + merge is a **fallback**, especially where there is no large persistent disk.
3. Resource numbers are **estimates from primary docs / measured PLAN benchmarks**, labelled as such.
4. **Cost baseline** = a dedicated new Hetzner Cloud or Dedicated server sized for the workload (what one would seek sponsorship for instead of paying SaaS).
5. Ops preference: **GHA-like UI** for a volunteer group; pure VM/SSH/Ansible = fallback.

---

## Summary recommendation

Ranked for *this* project (cost + volunteer GHA UX + full-planet persist):

| Rank | Option | Why |
| ---: | --- | --- |
| **1** | **Self-hosted GitHub Actions on a dedicated Hetzner server** (Cloud CX53/CAX41 + Volume, or Dedicated AX42/AX102) | Same UI as today; persistent planet; predictable €/mo; sponsorship story is clear. Best default if FOSSGIS shared box is blocked or undersized. |
| **2** | **Self-hosted GHA on FOSSGIS shared uMap server** (current [`PLAN.md`](../PLAN.md)) | Near-zero incremental € if admins agree; GHA UI; disk ~585 GB known. **Unknown CPU/RAM**; I/O contention with uMap; public-repo runner hardening mandatory. |
| **3** | **Buildkite (or CircleCI) self-hosted agents on the same Hetzner box** | Excellent pipeline UI; you still pay for (or sponsor) the VM. Extra platform fees vs staying on GitHub Actions — only switch if GHA self-hosted constraints bite. |
| **Avoid for full planet** | GitHub-hosted standard runners; Railway/Render **cron**; GitLab.com hosted runners as sole compute | Ephemeral/small disk, no planet persist, and/or hard job timeouts. |
| **Niche / expensive** | GitHub **larger runners** (Team+); CircleCI big Linux VMs | Can scrape by for **continent-fallback** jobs with large ephemeral SSD; **no** durable planet between runs; per-minute cost adds up; still need object storage. |
| **Artifacts only** | Cloudflare R2 or Hetzner Object Storage | Cheap for small daily pmtiles/gpkg; prefer over serving from a SaaS disk. |

**Bottom line:** Keep the **self-hosted Actions** pattern. Prefer a **dedicated Hetzner** machine as the sponsorship baseline; use FOSSGIS shared only if RAM/I/O headroom is confirmed. Do not plan Profile B (planet osm2pgsql) on GitHub-hosted or Heroku-like PaaS without persistent multi-hundred-GB disk and multi-hour runtimes.

---

## Workload profiles & resource estimates

### Upstream data sizes (primary)

| Item | Size / fact | Source |
| --- | --- | --- |
| `planet-latest.osm.pbf` | **88 GB** (weekly planet page, Aug 2026) | [planet.openstreetmap.org](https://planet.openstreetmap.org/) |
| PLAN.md figure | ~87 GB (slightly older) | [`PLAN.md` §3](../PLAN.md) |
| Re-seed headroom | Up to **~2× planet** during atomic swap (~174–176 GB) | [`PLAN.md` §A1](../PLAN.md) |
| Geofabrik Europe extract | **~32.4 GB** (`europe-latest.osm.pbf`, Aug 2026) | [download.geofabrik.de/europe.html](https://download.geofabrik.de/europe.html) |
| Daily OSMF diffs | Small vs planet (order of tens–hundreds of MB/day typical; not re-measured here) | OSM replication under planet site |

### Profile A — osmium-only (planet persist + hierarchical extracts)

| Resource | Estimate | Basis |
| --- | --- | --- |
| **Persistent disk** | **≥300 GB** comfortable; **≥400 GB** safer | Planet 88 GB + re-seed spike + intermediate continents (Europe alone ~32 GB) + work/ + extracts. PLAN: 585 GB shared disk is “comfortable” for normal days. |
| **Ephemeral / work** | Tens of GB per run (continent PBFs + filtered copies) | PLAN hierarchy; clean `work/` after run |
| **RAM** | **≥8 GB headroom** minimum; **16 GB** preferred for planet multi-extract | osmium streams; RAM driven by ID bitmaps — roughly `#extracts × (max_node_id / 8)`, ×2 for `complete_ways`, more for `smart` ([osmium-extract MEMORY USAGE](https://docs.osmcode.org/osmium/latest/osmium-extract.html)). PLAN Germany benchmark: extract peak **~4 GB**; tags-filter with refs ~2.2 GB — **re-measure on planet**. |
| **CPU** | Modest; **I/O-bound** (multiple full passes) | PLAN §B8; SSD vs HDD dominates |
| **Runtime** | Likely **1–6+ hours**/day depending on disk and active regions | Not timed on planet yet (PLAN open TODO) |
| **Network** | One-time ~88 GB download; daily small diffs | planet.openstreetmap.org |

### Profile B — A + daily osm2pgsql (throwaway DB) + pmtiles/gpkg export

| Resource | Estimate | Basis |
| --- | --- | --- |
| **Persistent disk (planet)** | Same as A (~88 GB+) | Prefer keep planet; wipe only PostGIS |
| **Scratch during import** | **Very large spike**: flat-nodes **~100 GB** + Postgres tables (slim tables historically similar size to main; peak can be much higher before `--drop`) | osm2pgsql manual: full-planet node locations in Postgres are “hundreds of GBytes”; flat-nodes stores the same in **“only” ~100 GB** ([osm2pgsql manual `--flat-nodes`](https://osm2pgsql.org/doc/manual.html)) |
| **Suggested total disk** | **≥800 GB–1.5 TB** for planet + flat-nodes + DB spike + exports | Label: **estimate** — confirm with a trial import |
| **RAM** | **≥32 GB** practical minimum; **64 GB+** preferred for full-planet daily rebuild | Manual: ≥2 GB for osm2pgsql internals + Postgres `shared_buffers`; with flat-nodes use `--cache=0` and leave RAM to OS/Postgres ([manual](https://osm2pgsql.org/doc/manual.html)). Community planet imports often use large machines; exact wall-time depends on SSD and CPU. |
| **CPU** | **8+ cores** helpful (`--number-processes`) | osm2pgsql parallel import |
| **Runtime** | Often **many hours** for full planet (can exceed 6 h on smaller boxes) | Label: **estimate** — must benchmark; rules out many hosted CI timeouts |
| **Pattern** | DB may be wiped each day (`--drop` OK if no minutely updates) | Fits throwaway PostGIS |

### Suggested minimums (decision aid)

| Profile | RAM | Local / attached disk | Notes |
| --- | ---: | ---: | --- |
| **A – osmium daily** | **16 GB** (8 GB absolute floor) | **400 GB+** SSD | Persist planet; GHA self-hosted or dedicated VM |
| **B – + osm2pgsql day-rebuild** | **64 GB** (32 GB tight) | **1 TB+** SSD | Flat-nodes + DB spike; avoid shared FOSSGIS box unless capacity proven |

---

## Comparison matrix

Prices **excl. VAT** where Hetzner states that. USD noted for US-priced SaaS. “Viable €/mo” = rough order for a config that can run Profile A (and B where noted).

| Option | Persistent planet? | RAM / CPU class | Max runtime | ~€/mo viable | Ops model | Verdict |
| --- | --- | --- | --- | ---: | --- | --- |
| GitHub-hosted standard | No (14 GB SSD) | Public: 4 vCPU / 16 GB | **6 h**/job | €0 public (standard) | GHA UI | **No** for planet |
| GitHub larger runners | No (ephemeral; up to 2040 GB SSD) | Up to 96 vCPU / 384 GB | **6 h**/job | High USD/min (Team+) | GHA UI | Continent fallback only; costly |
| Self-hosted GHA @ FOSSGIS | Yes (~585 GB disk) | **Unknown** | Self-hosted job up to **5 days** | ~€0 incremental | GHA UI + FOSSGIS ops | **Good if** RAM/I/O OK |
| Self-hosted GHA @ Hetzner Cloud | Yes (Volume 10 GB–10 TB) | e.g. CX53 16 vCPU/32 GB | 5 days | **~€53** (CX53 + 400 GB Volume + IPv4) | GHA UI + light VM | **Baseline / preferred** |
| Self-hosted GHA @ Hetzner Dedicated | Yes (NVMe; add disks) | e.g. AX42 8c/64 GB; AX102 16c/128 GB | 5 days | **~€97–257+** | GHA UI + VM | Best for **Profile B** |
| Railway | Possible (Pro volume up to 1 TB) | Hobby ≤48 GB; Pro high | Service uptime; not classic CI | High if 24/7 large RAM+disk | PaaS dashboard | Poor fit / expensive |
| Render | Worker+disk yes; **cron cannot use disk** | Instance tiers | Cron **12 h** max | Disk $0.25/GB‑mo + compute | PaaS dashboard | Awkward for planet cron |
| Fly.io | Volumes yes ($0.15/GB‑mo) | Machine sizing | Machine-dependent | Volume+compute USD | Fly CLI/UI | Possible but more ops than GHA |
| Buildkite self-hosted | Yes (your disk) | Your VM | Configurable (plan limits on hosted) | Hetzner + BK plan | **Strong CI UI** | Good peer to GHA |
| CircleCI Linux VM | No persist | Up to 32 vCPU / 128 GB; **150 GB** disk | Plan: ~1–5 h | Credits USD | Circle UI | Disk too small for planet |
| GitLab.com hosted | No persist | Up to 32 vCPU / 128 GB / **200 GB** | **3 h** hard | Compute minutes | GitLab UI | Too little disk/time |

---

## Option deep-dives

### 1. GitHub-hosted Actions — standard runners

**What it is:** Ephemeral VMs/containers managed by GitHub; free unlimited minutes on **public** repos for standard Linux runners.

**Hard limits (docs):**

| Spec | Public Linux `ubuntu-latest` | Notes |
| --- | --- | --- |
| CPU / RAM / disk | **4 vCPU, 16 GB RAM, 14 GB SSD** | [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) |
| Job execution time | **6 hours** | [Actions limits](https://docs.github.com/en/actions/reference/limits) |
| Artifact / cache storage | Plan-dependent (e.g. Free org 500 MB artifacts, 10 GB cache/repo) | Same limits page — **not** for storing a planet |

**Cost:** €0 for standard runners on public repos; private repos use included minutes then per-minute USD rates ([Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)).

**Fit:**

- Persistent planet: **impossible** (14 GB disk).
- Profile A/B full planet: **no**.
- Continent fallback: still fails for Europe alone (~32 GB) on standard disk.

**Verdict:** Use only for **lint/unit tests** (as PLAN already does). Not a compute host for OSM extracts.

---

### 2. GitHub-hosted Actions — larger runners

**What it is:** Paid, org-managed bigger VMs (GitHub **Team** or **Enterprise Cloud**). Still **ephemeral** — disk does not keep the planet between jobs.

**Specs (Linux examples):** from [larger runners reference](https://docs.github.com/en/actions/reference/runners/larger-runners):

| vCPU | RAM | SSD |
| ---: | ---: | ---: |
| 8 | 32 GB | 300 GB |
| 16 | 64 GB | 600 GB |
| 32 | 128 GB | 1200 GB |
| 64 | 256 GB | 2040 GB |

**Timeouts:** Same **6 h** job limit as other GitHub-hosted runners ([limits](https://docs.github.com/en/actions/reference/limits)).

**Cost (USD/min, always billed; not free on public repos):** e.g. Linux 16-core **$0.042**/min, 32-core **$0.082**/min ([pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)). Example: 16-core × 4 h/day × 30 d ≈ **$302/mo** before Team plan seat costs — far above a Hetzner CX53.

**Fit:**

- Full-planet **persist + daily diff**: **no** (cold start; re-download or re-hydrate every run).
- Continent fallback: **possible** on ≥300–600 GB SSD if job finishes in 6 h; still pay to re-download Geofabrik files often.
- Profile B osm2pgsql: RAM/disk may fit large SKUs, but **6 h** and cost are hostile.

**Verdict:** Emergency / experiment only. Not a sponsorship-efficient baseline.

---

### 3. Self-hosted GitHub Actions on FOSSGIS shared server (current PLAN)

**What it is:** Register the FOSSGIS uMap Hetzner box as a runner (`runs-on: [self-hosted, osm]`); nginx serves extracts. Documented in [`PLAN.md`](../PLAN.md).

**Known facts (PLAN):**

- Disk **~585 GB**, shared with uMap.
- Planet ~87–88 GB; re-seed ~2×.
- Repo **public** → self-hosted runner hardening **mandatory** (GitHub advises against self-hosted on public repos unless locked down).
- **CPU, RAM, disk type (SSD vs HDD): unknown** — confirm with FOSSGIS admins / Lars Lingner.

**Limits:** Self-hosted job execution up to **5 days**; queue 24 h ([Actions limits](https://docs.github.com/en/actions/reference/limits)).

**Cost:** ~€0 incremental if FOSSGIS hosts; political/ops cost is admin approval and coexistence.

**Fit:**

- Profile A: **plausible** if free disk and RAM headroom confirmed; I/O must not starve uMap (`nice`/`ionice`, off-peak).
- Profile B: **risky** — osm2pgsql disk spike + RAM may be incompatible with shared uMap.

**Risks:** Noisy neighbor; public-repo runner compromise; data loss if disk fills; unknown hardware.

**Verdict:** Still attractive for **Profile A** if FOSSGIS agrees. Not the sponsorship baseline; treat hardware unknowns as blockers before relying on it for production.

---

### 4. Self-hosted GitHub Actions on dedicated Hetzner (cost baseline)

**What it is:** A box you (or a sponsor) pay for; only the Actions runner + pipeline. Artifacts → object storage (or nginx if desired). Same volunteer UX as PLAN.

#### Cloud SKUs (Germany/Finland, prices from [Hetzner price adjustment 15 Jun 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/); excl. IPv4; excl. VAT)

| SKU | Specs (from [cost-optimized product page](https://www.hetzner.com/cloud/cost-optimized)) | Monthly € (excl. IPv4) |
| --- | --- | ---: |
| **CX53** | 16 vCPU, **32 GB** RAM, **320 GB** local SSD | **29.49** |
| **CAX41** | 16 vCPU Arm, **32 GB**, **320 GB** | **40.99** |
| **CPX42** | (Regular Performance line; 16 GB RAM class on product pages) | **69.49** |
| IPv4 Primary IP | +€0.50/mo | [servers overview](https://docs.hetzner.com/cloud/servers/overview/) |

Local 320 GB is **not enough** alone for planet + work + re-seed. Attach **Volumes**: 10 GB–10 TB, ≤16 volumes/server, ≤10 TB total ([Volumes overview](https://docs.hetzner.com/cloud/volumes/overview/)). Volume list price after the [15 Jun 2026 adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/): **€0.0572/GB‑mo** (excl. VAT).

**Suggested Cloud baseline — Profile A:** CX53 (€29.49) + IPv4 (€0.50) + **Volume 400 GB** (€22.88) ≈ **€52.87/mo** excl. VAT — still far below larger-runner burn rates.

**Suggested Cloud — Profile B (tight):** Prefer **64 GB+ RAM**. Cloud CCX/CPX high-RAM SKUs jumped sharply in the Jun 2026 adjustment (e.g. CCX33 **€138.49**/mo). Often **Dedicated** is clearer for B.

#### Dedicated SKUs ([price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) + [AX docs](https://docs.hetzner.com/robot/dedicated-server/server-lines/ax-server/))

| SKU | Specs | Monthly € (excl. IPv4, FSN/HEL table) |
| --- | --- | ---: |
| **AX42-1** | Ryzen 7 PRO 8700GE (8c/16t), **64 GB** DDR5, 2×512 GB NVMe | **97.30** (+ setup €49) |
| **AX102-1** | Ryzen 9 7950X3D (16c/32t), **128 GB**, 2×1.92 TB NVMe | **257.30** (+ setup €129) |
| **AX42-1-LTD** (limited) | Same family, limited stock | **77.30** |

AX42 disk (~0.5 TB usable in RAID1) may need **extra storage** for Profile B spikes; AX102 is the clearer Profile B sponsorship target.

**Ops:** Ansible once + GHA UI daily — matches volunteer preference better than “SSH every week.”

**Verdict:** **Primary recommendation** for a funded/sponsored path. Use Cloud CX53+Volume for Profile A; Dedicated AX102 (or AX42 + disks) for Profile B.

---

### 5. Railway (and similar PaaS)

**What it is:** Heroku-like deploy platform with usage billing and optional volumes ([railway.com/pricing](https://railway.com/pricing), [plans](https://docs.railway.com/pricing/plans), [volumes](https://docs.railway.com/volumes/reference)).

**Hard limits:**

| Item | Limit |
| --- | --- |
| Volume default (Pro) | **50 GB**; self-serve resize up to **1 TB**; >1 TB needs Enterprise |
| Hobby volume | **5 GB** default |
| Ephemeral storage | **100 GB** max (Hobby/Pro) |
| RAM/CPU ceilings | Hobby 48 GB / 48 vCPU; Pro much higher |
| Volume IOPS | 3000 read / 3000 write |
| Pricing | RAM **$10**/GB‑mo; CPU **$20**/vCPU‑mo; Volume **$0.15**/GB‑mo; egress **$0.05**/GB |

**Illustrative cost (not a quote):** 32 GB RAM 24/7 ≈ $320/mo RAM alone; 500 GB volume ≈ $75/mo; plus CPU and €/$ egress for planet seed — **many× Hetzner**.

**Fit:** Technically Pro can hold a planet on a resized volume, but **cost and ops model** (always-on service, not GHA) are wrong for a volunteer OSM extract bot. Cron-like scheduling is not the same as Actions run history for multi-maintainer review.

**Verdict:** **Not recommended** as primary compute. Fine only for tiny ancillary services.

#### Peer: Render

- Persistent disks: **$0.25**/GB‑mo; attach to web/private/worker — **not to cron jobs** ([disks](https://render.com/docs/disks), [cron jobs](https://render.com/docs/cronjobs)).
- Cron max runtime: **12 hours**, then killed.
- Pattern would be: always-on **background worker** with disk (billed continuously) or rebuild without persist.

**Verdict:** Same class as Railway — possible with a disk-backed worker, **expensive**, weak GHA-like UX.

#### Peer: Fly.io

- Volumes **$0.15**/GB‑mo ([Fly pricing](https://fly.io/docs/about/pricing/)).
- Good for custom Machines + volumes; more DIY than Actions.
- Viable engineering-wise for Profile A if someone wants Fly ops; still usually **pricier** than Hetzner for 24/7 large disk+RAM.

**Verdict:** Optional peer; not better than Hetzner+GHA for this group.

---

### 6. CI platforms with large / self-hosted agents

#### Buildkite

- **Self-hosted agents** run on your infrastructure (disk/RAM = your Hetzner box); excellent pipeline UI ([Buildkite vs CircleCI](https://buildkite.com/docs/pipelines/advantages/buildkite-vs-circleci), [pricing](https://buildkite.com/pricing/)).
- Free plan: limited concurrency (docs/marketing: max **3** concurrent jobs hosted & self-hosted on free tier).
- Pro: self-hosted agents included with seat pricing; hosted agents billed per vCPU-minute (e.g. Linux **$0.004**/vCPU‑min on Pro hosted — verify current pricing page).
- Timeouts: per-command `timeout_in_minutes`; Personal plan hosted has a **4 h** cap mentioned in [build timeouts](https://buildkite.com/docs/pipelines/configure/build-timeouts); self-hosted governed by your settings/org max.

**Fit:** Full planet **yes** if agent is on Hetzner. Ops: learn Buildkite + still maintain the VM. Worth it if the team wants Buildkite features; **not required** if GitHub Actions self-hosted already fits.

**Verdict:** Strong alternative UI on top of the same baseline hardware.

#### CircleCI (resource classes)

- Linux VM (`machine`): **150 GB** disk all classes; Gen2 up to **32 vCPU / 128 GiB** ([Linux VM docs](https://circleci.com/docs/guides/execution-managed/using-linuxvm/)).
- Job time limits by plan (commonly **1 h Free / 3 h Performance / 5 h Scale** — confirm on [configuration reference](https://circleci.com/docs/reference/configuration-reference/) / pricing for your plan).
- **No** durable planet between jobs; 150 GB < planet + work.

**Verdict:** Hosted CircleCI **cannot** hold the planet. Self-hosted CircleCI runner ≈ same as GHA self-hosted (extra product to learn).

#### GitLab.com hosted runners

- Largest Linux amd64: **32 vCPU / 128 GB / 200 GB** disk; default small **30 GB** ([hosted Linux runners](https://docs.gitlab.com/ci/runners/hosted_runners/linux/)).
- Jobs on GitLab.com hosted runners **time out after 3 hours** ([hosted runners overview](https://docs.gitlab.com/ci/runners/hosted_runners/)).
- 200 GB still tight for planet + intermediates; 3 h may be too short for Profile B.

**Verdict:** Not sufficient as sole full-planet host. GitLab **self-hosted** runner on Hetzner would work but migrates the whole project off GitHub.

---

### 7. Optional: DigitalOcean / AWS / Scaleway (brief)

| Provider | Why mention | Verdict for this project |
| --- | --- | --- |
| **DigitalOcean Droplet + Spaces** | Familiar VPS + object storage | Usually **more €/$** than Hetzner for same RAM/disk; fine if DO credits appear |
| **AWS EC2 + EBS (Spot)** | Huge SKU catalog; Spot savings | Ops-heavy; egress from S3 expensive; overkill for volunteers |
| **Scaleway** | EU competitor to Hetzner | Reasonable peer; compare € only if Hetzner unavailable |

None beat **Hetzner + self-hosted GHA** on cost + volunteer UX for this workload, given current Hetzner Cloud/Dedicated list prices.

---

## Fallback: continent-split on GitHub-hosted Actions

**Idea:** Skip storing the planet in CI. Each job downloads Geofabrik (or similar) continent/country PBFs, runs osmium extract/tags-filter, uploads artifacts to R2/S3.

**How it would work:**

1. Matrix (or chained jobs) per continent needed by projects.
2. `curl`/`aria2c` Geofabrik PBF → osmium → upload pmtiles/gpkg/PBF to object storage.
3. Optional merge job for multi-continent projects.

**Where it still fails / hurts:**

| Issue | Detail |
| --- | --- |
| Standard runner disk | **14 GB** — cannot hold Europe (**32.4 GB**) |
| Larger runner disk | Need **≥8‑core / 300 GB+** class; still ephemeral |
| No `pyosmium-up-to-date` on a local planet | Re-download or depend on Geofabrik freshness daily |
| Merge step | Merging continent outputs needs disk = sum of inputs; time adds up toward **6 h** |
| Cost | Larger runners: dollars per minute; repeated multi‑GB downloads |
| Profile B | osm2pgsql on Europe alone is large; full-planet osm2pgsql **out of scope** for this fallback |

**Verdict:** Acceptable **degraded mode** for sparse, single-continent projects on **larger runners** or a small VPS — not a replacement for the PLAN architecture.

---

## Object storage for artifacts

Goal: store **small daily** project extracts (pmtiles, gpkg, filtered PBF), **not** the planet.

| Provider | Storage | Egress | Notes |
| --- | --- | --- | --- |
| **Cloudflare R2** | **$0.015**/GB‑mo Standard; **10 GB** free | **Free** egress | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) — best for public download traffic |
| **Hetzner Object Storage** | Base **€6.49**/mo (post–Jun 2026; was €4.99 at launch) includes ~1 TB storage + ~1 TB egress; overage **€0.0087**/TB‑hour storage, **€1**/TB egress | S3 API calls free; ingress free | [Price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) + [docs overview](https://docs.hetzner.com/storage/object-storage/overview/); [launch press](https://www.hetzner.com/pressroom/object-storage/) had €4.99 |
| **AWS S3** | Region-dependent Standard storage (see [S3 pricing](https://aws.amazon.com/s3/pricing/)) | Internet egress typically **dominates** at scale | Avoid unless already on AWS; R2/Hetzner better for public OSM artifacts |

**For small daily artifacts (e.g. total retained ≪ 10–50 GB, modest download traffic):** R2 free tier or Hetzner base package is **cheap — often a few €/$/mo or less**. Egress is the usual SaaS trap; R2 removes it; Hetzner includes 1 TB.

---

## Open questions / next decisions

1. **Confirm FOSSGIS uMap CPU / RAM / SSD** — gates Rank 2 vs Rank 1.
2. **Profile A vs B in production MVP** — if B is required day‑1, size for **AX102-class** (or Cloud with ≥64 GB + ≥1 TB volume), not CX53 alone.
3. **Benchmark** planet `osmium extract` wall time + peak RSS on candidate hardware (PLAN TODO).
4. **Trial osm2pgsql** on a filtered extract, then Europe, before committing to daily full-planet import.
5. **Sponsorship ask:** “Hetzner CX53 + 400 GB Volume ≈ **€53/mo** excl. VAT” (Profile A) or “AX102 ≈ **€257/mo**” (Profile B) as the concrete alternative to SaaS quotes.
6. **Stay on GitHub Actions** unless multi-maintainer UX problems appear — switching to Buildkite adds platform cost without removing the VM.
7. **Artifact bucket:** prefer **R2** (zero egress) or **Hetzner Object Storage** (EU, simple base fee).
8. **Public-repo runner security** remains mandatory on any self-hosted option (PLAN §A3).

---

## Sources

1. [planet.openstreetmap.org](https://planet.openstreetmap.org/) — planet PBF **88 GB** (fetched 2026-08-05).
2. [Planet.osm — OSM Wiki](https://wiki.openstreetmap.org/wiki/Planet.osm) — size commentary / PBF guidance.
3. [Geofabrik Europe downloads](https://download.geofabrik.de/europe.html) — Europe **32.4 GB**.
4. [`PLAN.md`](../PLAN.md) — FOSSGIS server ~585 GB, architecture, osmium RAM notes, Germany benchmark ~4 GB.
5. [osmium-extract(1)](https://docs.osmcode.org/osmium/latest/osmium-extract.html) — strategies, memory usage formula, hierarchical extract advice.
6. [osm2pgsql manual](https://osm2pgsql.org/doc/manual.html) — `--flat-nodes` ~100 GB, `--cache`, `--drop`, RAM guidance.
7. [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) — 4 vCPU / 16 GB / 14 GB (public Linux).
8. [Larger runners reference](https://docs.github.com/en/actions/reference/runners/larger-runners) — CPU/RAM/SSD table.
9. [Actions limits](https://docs.github.com/en/actions/reference/limits) — 6 h hosted / 5 d self-hosted job time.
10. [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) — per-minute USD rates.
11. [Hetzner price adjustment 15 June 2026](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) — Cloud + Dedicated list prices; Volume **€0.0572/GB‑mo**; Object Storage base **€6.49**/mo.
12. [Hetzner Cloud cost-optimized](https://www.hetzner.com/cloud/cost-optimized) — CX53/CAX41 vCPU/RAM/disk.
13. [Hetzner Cloud servers overview](https://docs.hetzner.com/cloud/servers/overview/) — IPv4 €0.50, limits.
14. [Hetzner Volumes overview](https://docs.hetzner.com/cloud/volumes/overview/) — 10 GB–10 TB, IOPS; price pointer to block-storage page.
15. [Hetzner block storage product](https://www.hetzner.com/cloud/block-storage) — volume product page.
16. [Hetzner AX server line](https://docs.hetzner.com/robot/dedicated-server/server-lines/ax-server/) — AX42/AX102 hardware matrix.
17. [Hetzner AX42 product](https://www.hetzner.com/dedicated-rootserver/ax42) — 64 GB / 2×512 GB NVMe.
18. [Railway volumes reference](https://docs.railway.com/volumes/reference) — size caps, 1 TB Pro self-serve.
19. [Railway pricing plans](https://docs.railway.com/pricing/plans) — RAM/CPU/volume/egress rates.
20. [Railway pricing](https://railway.com/pricing) — plan overview.
21. [Render disks](https://render.com/docs/disks) — $0.25/GB‑mo; no disk on cron.
22. [Render cron jobs](https://render.com/docs/cronjobs) — 12 h max run; no persistent disk.
23. [Render pricing](https://render.com/pricing) — disk and compute positioning.
24. [Fly.io resource pricing](https://fly.io/docs/about/pricing/) — volumes $0.15/GB‑mo.
25. [Buildkite pricing](https://buildkite.com/pricing/) — plans / agent concurrency.
26. [Buildkite build timeouts](https://buildkite.com/docs/pipelines/configure/build-timeouts) — timeout behavior.
27. [CircleCI Linux VM execution](https://circleci.com/docs/guides/execution-managed/using-linuxvm/) — 150 GB disk; resource classes.
28. [GitLab hosted runners (Linux)](https://docs.gitlab.com/ci/runners/hosted_runners/linux/) — machine types / disk.
29. [GitLab hosted runners overview](https://docs.gitlab.com/ci/runners/hosted_runners/) — 3 h timeout on GitLab.com.
30. [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) — storage + free egress.
31. [Hetzner Object Storage docs](https://docs.hetzner.com/storage/object-storage/overview/) — billing model, free API/ingress.
32. [Hetzner Object Storage press release](https://www.hetzner.com/pressroom/object-storage/) — launch €4.99 base (superseded by Jun 2026 adjustment).
33. [Hetzner Object Storage product](https://www.hetzner.com/storage/object-storage/) — product FAQ.
34. [AWS S3 pricing](https://aws.amazon.com/s3/pricing/) — storage/egress model (region UI).

### Claims not fully verified from static primary sources

- **AWS S3 Standard €/GB in eu-central-1** — pricing page is region-selector UI; use calculator for a quote (egress remains the main risk).
- **Full-planet osm2pgsql wall-clock** on 2026 hardware — not re-benchmarked here; treat runtime as **must measure**.
- **Peak RSS for osmium multi-extract on full planet** — PLAN measured Germany only; planet estimate labelled.
- **Buildkite Free vs Pro exact seat/agent line items** — pricing page is interactive; confirm before committing.
- **CircleCI job hour caps per current plan name** — documented in config reference / pricing; verify against the org’s plan.
- **FOSSGIS uMap CPU/RAM/disk type** — explicitly unknown in PLAN.
