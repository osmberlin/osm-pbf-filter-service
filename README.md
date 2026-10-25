# osm-pbf-filter-service

A service that keeps Geofabrik continent extracts of OpenStreetMap up to date
on a server and produces small, per-project regional `.osm.pbf` extracts (filtered
by area **and** by tags) that projects can download over stable public URLs.

The design goal is **minimal manual server work**: configuration lives in this
git repository, and all orchestration runs through CI on a self-hosted runner
installed on our server.

> **Status: pre-alpha.** Decided 2026-10-25: we run on our **own Hetzner Cloud
> CX43** (8 vCPU, 16 GB RAM, 160 GB NVMe, ~€16/month) with nginx serving the
> extracts, and **Europe** (Geofabrik) as the only input for now; more continents
> can be enabled later. The shared FOSSGIS uMap server variant is paused. The
> orchestrator in `extractor/` (Python) is implemented, unit-tested
> (`python3 -m unittest`, run in CI on GitHub-hosted runners) and has run
> end-to-end locally, but the pipeline has not run on the server yet.

## Start here

- **[PLAN.md](PLAN.md)** — the full design, split into:
  - Part A — Server provisioning (the infrastructure)
  - Part B — How the application works (data lifecycle, configs, the extractor)
  - Part C — CI/CD workflows
- **[docs/poc-hosting.md](docs/poc-hosting.md)** — current direction: own
  Hetzner CX43 + nginx, Europe as input (decision, research, costs).
- **[docs/server-setup.md](docs/server-setup.md)** — step-by-step server setup
  (server vs. GitHub steps, test, debugging).
- **[ZUSAMMENFASSUNG.de.md](ZUSAMMENFASSUNG.de.md)** — kurze deutsche
  Zusammenfassung für die FOSSGIS-Runde.
- **[projects/](projects/)** — one folder per project; each defines the area and
  tags it needs. See [projects/README.md](projects/README.md).
- **[regions/](regions/)** — the sources (Geofabrik continents) and the
  region hierarchy below them (countries, …) used to speed up extraction. See [regions/README.md](regions/README.md).

## GitHub repository settings (done 2026-10-25)

The repo is public, and a nightly job may run on a machine we control, so code
from strangers must never run there. Set in the GitHub UI:

- **Settings → General → Features → Pull requests → "Creation allowed by:
  Collaborators only".** Outsiders can read PRs but can't open them, which also
  closes the "PR brings its own workflow file" path. Outside projects submit
  their config via an issue, or get added as collaborators.
- **Settings → Actions → General → "Approval for running fork pull request
  workflows from contributors" → "Require approval for all external
  contributors".** Second safeguard in case PRs are opened up again later.

Anyone with write access can change workflows, so keep the collaborator list to
people you'd also trust on the server.

## How it works in one paragraph

Each project declares an **area** (a region, a whole source, `world`, or later a
custom polygon) and a set of **tag filters** (osmium syntax). The input is a set
of **sources**: Geofabrik continent extracts kept on the server and updated daily
with Geofabrik's diffs (`python3 -m extractor update`). A Python orchestrator
(`python3 -m extractor build`) reads all project configs, figures out which
sources and regions are actually needed, computes the **union of tags** required
at each level, and runs `osmium` from the top down (source → region → project) so
every intermediate extract is as small as possible. Sources are processed one
after another with cleanup in between; `world` projects are filtered from every
source and merged. Results are served by nginx with a `status.json` next to each
file describing how old the data is.

## Local end-to-end test

Needs Python 3.11+ with PyYAML and `osmium` on PATH. To keep your system Python
untouched, run it through a throwaway environment: prefix the commands with
`uv run --no-project --with pyyaml`. Any `.osm.pbf` can stand in for the Europe
source; symlink an existing file instead of downloading one (a Germany file
covers the sample projects, a Berlin file the `test-neukoelln` project):

```bash
mkdir -p /tmp/osm/sources && ln -s ~/Downloads/germany-latest.osm.pbf /tmp/osm/sources/europe.osm.pbf
OSM_ROOT=/tmp/osm uv run --no-project --with pyyaml python -m extractor build
# -> /tmp/osm/extracts/<project>/latest.osm.pbf
```

`python3 -m extractor build --dry-run` only writes `plan.json`. `update` and
`seed` download from Geofabrik, so skip them locally. `build` writes `plan.json`
and `status/` into the repo; don't commit them from a local run.
