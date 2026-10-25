# osm-pbf-filter-service

A service that keeps a daily-updated OpenStreetMap planet file on a community
server and produces small, per-project regional `.osm.pbf` extracts (filtered by
area **and** by tags) that projects can download over stable public URLs.

The design goal is **minimal manual server work**: configuration lives in this
git repository, and all orchestration runs through CI on a self-hosted runner
installed on the community server.

> **Status: pre-alpha.** The orchestrator in `extractor/` (Python) is implemented
> and unit-tested (`python3 -m unittest`, run in CI on GitHub-hosted runners). The osmium
> **execution** path (`scripts/`, `server/`, runner workflows) exists but has not
> been run on the server yet. A local end-to-end run works (see below); only the
> Neukölln test polygon is committed so far.

## Start here

- **[PLAN.md](PLAN.md)** — the full design, split into:
  - Part A — Server provisioning (the infrastructure)
  - Part B — How the application works (data lifecycle, configs, the extractor)
  - Part C — CI/CD workflows
- **[docs/poc-hosting.md](docs/poc-hosting.md)** — current direction: proof of
  concept on hourly/free compute + S3 (research, costs, proposal).
- **[docs/admin-setup.md](docs/admin-setup.md)** — step-by-step setup session with
  the server admin (server vs. GitHub steps, test, debugging).
- **[ZUSAMMENFASSUNG.de.md](ZUSAMMENFASSUNG.de.md)** — kurze deutsche
  Zusammenfassung für die FOSSGIS-Runde.
- **[projects/](projects/)** — one folder per project; each defines the area and
  tags it needs. See [projects/README.md](projects/README.md).
- **[regions/](regions/)** — the static region hierarchy (world → continents →
  countries) used to speed up extraction. See [regions/README.md](regions/README.md).

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

Each project declares an **area** (a region from the hierarchy or a custom
polygon) and a set of **tag filters** (osmium syntax). A Python orchestrator reads
all project configs, figures out which continents/countries are actually needed,
computes the **union of tags** required at each level, and runs `osmium` from the
top down (world → continent → country → project) so every intermediate extract is
as small as possible. Results are served by nginx with a `status.json` next to
each file describing how old the data is.

## Local end-to-end test

Needs Python 3.11+ with PyYAML and `osmium` on PATH. To keep your system Python
untouched, run it through a throwaway environment, e.g.
`OSM_ROOT=/tmp/osm uv run --no-project --with pyyaml python -m extractor`.
Any `.osm.pbf` can stand in for the planet, e.g. a Geofabrik Berlin extract for
the `test-neukoelln` project:

```bash
mkdir -p /tmp/osm/planet && ln -s ~/Downloads/berlin-latest.osm.pbf /tmp/osm/planet/planet.osm.pbf
OSM_ROOT=/tmp/osm python3 -m extractor   # -> /tmp/osm/extracts/test-neukoelln/latest.osm.pbf
```

This writes `plan.json` and `status/` into the repo; don't commit them from a
local run.
