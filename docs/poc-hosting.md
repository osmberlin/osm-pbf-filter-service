# Hosting: research and decision

> **Decision (2026-10-26): a throwaway Hetzner server per night plus Cloudflare
> R2 for storage and delivery.** Each night `daily.yml` (GitHub-hosted runner)
> creates a Hetzner server (cpx42 / ccx33 / cpx52 across nbg1 / hel1 / fsn1,
> whichever is available), installs the toolchain with our Ansible role, builds
> the extracts, pushes sources and extracts to R2 and always deletes the server.
> No self-hosted runner, no nginx. Current design: [PLAN.md](../PLAN.md); setup:
> [setup.md](setup.md).
>
> **Why not an always-on server** (the decision of 2026-10-25, CX43 at ~€16/month,
> is withdrawn): the cheap CX line is "currently not available" and CPX42
> (8 vCPU / 16 GB) is about **€83/month incl. VAT**.
>
> **Why R2:** no location lock (the server can start wherever a type is
> available), ~$0.015/GB-month, free egress (we move the continent files every
> night). **Not a Hetzner Volume** (tied to one location) and **not Hetzner Object
> Storage** (€6.49+ base fee; its 1 TB of included traffic would be used up by our
> own nightly transfers). It is the same S3 API, so switching later is just
> endpoint + keys.
>
> **Cost:** server ~€0.13/h × 1–2 h/night = about **€4–8/month**, R2 about
> **$1–2/month**. Hetzner prices change; re-check before relying on this.
>
> **Rejected:** the always-on server (~€83/month); free GitHub-hosted runners for
> the whole job like Kyle's setup (does not scale to Europe, ToS grey area, only
> weekly).
>
> The shared FOSSGIS uMap server variant stays paused (see
> [server/ansible/README.md](../server/ansible/README.md)); the role's
> `osm_serve: true` mode is the path for a long-lived server later.
>
> **How to read the rest of this page:** it is the original research (a proof of
> concept without a permanent server) and is kept as background. Most of it is
> still valid, but parts are superseded: the Hetzner CX43 price (€0.026/h, ~€16/month)
> and the CX line in general (not available any more), and the "proposal" at the
> end (S3 upload from a free runner). Prices excl. VAT, fetched from official
> pricing pages on 2026-10-25.

## Goal (original)

Show that the pipeline works and is useful, first for a **small area (Berlin or
Germany)**, without a permanently running server:

- **Compute only at night**, for the duration of the job, paid by the hour (or free).
- **Static files on S3-compatible storage**, so nothing needs to stay online for downloads.

## What the job needs (measured)

From [experiments/performance](../experiments/performance/README.md) (Germany,
osmium 1.15, Docker on a laptop) and the local end-to-end test:

| Input | Size | osmium time | Peak RAM |
|---|---|---|---|
| Berlin (Geofabrik) | ~100 MB | seconds | < 1 GB |
| Germany (Geofabrik) | ~4.9 GB | ~1 min per extract pass | ~4–5 GB |
| Europe (Geofabrik) | ~35 GB | not measured | not measured |
| Planet (OSMF) | ~96 GB | not measured; hours | 16–32 GB (estimate) |

**Input source:** Geofabrik regional extracts, updated daily, with daily diffs
(`…/germany-updates/`, `…/berlin-updates/`) that pyosmium can apply. One download
per night is the polite pattern. OpenStreetMap France has no Berlin extract, and
its robots.txt disallows automated `.pbf` downloads.

## Option 1: free GitHub-hosted runner (recommended for the PoC)

The nightly workflow runs on `ubuntu-latest`. It downloads the Geofabrik extract,
runs the orchestrator and uploads the results to S3. No server at all.

| | |
|---|---|
| Runner (public repo) | 4 vCPU, 16 GB RAM, 14 GB SSD (more can be freed), 6 h job limit |
| Toolchain | `apt install osmium-tool python3-pyosmium python3-yaml` (Ubuntu 24.04: osmium 1.16, pyosmium 3.7) |
| Berlin | trivial |
| Germany | fits: 4.9 GB input + intermediates, delete as we go |
| Europe / planet | **does not fit** (disk) |
| Cost | **€0** |

Caveats:
- **GitHub ToS grey area.** GitHub-hosted runners are meant for "production,
  testing, deployment, or publication of the software project". A nightly data job
  that publishes our own extracts is arguable for a PoC, not for permanent operation.
- Scheduled workflows are disabled after **60 days without repo activity**, and
  cron can be delayed under load.
- Each run re-downloads the extract. `actions/cache` (10 GB per repo, evicted after
  7 days unused) could keep Germany between runs, but it adds complexity. Skip it for the PoC.

