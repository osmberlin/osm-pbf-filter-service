# regions/polygons/

Boundary polygons referenced by `../regions.yaml`, in osmium-compatible formats
(`.poly` or GeoJSON).

These files are intentionally **not committed yet** (decision pending — see
PLAN.md "Open questions"). They are small enough to commit and committing them
keeps the hierarchy fully reproducible.

## Where to get them

- **Geofabrik** publishes ready-made `.poly` files for continents and most
  countries: <https://download.geofabrik.de/> (each region page links a `.poly`).
- You can also export GeoJSON from administrative boundaries and convert with
  `osmium`/helper scripts.

## Expected files (matching the example regions.yaml)

```
europe.poly
africa.poly
germany.poly
france.poly
```
