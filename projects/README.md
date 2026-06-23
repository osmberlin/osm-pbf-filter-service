# projects/

One subfolder per project. The folder name is the project id and the path
segment in the download URL. The data file is always served as `latest.osm.pbf`:

```
https://<host>/extracts/<project-id>/latest.osm.pbf
```

```
projects/
  <project-id>/
    config.yaml        # required — area + tag filters
    area.geojson       # optional — custom Polygon/MultiPolygon, if not using a named region
```

## config.yaml schema

```yaml
# No `name:` field — the project id is the FOLDER name (and the URL segment).
# No output filename either — the file is always `latest.osm.pbf`. Both are
# derived, so they can't drift out of sync.

description: One line about what this extract is for.
repository: https://github.com/org/project   # this project's source repository
homepage:   https://project.example.org       # public URL of the project
contact:    osm_username                       # OSM username of a contact person

# WHERE to extract. Choose exactly one of `region` or `polygon`.
area:
  region: germany                # an id from regions/regions.yaml
  # polygon: ./area.geojson      # OR a custom GeoJSON Polygon/MultiPolygon.
                                 # Validated on each run; invalid geometry is
                                 # skipped + reported in the Action (see PLAN.md B4).

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

See the two worked examples in this folder:

- [`osm-boundary-check/`](osm-boundary-check/config.yaml) — admin boundaries, Germany
- [`playgrounds-france/`](playgrounds-france/config.yaml) — playgrounds, France

Together they demonstrate the optimisation: both sit under **Europe**, so the
Europe intermediate extract is built once with the **union** of their tags
(`boundary`, `admin_level`, `amenity=playground`), then Germany and France are
cut from that smaller Europe file.
