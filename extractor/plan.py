"""Pure planning (PLAN.md §B3/§B4): resolve each project to a region chain, decide
which regions are active, compute the per-node tag union, and emit the ordered
osmium steps. No IO — unit-testable.

Nodes and steps are plain dicts so plan.json is just json.dumps of the plan.
"""
import os

from .tags import merge_filters
from .types import Project, Region

# osmium extract --strategy, ordered by completeness. A region's geometry cut
# uses the STRONGEST strategy any project under it requests (smart ⊇ complete_ways
# ⊇ simple), so honoring the option never under-cuts a consumer.
STRATEGIES = ["simple", "complete_ways", "smart"]
DEFAULT_RANK = STRATEGIES.index("smart")


def _rank(strategy: str) -> int:
    return STRATEGIES.index(strategy) if strategy in STRATEGIES else DEFAULT_RANK


def resolve_chain(regions: dict[str, Region], region_id: str) -> list[str]:
    """Region chain from the planet down to `region_id`, e.g. ["world","europe","germany"]."""
    chain: list[str] = []
    cur = region_id
    while cur and cur != "world":
        if cur in chain:
            raise ValueError(f"region cycle detected at '{cur}'")
        r = regions.get(cur)
        if r is None:
            raise ValueError(f"unknown region '{cur}'")
        chain.append(cur)
        cur = r.parent
    chain.append("world")
    return chain[::-1]


def build_nodes(regions: dict[str, Region], projects: list[Project]) -> list[dict]:
    """Active region nodes (world + every region on a project chain) with tag unions."""
    acc: dict[str, dict] = {}

    def ensure(id: str, depth: int) -> dict:
        return acc.setdefault(id, {"filters": [], "keepAll": False, "projects": [], "rank": -1, "depth": depth})

    for p in projects:
        region_id = p.area.get("region")
        if not region_id:
            continue  # custom-polygon scheduling: not wired yet (pre-alpha)
        keep_all = not p.filters
        for depth, rid in enumerate(resolve_chain(regions, region_id)):
            a = ensure(rid, depth)
            if rid == "world":
                continue  # the planet is never tag-filtered / cut as a whole
            a["rank"] = max(a["rank"], _rank(p.extract_strategy))  # strongest strategy wins
            if keep_all:
                a["keepAll"] = True
            else:
                a["filters"].extend(p.filters)
        acc[region_id]["projects"].append(p.id)

    nodes = []
    for id, a in acc.items():
        region = regions.get(id) if id != "world" else None
        nodes.append({
            "id": id,
            "parent": region.parent if region else None,
            "depth": a["depth"],
            "polygon": region.polygon if region else None,
            "keepAll": a["keepAll"],
            "tagUnion": [] if a["keepAll"] else merge_filters(a["filters"]),
            "projects": sorted(a["projects"]),
            "strategy": STRATEGIES[DEFAULT_RANK if a["rank"] < 0 else a["rank"]],
        })
    nodes.sort(key=lambda n: (n["depth"], n["id"]))
    return nodes


def geo_file(paths: dict, id: str) -> str:
    return os.path.join(paths["work"], f"{id}.geo.osm.pbf")


def filtered_file(paths: dict, node: dict) -> str:
    if node["keepAll"]:
        return geo_file(paths, node["id"])
    return os.path.join(paths["work"], f"{node['id']}.filtered.osm.pbf")


def project_out(paths: dict, pid: str) -> str:
    return os.path.join(paths["extracts"], pid, "latest.osm.pbf")


def plan_steps(nodes: list[dict], projects: list[Project], paths: dict) -> list[dict]:
    """Ordered osmium steps (single-pass multi-extract per parent)."""
    children: dict[str, list[dict]] = {}
    for n in nodes:
        if n["parent"] is not None:
            children.setdefault(n["parent"], []).append(n)

    steps: list[dict] = []

    # Parents first (nodes are depth-sorted): one read of each parent file
    # produces all its children's geometry, then each child is tag-filtered.
    for parent in nodes:
        kids = children.get(parent["id"], [])
        # config.py guarantees every region has a polygon; a node without one here
        # is a programmer error. Silently skipping it would emit downstream steps
        # that read files no step produces — fail loudly instead.
        for k in kids:
            if not k["polygon"]:
                raise ValueError(f"region '{k['id']}' has no polygon — cannot plan its extraction")
        if not kids:
            continue
        steps.append({
            "kind": "extract-multi",
            "input": paths["planet"] if parent["id"] == "world" else filtered_file(paths, parent),
            "strategy": STRATEGIES[max(_rank(k["strategy"]) for k in kids)],
            "configFile": os.path.join(paths["work"], f"{parent['id']}.extracts.json"),
            "extracts": [
                {"region": k["id"], "polygon": k["polygon"], "output": geo_file(paths, k["id"])} for k in kids
            ],
        })
        for k in kids:
            if k["keepAll"]:
                continue  # filtered == geo
            steps.append({
                "kind": "tags-filter",
                "node": k["id"],
                "input": geo_file(paths, k["id"]),
                "output": filtered_file(paths, k),
                "filters": k["tagUnion"],
                "addReferenced": True,
            })

    # Project leaves: cut the project's exact tags out of its region's filtered file.
    by_id = {p.id: p for p in projects}
    for n in nodes:
        for pid in n["projects"]:
            p = by_id[pid]
            src, out = filtered_file(paths, n), project_out(paths, pid)
            if not p.filters:
                steps.append({"kind": "copy", "project": pid, "from": src, "to": out})
            else:
                steps.append({
                    "kind": "tags-filter",
                    "project": pid,
                    "input": src,
                    "output": out,
                    "filters": p.filters,
                    "addReferenced": p.add_referenced,
                })
    return steps


def build_plan(regions: dict[str, Region], projects: list[Project], paths: dict) -> dict:
    nodes = build_nodes(regions, projects)
    return {"nodes": nodes, "steps": plan_steps(nodes, projects, paths)}
