# regions/polygons/

Boundary polygons referenced by `../regions.yaml`, as **GeoJSON**.

Each file must be a GeoJSON **`Polygon`** or **`MultiPolygon`** (a
`Feature`/`FeatureCollection` wrapping one is accepted). The orchestrator
validates this on every run and **skips + reports** invalid geometry in the
Action (see PLAN.md B4 / C1).

| File | Source |
|---|---|
| `germany.geojson`, `france.geojson`, `hessen.geojson` | Geofabrik `.poly` files (`https://download.geofabrik.de/<path>.poly`), converted to GeoJSON |
| `neukoelln.geojson` | OSM boundary admin_level=9 "Neukölln", exported with `osmium export` |

Polygons are © OpenStreetMap contributors (ODbL).

## Adding a region

- **Geofabrik** publishes a `.poly` next to every extract (each region page links
  it). Convert `.poly` → GeoJSON: each section is a ring, sections starting with
  `!` are holes. Keep it a MultiPolygon.
- Or export an administrative boundary from OSM (`osmium tags-filter` +
  `osmium export -f geojson`).

Sources (continents) need no polygon: they are whole Geofabrik files.
