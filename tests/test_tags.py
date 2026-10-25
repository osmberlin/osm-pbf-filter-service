import unittest

from extractor.tags import ParsedFilter, format_filter, merge_filters, parse_filter


class ParseFilter(unittest.TestCase):
    def test_types_key_values(self):
        self.assertEqual(parse_filter("n/natural=tree"), ParsedFilter("n", "natural", ["tree"]))
        self.assertEqual(parse_filter("nwr/leisure=playground"), ParsedFilter("nwr", "leisure", ["playground"]))
        self.assertEqual(parse_filter("w/playground"), ParsedFilter("w", "playground", None))

    def test_defaults_to_all_types(self):
        self.assertEqual(parse_filter("amenity=cafe").types, "nwr")
        self.assertEqual(parse_filter("emergency"), ParsedFilter("nwr", "emergency", None))

    def test_splits_value_lists(self):
        self.assertEqual(parse_filter("nw/amenity=cafe,bench").values, ["cafe", "bench"])

    def test_canonicalises_type_order(self):
        self.assertEqual(parse_filter("rwn/amenity=cafe").types, "nwr")


class FormatFilter(unittest.TestCase):
    def test_sorts_values_and_keeps_key_only(self):
        self.assertEqual(format_filter(ParsedFilter("nw", "amenity", ["cafe", "bench"])), "nw/amenity=bench,cafe")
        self.assertEqual(format_filter(ParsedFilter("nwr", "emergency", None)), "nwr/emergency")


class MergeFilters(unittest.TestCase):
    def test_unions_types_per_key(self):
        self.assertEqual(
            merge_filters(["n/leisure=playground", "w/leisure=playground", "r/leisure=playground"]),
            ["nwr/leisure=playground"],
        )
        self.assertEqual(merge_filters(["n/playground", "w/playground"]), ["nw/playground"])

    def test_key_only_wins(self):
        self.assertEqual(merge_filters(["n/emergency", "n/emergency=ambulance_station"]), ["n/emergency"])

    def test_unions_values(self):
        self.assertEqual(merge_filters(["n/amenity=cafe", "w/amenity=bench"]), ["nw/amenity=bench,cafe"])

    def test_germany_boundary_scenario(self):
        self.assertEqual(
            merge_filters(["nwr/boundary=administrative", "nwr/admin_level", "r/boundary=administrative"]),
            ["nwr/admin_level", "nwr/boundary=administrative"],
        )
