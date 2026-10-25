"""Load + validate region and project configs (PLAN.md §B2/§B4).

Fail-soft: invalid inputs are skipped and reported as GitHub Actions annotations.
"""
import json
import os

import yaml  # PyYAML — Debian/Ubuntu package python3-yaml

from .geojson import polygon_geometry_type
from .github import gh_error, gh_warning
from .plan import resolve_chain
from .types import ID_RULE, Project, Region, is_valid_id

REGIONS_DIR = "regions"
REGIONS_FILE = os.path.join(REGIONS_DIR, "regions.yaml")
PROJECTS_DIR = "projects"


def _validate_polygon_file(file: str) -> tuple[bool, str]:
    if not os.path.exists(file):
        return False, "file not found"
    try:
        with open(file, encoding="utf-8") as fh:
            parsed = json.load(fh)
    except ValueError as e:
        return False, f"invalid JSON: {e}"
    return polygon_geometry_type(parsed)


def load_regions() -> dict[str, Region]:
    out: dict[str, Region] = {}
    if not os.path.exists(REGIONS_FILE):
        gh_error(REGIONS_FILE, "regions file not found")
        return out

    with open(REGIONS_FILE, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    for r in raw.get("regions") or []:
        if not isinstance(r, dict) or not r.get("id") or not r.get("parent"):
            gh_error(REGIONS_FILE, f"region missing id/parent: {json.dumps(r, default=str)}")
            continue
        rid = str(r["id"])
        if not is_valid_id(rid):
            gh_error(REGIONS_FILE, f"region id '{rid}' is invalid ({ID_RULE}) — ids become paths and URLs")
            continue
        # Every region must have a polygon: plan_steps cuts each region's geometry
        # from its parent, so a polygon-less region would break every project under it.
        if not r.get("polygon"):
            gh_error(REGIONS_FILE, f"region '{rid}' has no polygon — required for extraction")
            continue
        polygon = os.path.normpath(os.path.join(REGIONS_DIR, r["polygon"]))  # repo-relative path
        ok, detail = _validate_polygon_file(polygon)
        if not ok:
            gh_error(polygon, f"region '{rid}' polygon invalid: {detail}")
            continue
        out[rid] = Region(id=rid, parent=str(r["parent"]), polygon=polygon, name=r.get("name"))

    # Drop regions whose parent chain doesn't resolve to "world" (same walker the
    # planner uses, so config validation and planning can never disagree).
    for rid in list(out):
        try:
            resolve_chain(out, rid)
        except ValueError as e:
            gh_error(REGIONS_FILE, f"region '{rid}': {e}")
            del out[rid]

    return out


def load_projects(regions: dict[str, Region]) -> list[Project]:
    out: list[Project] = []
    if not os.path.isdir(PROJECTS_DIR):
        return out

    for id in sorted(os.listdir(PROJECTS_DIR)):
        folder = os.path.join(PROJECTS_DIR, id)
        cfg_path = os.path.join(folder, "config.yaml")
        if not os.path.isdir(folder) or not os.path.exists(cfg_path):
            continue

        if not is_valid_id(id):
            gh_error(cfg_path, f"project folder '{id}' is an invalid id ({ID_RULE}) — it becomes the URL path")
            continue

        try:
            with open(cfg_path, encoding="utf-8") as fh:
                cfg = yaml.safe_load(fh) or {}
        except yaml.YAMLError as e:
            gh_error(cfg_path, f"invalid YAML: {e}")
            continue
        if not isinstance(cfg, dict):
            gh_error(cfg_path, "config must be a YAML mapping")
            continue

        if "name" in cfg:
            gh_warning(cfg_path, f"'name' is ignored — the project id is the folder ('{id}'). Remove the 'name' field.")

        area = cfg.get("area") or {}
        region, polygon = area.get("region"), area.get("polygon")
        if not region and not polygon:
            gh_error(cfg_path, "area must set exactly one of 'region' or 'polygon'")
            continue
        if region and polygon:
            gh_error(cfg_path, "area sets both 'region' and 'polygon'; pick one")
            continue
        if region and region not in regions:
            gh_error(cfg_path, f"unknown region '{region}' (not a valid id in regions.yaml)")
            continue
        if polygon:
            ok, detail = _validate_polygon_file(os.path.join(folder, polygon))
            if not ok:
                gh_error(os.path.join(folder, polygon), f"project '{id}' polygon invalid: {detail}")
                continue
            # Custom polygons are validated but not scheduled yet (PLAN.md §B3, pre-alpha).
            # Skip explicitly so the project isn't silently dropped downstream with no output.
            gh_warning(cfg_path, f"project '{id}' uses 'area.polygon', which is not scheduled yet (pre-alpha); skipping")
            continue

        # A missing filters list means "keep everything" (deliberate). A PRESENT but
        # non-list value is a config mistake — treating it as keep-everything would
        # silently ship the entire unfiltered region, so reject it instead.
        filters = cfg.get("filters")
        if filters is not None and not isinstance(filters, list):
            gh_error(cfg_path, f"'filters' must be a YAML list (got {type(filters).__name__}) — a scalar would silently keep everything")
            continue

        osmium = cfg.get("osmium") or {}
        out.append(Project(
            id=id,
            area={"region": region},
            filters=[str(f) for f in filters or []],
            extract_strategy=osmium.get("extract_strategy", "smart"),
            add_referenced=osmium.get("add_referenced", True),
            description=cfg.get("description"),
            repository=cfg.get("repository"),
            homepage=cfg.get("homepage"),
            contact=cfg.get("contact"),
        ))

    return out
