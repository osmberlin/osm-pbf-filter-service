# regions/

The **static** tree used to make extraction fast: **sources** at the top,
**regions** below them. See PLAN.md Part B3/B4 for the full reasoning.

## Idea

Cutting one country directly out of a continent file means reading the whole
continent for every project. Instead we extract in layers:

```
source (Geofabrik continent, e.g. europe)  →  region (e.g. germany)  →  region (e.g. hessen)  →  project
```

The **shape** of each layer is static and lives in `regions.yaml` (+ polygon
files in `polygons/`). What is *dynamic*:

1. **Activation** — a source or region is only used if at least one project
   needs it. Unused continents are never downloaded or cut.
2. **Tag union** — each intermediate node is tag-filtered to the *union* of all
   tags required by the projects beneath it, so it stays small.

## regions.yaml

```yaml
sources:
  - id: europe
    url: https://download.geofabrik.de/europe-latest.osm.pbf
  # - id: africa            # other continents: enable when needed

regions:
  - id: germany
    name: Germany
    parent: europe            # a source id ...
    polygon: ./polygons/germany.geojson
  - id: hessen
    name: Hessen
    parent: germany           # ... or another region
    polygon: ./polygons/hessen.geojson
```

- **`sources`**: Geofabrik continent extracts, kept in the R2 bucket (and on the nightly server during a run) and updated
  daily with Geofabrik's diffs (`<url without -latest.osm.pbf>-updates/`). `url`
  must be an https `…-latest.osm.pbf` download. Only Europe is active; the other
  continents are listed commented out. Sources are processed one after another,
  so enabling more only costs disk for the files themselves.
- **`regions`**: `parent` is a source id or another region; the chain must end at
  a source. Every region needs a `polygon`. Ids must not be `world` or a source id.
- A project references a region or a source by `area.region:`. The reserved name
  `world` means "every source": the project is filtered from each source and the
  pieces are merged (`osmium merge` + `time-filter`, so the newest version wins
  where continents overlap). Custom polygons are validated but not scheduled yet.

## Polygon format & validation

Polygons are **GeoJSON** (preferred over osmium's `.poly` — it's a standard
format we can lint and reuse; osmium reads GeoJSON for `extract -p` and in the
multi-extract config). Each file **must** be a GeoJSON `Polygon` or
`MultiPolygon` (a `Feature`/`FeatureCollection` wrapping one is fine). The
orchestrator validates this on every run and **skips + reports** anything invalid
(see PLAN.md B4 / C1). Sources need no polygon.

## polygons/

See [polygons/README.md](polygons/README.md) for the committed files and where to
get more (Geofabrik provides ready-made `.poly` files for regions that can be
converted to GeoJSON).
