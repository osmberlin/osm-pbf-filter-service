# osm-pbf-filter-service

A service that keeps a daily-updated OpenStreetMap planet file on a community
server and produces small, per-project regional `.osm.pbf` extracts (filtered by
area **and** by tags) that projects can download over stable public URLs.

The design goal is **minimal manual server work**: configuration lives in this
git repository, and all orchestration runs through CI on a self-hosted runner
installed on the community server.

> **Status: pre-alpha.** The planning logic in `src/` is implemented and
> unit-tested (`bun run test`, run in CI on GitHub-hosted runners). The osmium
> **execution** path (`scripts/`, `server/`, runner workflows) exists but has not
> been run end-to-end yet. No polygons are committed, so a live run is not wired up.

## Start here

- **[PLAN.md](PLAN.md)** — the full design, split into:
  - Part A — Server provisioning (the infrastructure)
  - Part B — How the application works (data lifecycle, configs, the extractor)
  - Part C — CI/CD workflows
- **[ZUSAMMENFASSUNG.de.md](ZUSAMMENFASSUNG.de.md)** — kurze deutsche
  Zusammenfassung für die FOSSGIS-Runde.
- **[projects/](projects/)** — one folder per project; each defines the area and
  tags it needs. See [projects/README.md](projects/README.md).
- **[regions/](regions/)** — the static region hierarchy (world → continents →
  countries) used to speed up extraction. See [regions/README.md](regions/README.md).

## How it works in one paragraph

Each project declares an **area** (a region from the hierarchy or a custom
polygon) and a set of **tag filters** (osmium syntax). A Bun orchestrator reads
all project configs, figures out which continents/countries are actually needed,
computes the **union of tags** required at each level, and runs `osmium` from the
top down (world → continent → country → project) so every intermediate extract is
as small as possible. Results are served by nginx with a `status.json` next to
each file describing how old the data is.
