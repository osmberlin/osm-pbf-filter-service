# regions/polygons/

Boundary polygons referenced by `../regions.yaml`, as **GeoJSON**.

Each file must be a GeoJSON **`Polygon`** or **`MultiPolygon`** (a
`Feature`/`FeatureCollection` wrapping one is accepted). The orchestrator
validates this on every run and **skips + reports** invalid geometry in the
Action (see PLAN.md B4 / C1).

These files are intentionally **not committed yet** (decision pending — see
PLAN.md "Open questions"). They are small enough to commit, and committing them
keeps the hierarchy fully reproducible.

## Where to get them

- **Geofabrik** publishes ready-made `.poly` files for continents and most
  countries: <https://download.geofabrik.de/> (each region page links a `.poly`).
  Convert `.poly` → GeoJSON (e.g. with a small script or an existing
  poly↔geojson converter) before committing here.
- Or export GeoJSON directly from administrative boundaries.

## Expected files (matching the example regions.yaml)

```
europe.geojson
africa.geojson
germany.geojson
france.geojson
```
