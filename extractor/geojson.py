"""Pure GeoJSON polygon-type validation (no IO)."""

_POLY = ("Polygon", "MultiPolygon")


def polygon_geometry_type(gj) -> tuple[bool, str]:
    """Accept only a GeoJSON Polygon/MultiPolygon, unwrapping Feature / FeatureCollection.

    Returns (ok, detail). Anything else (point, line, empty, malformed) is rejected.
    """
    if not isinstance(gj, dict):
        return False, "not a JSON object"
    t = gj.get("type")

    if t in _POLY:
        return True, t

    if t == "Feature":
        g = (gj.get("geometry") or {}).get("type")
        if g in _POLY:
            return True, f"Feature/{g}"
        return False, f"Feature geometry is {g or 'missing'} (need Polygon/MultiPolygon)"

    if t == "FeatureCollection":
        feats = gj.get("features") if isinstance(gj.get("features"), list) else []
        if not feats:
            return False, "empty FeatureCollection"
        types = [((f or {}).get("geometry") or {}).get("type") for f in feats]
        listed = ",".join(str(x) for x in types)
        if all(x in _POLY for x in types):
            return True, f"FeatureCollection({listed})"
        return False, f"non-polygonal geometry in collection: {listed}"

    return False, f"type is {t or 'missing'} (need Polygon/MultiPolygon)"
