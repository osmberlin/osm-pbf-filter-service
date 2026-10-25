"""Pure planning (PLAN.md §B3/§B4): resolve each project to a region chain, decide
which sources and regions are active, compute the per-node tag union, and emit
the ordered osmium steps. No IO — unit-testable.

The tree has one root per **source** (a Geofabrik continent file). Regions hang
below a source or below another region. A project with `region: world` is
filtered out of every source and the pieces are merged.

Nodes and steps are plain dicts so plan.json is just json.dumps of the plan.
"""
import os

from .tags import merge_filters
from .types import WORLD, Project, Region, Source

# osmium extract --strategy, ordered by completeness. A region's geometry cut
# uses the STRONGEST strategy any project under it requests (smart ⊇ complete_ways
# ⊇ simple), so honoring the option never under-cuts a consumer.
STRATEGIES = ["simple", "complete_ways", "smart"]
DEFAULT_RANK = STRATEGIES.index("smart")


def _rank(strategy: str) -> int:
    return STRATEGIES.index(strategy) if strategy in STRATEGIES else DEFAULT_RANK


def resolve_chain(sources: dict[str, Source], regions: dict[str, Region], region_id: str) -> list[str]:
    """Chain from the source down to `region_id`, e.g. ["europe", "germany", "hessen"]."""
    chain: list[str] = []
    cur = region_id
    while cur not in sources:
        if cur in chain:
            raise ValueError(f"region cycle detected at '{cur}'")
        r = regions.get(cur)
        if r is None:
            raise ValueError(f"unknown region or source '{cur}'")
        chain.append(cur)
        cur = r.parent
    chain.append(cur)
    return chain[::-1]


def project_chains(sources, regions, p: Project) -> list[list[str]]:
    """One chain per source the project reads from (several only for `world`)."""
    region_id = p.area.get("region")
    if not region_id:
        return []  # custom-polygon scheduling: not wired yet (pre-alpha)
    if region_id == WORLD:
        return [[sid] for sid in sorted(sources)]
    return [resolve_chain(sources, regions, region_id)]


def build_nodes(sources: dict[str, Source], regions: dict[str, Region], projects: list[Project]) -> list[dict]:
    """Active nodes (sources + every region on a project chain) with tag unions."""
    acc: dict[str, dict] = {}

    for p in projects:
        keep_all = not p.filters
        for chain in project_chains(sources, regions, p):
            for depth, nid in enumerate(chain):
                a = acc.setdefault(nid, {"filters": [], "keepAll": False, "projects": [], "rank": -1, "depth": depth})
                if depth == 0:
                    continue  # a source file is never cut or tag-filtered as a whole
                a["rank"] = max(a["rank"], _rank(p.extract_strategy))  # strongest strategy wins
                if keep_all:
                    a["keepAll"] = True
                else:
                    a["filters"].extend(p.filters)
            acc[chain[-1]]["projects"].append(p.id)

    nodes = []
    for nid, a in acc.items():
        source, region = sources.get(nid), regions.get(nid)
        nodes.append({
            "id": nid,
            "source": nid if source else None,
            "parent": region.parent if region else None,
            "depth": a["depth"],
            "polygon": region.polygon if region else None,
            "keepAll": a["keepAll"] or bool(source),  # a source is used as-is
            "tagUnion": [] if (a["keepAll"] or source) else merge_filters(a["filters"]),
            "projects": sorted(a["projects"]),
            "strategy": STRATEGIES[DEFAULT_RANK if a["rank"] < 0 else a["rank"]],
        })
    nodes.sort(key=lambda n: (n["depth"], n["id"]))
    return nodes


def source_file(paths: dict, sid: str) -> str:
    return os.path.join(paths["sources"], f"{sid}.osm.pbf")


def geo_file(paths: dict, nid: str) -> str:
    return os.path.join(paths["work"], f"{nid}.geo.osm.pbf")


def filtered_file(paths: dict, node: dict) -> str:
    """The file a node's children and projects read from."""
    if node["source"]:
        return source_file(paths, node["id"])
    if node["keepAll"]:
        return geo_file(paths, node["id"])
    return os.path.join(paths["work"], f"{node['id']}.filtered.osm.pbf")


def project_out(paths: dict, pid: str) -> str:
    return os.path.join(paths["extracts"], pid, "latest.osm.pbf")


def plan_steps(nodes: list[dict], projects: list[Project], paths: dict) -> list[dict]:
    """Ordered osmium steps, strictly one after another.

    Sources are processed one at a time (all their regions, then their projects),
    so only one continent's intermediates exist at once. World projects get one
    piece per source and a final merge.
    """
    children: dict[str, list[dict]] = {}
    for n in nodes:
        if n["parent"] is not None:
            children.setdefault(n["parent"], []).append(n)
    by_id = {p.id: p for p in projects}
    world = [p for p in projects if p.area.get("region") == WORLD]

    def subtree(root: dict) -> list[dict]:
        out, todo = [], [root]
        while todo:
            n = todo.pop(0)
            out.append(n)
            todo.extend(children.get(n["id"], []))
        return out

    roots = [n for n in nodes if n["source"]]
    # World projects read every source; with a single source there is nothing to merge.
    merge_world = len(roots) > 1
    steps: list[dict] = []
    pieces: dict[str, list[str]] = {p.id: [] for p in world}

    for root in roots:
        tree = subtree(root)

        # Regions first (breadth-first): one read of each parent produces all its
        # children's geometry, then each child is tag-filtered to its union.
        for parent in tree:
            kids = children.get(parent["id"], [])
            # config.py guarantees every region has a polygon; a node without one
            # here is a programmer error. Fail loudly instead of emitting steps
            # that read files no step produces.
            for k in kids:
                if not k["polygon"]:
                    raise ValueError(f"region '{k['id']}' has no polygon — cannot plan its extraction")
            if not kids:
                continue
            steps.append({
                "kind": "extract-multi",
                "input": filtered_file(paths, parent),
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

        # Project leaves in this source's tree.
        for n in tree:
            for pid in n["projects"]:
                p = by_id[pid]
                if p in world and merge_world:
                    out = os.path.join(paths["work"], f"{pid}.{root['id']}.osm.pbf")
                    pieces[pid].append(out)
                else:
                    out = project_out(paths, pid)
                steps.append(_leaf(p, filtered_file(paths, n), out))

        # Free this source's intermediates before the next continent starts.
        temp = sorted({f for k in tree[1:] for f in (geo_file(paths, k["id"]), filtered_file(paths, k))})
        if temp:
            steps.append({"kind": "cleanup", "files": temp})

    # World projects: merge the per-source pieces into one file.
    if merge_world:
        for p in world:
            steps.append({"kind": "merge", "project": p.id, "inputs": pieces[p.id], "output": project_out(paths, p.id)})
            steps.append({"kind": "cleanup", "files": pieces[p.id]})
    return steps


def _leaf(p: Project, src: str, out: str) -> dict:
    if not p.filters:
        return {"kind": "copy", "project": p.id, "from": src, "to": out}
    return {
        "kind": "tags-filter",
        "project": p.id,
        "input": src,
        "output": out,
        "filters": p.filters,
        "addReferenced": p.add_referenced,
    }


def build_plan(sources: dict[str, Source], regions: dict[str, Region], projects: list[Project], paths: dict) -> dict:
    nodes = build_nodes(sources, regions, projects)
    return {"nodes": nodes, "steps": plan_steps(nodes, projects, paths)}
