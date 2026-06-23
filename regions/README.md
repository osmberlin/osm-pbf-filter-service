# regions/

The **static** region hierarchy used to make extraction fast. See PLAN.md
Part B3/B4 for the full reasoning.

## Idea

Cutting one country directly out of the ~80 GB planet means reading the whole
planet for every project. Instead we extract in layers:

```
world (the planet)  →  continent (e.g. europe)  →  country (e.g. germany)  →  project
```

The **shape** of each layer is static and lives in `regions.yaml` (+ polygon
files in `polygons/`). What is *dynamic*:

1. **Activation** — a continent/country node is only built if at least one
   project's area falls inside it. Unused continents are skipped entirely.
2. **Tag union** — each intermediate node is tag-filtered to the *union* of all
   tags required by the projects beneath it, so it stays small.

## regions.yaml

```yaml
regions:
  - id: europe
    name: Europe
    parent: world              # "world" = the full planet (no polygon)
    polygon: ./polygons/europe.poly
  - id: germany
    name: Germany
    parent: europe
    polygon: ./polygons/germany.poly
  - id: france
    name: France
    parent: europe
    polygon: ./polygons/france.poly
```

- `parent: world` marks a top-level (continent) node.
- A project references a leaf by `area.region:`, or supplies a custom polygon
  and the orchestrator auto-detects which continent/country it intersects.

## polygons/

Boundary polygons in osmium-compatible formats (`.poly` or GeoJSON). These are
**not** included yet — see [polygons/README.md](polygons/README.md) for where to
get them (Geofabrik provides ready-made `.poly` files for continents and
countries).
