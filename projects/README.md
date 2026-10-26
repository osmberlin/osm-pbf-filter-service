# projects/

One subfolder per project. The folder name is the project id and the path
segment in the download URL. The data file is always published as `latest.osm.pbf`
in the public R2 bucket (`extracts/` prefix):

```
https://<bucket-host>/extracts/<project-id>/latest.osm.pbf
```

```
projects/
  <project-id>/
    config.yaml        # required — area + tag filters
    area.geojson       # optional — custom Polygon/MultiPolygon, if not using a named region
```

## Ownership

Each project folder belongs to its project. This repo only collects them so the
extracts can run centrally. A folder may carry its own `LICENSE` or a reference
to where its filter list comes from (see `openseamap-vector/config.yaml`).
Changes to a folder should come from, or be agreed with, the project's `contact`.

## config.yaml schema

```yaml
# No `name:` field — the project id is the FOLDER name (and the URL segment).
# No output filename either — the file is always `latest.osm.pbf`. Both are
# derived, so they can't drift out of sync.

description: One line about what this extract is for.
repository: https://github.com/org/project   # this project's source repository
homepage:   https://project.example.org       # public URL of the project
contact:    github-user                        # GitHub user/org of the maintainer

# Convention: the project folder name = the GitHub repository name, and
# `contact` = the GitHub user/org that owns it.

# WHERE to extract. Choose exactly one of `region` or `polygon`.
area:
  region: germany                # a region or source id from regions/regions.yaml,
                                 # or `world` (filtered from every source, then merged)
  # polygon: ./area.geojson      # OR a custom GeoJSON Polygon/MultiPolygon.
                                 # Validated on each run; invalid geometry is
                                 # skipped + reported in the Action (see PLAN.md B4).
                                 # Not scheduled yet: such projects are skipped with a warning.

# WHAT to keep. osmium tags-filter expressions.
# Syntax: [object-types/]key[=value[,value...]]
#   object-types: any of n (node) w (way) r (relation), e.g. nwr/
#   key only        -> nwr/amenity         (any value of amenity)
#   key=value       -> nwr/amenity=playground
#   value list      -> nwr/amenity=playground,kindergarten
# An empty/omitted filters list means "keep everything in the area"
# (this disables the tag-union optimisation for this project's branch).
filters:
  - nwr/amenity=playground

# osmium tuning (optional; sensible defaults applied by the orchestrator)
osmium:
  extract_strategy: complete_ways   # complete_ways | smart | simple
  add_referenced: true              # keep nodes/members referenced after tag-filter
```

The `description`, `repository`, `homepage` and `contact` fields are copied into
the published `status.json`, so every download is traceable to an owner.

See the worked examples in this folder:

- [`osm-boundary-check/`](osm-boundary-check/config.yaml) — admin boundaries, Germany (illustrative)
- [`playgrounds-france/`](playgrounds-france/config.yaml) — playgrounds, France (illustrative)
- [`spieli/`](spieli/config.yaml) — **real project**: playground POIs for Hessen,
  modeled on the [spieli importer](https://github.com/mfuhrmann/spieli)
- [`osm-boundary-checker-germany/`](osm-boundary-checker-germany/config.yaml) —
  **real project**: admin + postal-code boundaries for Germany, modeled on
  [osm-boundary-checker-germany](https://github.com/osmberlin/osm-boundary-checker-germany)

Together they demonstrate the optimisation: both sit under the **Europe** source,
so the `germany` and `france` regions are cut from it in one pass and each is
tag-filtered to the **union** of its projects' tags before the final per-project
filter.

`area: {region: world}` reads every active source and merges the pieces; with
only Europe active it behaves like `region: europe`.
