import unittest

from extractor.plan import build_nodes, build_plan, resolve_chain
from extractor.types import Project, Region

REGIONS = {
    r.id: r
    for r in [
        Region("europe", "world", "regions/polygons/europe.geojson"),
        Region("africa", "world", "regions/polygons/africa.geojson"),
        Region("germany", "europe", "regions/polygons/germany.geojson"),
        Region("france", "europe", "regions/polygons/france.geojson"),
        Region("hessen", "germany", "regions/polygons/hessen.geojson"),
    ]
}
PATHS = {"planet": "/planet.osm.pbf", "work": "/work", "extracts": "/ex"}


def project(id, region, filters, strategy="smart"):
    return Project(id=id, area={"region": region}, filters=filters, extract_strategy=strategy)


PROJECTS = [
    project("osm-boundary-check", "germany", ["nwr/boundary=administrative", "nwr/admin_level"]),
    project("playgrounds-france", "france", ["nwr/amenity=playground"]),
    project("spieli", "hessen", ["n/leisure=playground", "w/leisure=playground", "n/amenity=cafe"]),
]


def by_id(nodes):
    return {n["id"]: n for n in nodes}


class ResolveChain(unittest.TestCase):
    def test_walks_from_planet_down(self):
        self.assertEqual(resolve_chain(REGIONS, "hessen"), ["world", "europe", "germany", "hessen"])
        self.assertEqual(resolve_chain(REGIONS, "france"), ["world", "europe", "france"])

    def test_unknown_region(self):
        with self.assertRaisesRegex(ValueError, "unknown region"):
            resolve_chain(REGIONS, "atlantis")

    def test_cycle(self):
        loop = {"a": Region("a", "b", "x"), "b": Region("b", "a", "x")}
        with self.assertRaisesRegex(ValueError, "cycle"):
            resolve_chain(loop, "a")


class BuildNodes(unittest.TestCase):
    nodes = build_nodes(REGIONS, PROJECTS)
    n = by_id(nodes)

    def test_activates_only_referenced_regions(self):
        self.assertEqual(sorted(self.n), ["europe", "france", "germany", "hessen", "world"])

    def test_depths(self):
        self.assertEqual([(x["id"], x["depth"]) for x in self.nodes][:2], [("world", 0), ("europe", 1)])
        self.assertEqual(self.n["hessen"]["depth"], 3)

    def test_unions_descendant_tags_at_europe(self):
        self.assertEqual(self.n["europe"]["tagUnion"], [
            "nw/leisure=playground",
            "nwr/admin_level",
            "nwr/amenity=cafe,playground",
            "nwr/boundary=administrative",
        ])

    def test_scopes_union_per_branch(self):
        self.assertEqual(self.n["germany"]["tagUnion"], [
            "n/amenity=cafe", "nw/leisure=playground", "nwr/admin_level", "nwr/boundary=administrative",
        ])
        self.assertEqual(self.n["france"]["tagUnion"], ["nwr/amenity=playground"])
        self.assertEqual(self.n["hessen"]["tagUnion"], ["n/amenity=cafe", "nw/leisure=playground"])

    def test_attaches_project_leaf_at_own_region(self):
        self.assertEqual(self.n["germany"]["projects"], ["osm-boundary-check"])
        self.assertEqual(self.n["france"]["projects"], ["playgrounds-france"])
        self.assertEqual(self.n["hessen"]["projects"], ["spieli"])

    def test_no_filter_project_marks_branch_keep_all(self):
        g = by_id(build_nodes(REGIONS, [project("everything", "germany", [])]))["germany"]
        self.assertTrue(g["keepAll"])
        self.assertEqual(g["tagUnion"], [])


class BuildPlan(unittest.TestCase):
    plan = build_plan(REGIONS, PROJECTS, PATHS)

    def steps(self, kind):
        return [s for s in self.plan["steps"] if s["kind"] == kind]

    def test_reads_planet_once(self):
        self.assertEqual(len([s for s in self.steps("extract-multi") if s["input"] == PATHS["planet"]]), 1)

    def test_one_multi_extract_per_parent(self):
        self.assertEqual(len(self.steps("extract-multi")), 3)  # world, europe, germany

    def test_project_leaf_writes_latest_with_exact_filters(self):
        leaf = next(s for s in self.steps("tags-filter") if s.get("project") == "playgrounds-france")
        self.assertEqual(leaf["output"], "/ex/playgrounds-france/latest.osm.pbf")
        self.assertEqual(leaf["filters"], ["nwr/amenity=playground"])
        self.assertTrue(leaf["addReferenced"])

    def test_keep_all_project_is_a_copy(self):
        plan = build_plan(REGIONS, [project("everything", "france", [])], PATHS)
        copy = plan["steps"][-1]
        self.assertEqual(copy["kind"], "copy")
        self.assertEqual(copy["from"], "/work/france.geo.osm.pbf")

    def test_missing_polygon_fails_loudly(self):
        broken = {"europe": Region("europe", "world"), "germany": Region("germany", "europe", "g.geojson")}
        with self.assertRaisesRegex(ValueError, "no polygon"):
            build_plan(broken, [project("p", "germany", ["nwr/admin_level"])], PATHS)


class ExtractStrategy(unittest.TestCase):
    def test_propagates_up_the_chain(self):
        n = by_id(build_nodes(REGIONS, [project("p", "hessen", ["n/amenity=cafe"], "complete_ways")]))
        for rid in ["hessen", "germany", "europe"]:
            self.assertEqual(n[rid]["strategy"], "complete_ways")

    def test_strongest_wins(self):
        n = by_id(build_nodes(REGIONS, [
            project("weak", "hessen", ["n/amenity=cafe"], "complete_ways"),
            project("strong", "germany", ["nwr/admin_level"]),
        ]))
        self.assertEqual(n["hessen"]["strategy"], "complete_ways")
        self.assertEqual(n["germany"]["strategy"], "smart")

    def test_defaults_to_smart_in_extract_step(self):
        plan = build_plan(REGIONS, [project("p", "france", ["nwr/amenity=playground"])], PATHS)
        step = next(s for s in plan["steps"]
                    if s["kind"] == "extract-multi" and any(e["region"] == "france" for e in s["extracts"]))
        self.assertEqual(step["strategy"], "smart")
