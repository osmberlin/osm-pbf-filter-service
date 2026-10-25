import unittest

from extractor.geojson import polygon_geometry_type

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]]}


def ok(gj) -> bool:
    return polygon_geometry_type(gj)[0]


class PolygonGeometryType(unittest.TestCase):
    def test_accepts_polygon_and_multipolygon(self):
        self.assertTrue(ok(SQUARE))
        self.assertTrue(ok({"type": "MultiPolygon", "coordinates": []}))

    def test_unwraps_feature_and_collection(self):
        self.assertTrue(ok({"type": "Feature", "geometry": SQUARE}))
        self.assertTrue(ok({"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": SQUARE}]}))

    def test_rejects_non_polygonal_empty_and_malformed(self):
        self.assertFalse(ok({"type": "Point", "coordinates": [0, 0]}))
        self.assertFalse(ok({"type": "LineString", "coordinates": [[0, 0], [1, 1]]}))
        self.assertFalse(ok({"type": "FeatureCollection", "features": []}))
        self.assertFalse(ok("not json"))
        self.assertFalse(ok(None))
        self.assertFalse(ok({"type": "FeatureCollection", "features": [{"geometry": {"type": "Point"}}]}))
        self.assertFalse(ok({"type": "FeatureCollection", "features": [None]}))
