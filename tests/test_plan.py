import unittest

from extractor.plan import build_nodes, build_plan, resolve_chain
from extractor.types import Project, Region, Source

SOURCES = {
    s.id: s
    for s in [
        Source("europe", "https://download.geofabrik.de/europe-latest.osm.pbf"),
        Source("africa", "https://download.geofabrik.de/africa-latest.osm.pbf"),
    ]
}
REGIONS = {
    r.id: r
    for r in [
        Region("germany", "europe", "regions/polygons/germany.geojson"),
        Region("france", "europe", "regions/polygons/france.geojson"),
        Region("hessen", "germany", "regions/polygons/hessen.geojson"),
    ]
}
PATHS = {"sources": "/src", "work": "/work", "extracts": "/ex"}


def project(id, region, filters, strategy="smart"):
    return Project(id=id, area={"region": region}, filters=filters, extract_strategy=strategy)


PROJECTS = [
    project("osm-boundary-check", "germany", ["nwr/boundary=administrative", "nwr/admin_level"]),
    project("playgrounds-france", "france", ["nwr/amenity=playground"]),
    project("spieli", "hessen", ["n/leisure=playground", "w/leisure=playground", "n/amenity=cafe"]),
]


def by_id(nodes):
    return {n["id"]: n for n in nodes}


def kinds(plan):
    return [s["kind"] for s in plan["steps"]]


class ResolveChain(unittest.TestCase):
    def test_walks_from_source_down(self):
        self.assertEqual(resolve_chain(SOURCES, REGIONS, "hessen"), ["europe", "germany", "hessen"])
        self.assertEqual(resolve_chain(SOURCES, REGIONS, "europe"), ["europe"])

    def test_unknown(self):
        with self.assertRaisesRegex(ValueError, "unknown region"):
            resolve_chain(SOURCES, REGIONS, "atlantis")

    def test_cycle(self):
        loop = {"a": Region("a", "b", "x"), "b": Region("b", "a", "x")}
        with self.assertRaisesRegex(ValueError, "cycle"):
            resolve_chain(SOURCES, loop, "a")


class BuildNodes(unittest.TestCase):
    nodes = build_nodes(SOURCES, REGIONS, PROJECTS)
    n = by_id(nodes)

    def test_activates_only_used_sources_and_regions(self):
        self.assertEqual(sorted(self.n), ["europe", "france", "germany", "hessen"])  # africa stays out

    def test_source_is_used_as_is(self):
        self.assertEqual(self.n["europe"]["source"], "europe")
        self.assertTrue(self.n["europe"]["keepAll"])
        self.assertEqual(self.n["europe"]["tagUnion"], [])

    def test_scopes_union_per_branch(self):
        self.assertEqual(self.n["germany"]["tagUnion"], [
            "n/amenity=cafe", "nw/leisure=playground", "nwr/admin_level", "nwr/boundary=administrative",
        ])
        self.assertEqual(self.n["france"]["tagUnion"], ["nwr/amenity=playground"])
        self.assertEqual(self.n["hessen"]["tagUnion"], ["n/amenity=cafe", "nw/leisure=playground"])

    def test_attaches_project_leaf_at_own_region(self):
        self.assertEqual(self.n["germany"]["projects"], ["osm-boundary-check"])
        self.assertEqual(self.n["hessen"]["projects"], ["spieli"])

    def test_no_filter_project_marks_branch_keep_all(self):
        g = by_id(build_nodes(SOURCES, REGIONS, [project("everything", "germany", [])]))["germany"]
        self.assertTrue(g["keepAll"])
        self.assertEqual(g["tagUnion"], [])


class BuildPlan(unittest.TestCase):
    plan = build_plan(SOURCES, REGIONS, PROJECTS, PATHS)

    def steps(self, kind):
        return [s for s in self.plan["steps"] if s["kind"] == kind]

    def test_reads_the_source_once(self):
        self.assertEqual(len([s for s in self.steps("extract-multi") if s["input"] == "/src/europe.osm.pbf"]), 1)

    def test_one_multi_extract_per_parent(self):
        self.assertEqual(len(self.steps("extract-multi")), 2)  # europe, germany

    def test_project_leaf_writes_latest_with_exact_filters(self):
        leaf = next(s for s in self.steps("tags-filter") if s.get("project") == "playgrounds-france")
        self.assertEqual(leaf["input"], "/work/france.filtered.osm.pbf")
        self.assertEqual(leaf["output"], "/ex/playgrounds-france/latest.osm.pbf")
        self.assertEqual(leaf["filters"], ["nwr/amenity=playground"])

    def test_cleanup_after_the_source(self):
        self.assertEqual(kinds(self.plan)[-1], "cleanup")
        self.assertIn("/work/hessen.geo.osm.pbf", self.steps("cleanup")[0]["files"])
        self.assertNotIn("/src/europe.osm.pbf", self.steps("cleanup")[0]["files"])

    def test_project_directly_on_a_source(self):
        plan = build_plan(SOURCES, REGIONS, [project("eu", "europe", ["nwr/amenity=cafe"])], PATHS)
        self.assertEqual(kinds(plan), ["tags-filter"])
        self.assertEqual(plan["steps"][0]["input"], "/src/europe.osm.pbf")

    def test_missing_polygon_fails_loudly(self):
        broken = {"germany": Region("germany", "europe")}
        with self.assertRaisesRegex(ValueError, "no polygon"):
            build_plan(SOURCES, broken, [project("p", "germany", ["nwr/admin_level"])], PATHS)


class WorldProjects(unittest.TestCase):
    def test_filters_every_source_then_merges(self):
        plan = build_plan(SOURCES, REGIONS, [project("w", "world", ["nwr/seamark:type"])], PATHS)
        self.assertEqual(kinds(plan), ["tags-filter", "tags-filter", "merge", "cleanup"])
        merge = plan["steps"][-2]
        self.assertEqual(merge["inputs"], ["/work/w.africa.osm.pbf", "/work/w.europe.osm.pbf"])
        self.assertEqual(merge["output"], "/ex/w/latest.osm.pbf")

    def test_single_source_needs_no_merge(self):
        only_eu = {"europe": SOURCES["europe"]}
        plan = build_plan(only_eu, REGIONS, [project("w", "world", ["nwr/seamark:type"])], PATHS)
        self.assertEqual(kinds(plan), ["tags-filter"])
        self.assertEqual(plan["steps"][0]["output"], "/ex/w/latest.osm.pbf")


class ExtractStrategy(unittest.TestCase):
    def test_propagates_up_the_chain(self):
        n = by_id(build_nodes(SOURCES, REGIONS, [project("p", "hessen", ["n/amenity=cafe"], "complete_ways")]))
        for rid in ["hessen", "germany"]:
            self.assertEqual(n[rid]["strategy"], "complete_ways")

    def test_strongest_wins(self):
        n = by_id(build_nodes(SOURCES, REGIONS, [
            project("weak", "hessen", ["n/amenity=cafe"], "complete_ways"),
            project("strong", "germany", ["nwr/admin_level"]),
        ]))
        self.assertEqual(n["hessen"]["strategy"], "complete_ways")
        self.assertEqual(n["germany"]["strategy"], "smart")