## Option 2: rent a server by the hour (for Europe / the world, or after the PoC)

> Closest to what we now do, except that we create the server ourselves with Ansible
> instead of an ephemeral runner action. The CX43 figures below are superseded
> (CX line not available).

The same workflow, but `runs-on` an **ephemeral self-hosted runner** that a
first job creates through the cloud API and a last job deletes.

| Provider | Billing | ~4 vCPU / 16 GB | ~8 vCPU / 32 GB | 30 runs × 1 h | Runner automation |
|---|---|---|---|---|---|
| **Hetzner Cloud** | per started hour | CX43 (8 shared vCPU/16 GB, 160 GB NVMe) €0.026/h; CCX23 (dedicated) €0.138/h | CCX33 (240 GB NVMe) €0.222/h | **€0.80–4** (16 GB), €6.70 (32 GB) | [Cyclenerd/hcloud-github-runner](https://github.com/Cyclenerd/hcloud-github-runner) (maintained) |
| Scaleway | per hour | GP1-XS €0.093/h | GP1-S €0.191/h | ~€3.30 (16 GB) | own `scw` CLI script |
| IONOS Cloud | per minute (Cubes; VMs unconfirmed) | €0.080/h | €0.160/h | ~€2.40 + disk | own `ionosctl` script |
| AWS EC2 Frankfurt | per second | m7i.xlarge $0.24/h (spot ~$0.13) | m7i.2xlarge $0.48/h | ~$4.40 spot, $7.80 on demand + EBS/IPv4 | [machulav/ec2-github-runner](https://github.com/machulav/ec2-github-runner) (most mature) |

Runtime cost is small for all of them. **Hetzner** wins on automation (a
maintained runner action), local NVMe, and price. Always delete the server **and**
its primary IPv4 after the run: Hetzner bills stopped servers and unattached IPs.

**The world on Option 2:** the 96 GB planet should not be downloaded every night.
Keep it on a persistent **Hetzner Volume** (~200 GB, roughly €9/month) attached to
each night's server and apply the daily diffs. Estimate for the world:
**~€10–30/month**, compute + volume. Runtime needs measuring first.

## Storage for the results (S3-compatible)

| Provider | Storage | Egress | 10 GB + 50 GB/mo | 10 GB + 500 GB/mo | Custom domain |
|---|---|---|---|---|---|
| **Cloudflare R2** | $0.015/GB, first 10 GB free | **free** | $0 | $0 | yes (Cloudflare TLS), bucket-scoped tokens |
| Scaleway (One Zone) | €0.008/GB | 75 GB free, then €0.01/GB | €0.08 | ~€4.30 | not documented (unverified) |
| Hetzner Object Storage | €6.49/mo flat incl. 1 TB storage + 1 TB egress | incl. | €6.49 | €6.49 | not documented (unverified) |
| IONOS S3 | ~$0.005/GB | first 2 TB free | ~$0.05 | ~$0.05 | unverified |
| AWS S3 Frankfurt | $0.0245/GB | $0.09/GB | ~$0.25 | ~$36 | via CloudFront (extra) |

All of them speak the S3 API (`aws s3` / `rclone` from a workflow). GitHub
Releases also works as free hosting for a demo (files under 2 GiB,
`…/releases/latest/download/<file>`), but heavy automated downloads risk GitHub's
"excessive bandwidth" rule, and there's no custom domain.

## Proposal (superseded by the decision above)

1. **PoC now: Option 1 + Cloudflare R2, area Germany (start with Berlin).** Cost
   €0. Setup: a Cloudflare account, one bucket, one bucket-scoped token stored as
   two GitHub secrets. Secrets are private, so env is right here.
   - EU-only alternative for storage: Scaleway One Zone or IONOS S3 (cents per month).
2. **Code changes for the PoC** (small, the planner stays):
   - Input = Geofabrik extract instead of the planet. The region tree's root is
     "the input file" instead of "world".
   - Update step: download the extract (later: cache + daily diffs).
   - Publish step: upload `latest.osm.pbf`, `status.json` and `index.json` to S3
     instead of the nginx folder. `PUBLIC_BASE` becomes the bucket's public URL.
   - Workflow `daily.yml` on `ubuntu-latest`; drop the disk guard and the planet seed.
3. **After the PoC:** measure Germany on the runner, then decide whether Europe or
   the world is worth it. If yes, switch `runs-on` to an ephemeral Hetzner runner
   (Option 2) with a persistent volume for the planet. Keep a FOSSGIS-hosted forge
   with Actions runners in mind as the community-infrastructure route.
