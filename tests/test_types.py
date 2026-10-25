import unittest

from extractor.types import is_valid_id


class IsValidId(unittest.TestCase):
    """Region ids + project folder names become paths and URLs."""

    def test_accepts_plain_ids(self):
        for id in ["germany", "osm-boundary-checker-germany", "region_2", "7zones"]:
            self.assertTrue(is_valid_id(id), id)

    def test_rejects_traversal_and_separators(self):
        for id in ["../planet", "a/b", "a\\b", ".", ".."]:
            self.assertFalse(is_valid_id(id), id)

    def test_rejects_hostile_characters(self):
        for id in ["my project (v2)", "UPPER", "umlaut-ä", "", "-leading-dash", "trailing-newline\n"]:
            self.assertFalse(is_valid_id(id), id)
