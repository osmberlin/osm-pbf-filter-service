"""Orchestrator entry point (PLAN.md §B4): load configs, build the plan, write
plan.json for traceability, then run osmium top-down and write status files.

    python3 -m extractor            # on the server runner
    python3 -m extractor --dry-run  # write plan.json only, no osmium
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

from .config import load_projects, load_regions
from .github import error_count, gh_error, gh_warning, summary_line
from .plan import build_plan, project_out, resolve_chain

# Settings live here as constants, not in GitHub env: the repo has one
# deployment. OSM_ROOT is the only override, for local test runs.
ROOT = os.environ.get("OSM_ROOT", "/srv/osm")  # = ansible osm_root
PATHS = {
    "planet": os.path.join(ROOT, "planet/planet.osm.pbf"),
    "work": os.path.join(ROOT, "work"),
    "extracts": os.path.join(ROOT, "extracts"),
}
# Public URL of the nginx extracts dir (= ansible osm_download_hostname).
# TODO: set the real hostname once agreed with the FOSSGIS admin.
PUBLIC_BASE = "https://osm.example.org/extracts"

# status.json is written next to each extract (served by nginx) AND copied into
# the repo-relative status/ dir so commit-results.sh can commit the audit log
# (PLAN.md §B6).
REPO_STATUS_DIR = "status"


def to_json(data) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def osmium(args: list[str]) -> None:
    print("+ osmium " + " ".join(args), flush=True)
    subprocess.run(["osmium", *args], check=True)


def build_to_tmp(target: str, build) -> None:
    """Build into `target`.tmp, then atomically promote (same filesystem → rename).

    nginx serves extracts/ directly, so served files must never be written in
    place: a client downloading during the run would get a truncated pbf. On
    failure the .tmp is removed so nothing stray lingers in the served dir.
    """
    tmp = target + ".tmp"
    os.makedirs(os.path.dirname(target), exist_ok=True)
    try:
        os.remove(tmp)
    except FileNotFoundError:
        pass
    try:
        build(tmp)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    os.replace(tmp, target)


def run_step(step: dict) -> float:
    """Steps run strictly serially BY DESIGN: the server is shared with uMap, and one
    osmium process at a time caps our peak RAM and disk-I/O pressure (PLAN §A8/B8)."""
    t0 = time.monotonic()
    kind = step["kind"]
    if kind == "extract-multi":
        config = {
            "directory": os.path.dirname(step["extracts"][0]["output"]),
            "extracts": [
                {"output": os.path.basename(e["output"]),
                 "polygon": {"file_name": os.path.abspath(e["polygon"]), "file_type": "geojson"}}
                for e in step["extracts"]
            ],
        }
        os.makedirs(os.path.dirname(step["configFile"]), exist_ok=True)
        with open(step["configFile"], "w", encoding="utf-8") as fh:
            fh.write(to_json(config))
        osmium(["extract", "--overwrite", "--strategy", step["strategy"], "-c", step["configFile"], step["input"]])
    elif kind == "tags-filter":
        def tags_filter(tmp: str) -> None:
            # -f pbf: osmium guesses the format from the file name, and `.tmp` defeats that.
            args = ["tags-filter", "--overwrite", "-f", "pbf"]
            # osmium INCLUDES referenced objects by default (complete geometry). -R is
            # --omit-referenced, so only pass it when we explicitly do NOT want them.
            if not step["addReferenced"]:
                args.append("-R")
            osmium([*args, "-o", tmp, step["input"], *step["filters"]])
        build_to_tmp(step["output"], tags_filter)
    elif kind == "copy":
        def copy(tmp: str) -> None:
            try:
                os.link(step["from"], tmp)  # same volume: O(1), no doubled disk I/O
            except OSError:
                shutil.copyfile(step["from"], tmp)
        build_to_tmp(step["to"], copy)
    return round(time.monotonic() - t0, 3)


def sha256(file: str) -> str:
    """Streaming sha256 — extracts can be multiple GB; never read them into RAM."""
    h = hashlib.sha256()
    with open(file, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_update_state() -> dict:
    state_path = os.path.join(os.path.dirname(PATHS["planet"]), "update-state.json")
    if not os.path.exists(state_path):
        return {}
    try:
        with open(state_path, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as e:
        # A corrupt state file must not kill the run after hours of osmium work.
        gh_warning(state_path, f"unreadable update-state.json ({e}); continuing without it")
        return {}


def publish(rel: str, text: str) -> None:
    """Each status file goes to the nginx dir (served) and the repo's status/ (committed audit log)."""
    for base in (PATHS["extracts"], REPO_STATUS_DIR):
        file = os.path.join(base, rel)
        os.makedirs(os.path.dirname(file), exist_ok=True)
        with open(file, "w", encoding="utf-8") as fh:
            fh.write(text)


def write_status(regions, projects, durations: dict[str, float]) -> None:
    state = read_update_state()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = []

    for p in projects:
        out = project_out(PATHS, p.id)
        if not os.path.exists(out):
            continue  # skip in dry-run / when a step was skipped
        download_url = f"{PUBLIC_BASE}/{p.id}/latest.osm.pbf"
        status = {
            "project": p.id,
            "description": p.description,
            "repository": p.repository,
            "homepage": p.homepage,
            "contact": p.contact,
            "file": os.path.basename(out),
            "size_bytes": os.path.getsize(out),
            "sha256": sha256(out),
            "area": p.area,
            "filters": p.filters,
            "pipeline": resolve_chain(regions, p.area["region"]),
            # The planet's timestamp (from update-planet.sh) holds for every extract
            # of this run; osmium extract drops the replication header, so there is
            # no per-file fallback.
            "data_timestamp": state.get("data_timestamp"),
            "planet_sequence_number": state.get("planet_sequence_number"),
            "update_run_at": state.get("update_run_at"),
            "extract_run_at": now,
            "extract_duration_seconds": durations.get(p.id),
            "download_url": download_url,
        }
        publish(os.path.join(p.id, "status.json"), to_json(status))
        index.append({"project": p.id, "download_url": download_url,
                      "data_timestamp": status["data_timestamp"], "extract_run_at": now})

    publish("index.json", to_json({"generated_at": now, "projects": index}))


def main(argv: list[str] | None = None) -> int:
    dry_run = "--dry-run" in (sys.argv[1:] if argv is None else argv)

    regions = load_regions()
    projects = load_projects(regions)
    plan = build_plan(regions, projects, PATHS)

    with open("plan.json", "w", encoding="utf-8") as fh:
        fh.write(to_json(plan))

    summary_line("## OSM extract build")
    summary_line(f"- active regions: **{sum(1 for n in plan['nodes'] if n['id'] != 'world')}**")
    summary_line(f"- projects: **{len(projects)}**")
    summary_line(f"- osmium steps: **{len(plan['steps'])}**")
    if error_count():
        summary_line(f"- ⚠️ **{error_count()} invalid input(s) skipped** — see annotations")

    # A run with zero valid projects must FAIL, not vacuously succeed: writing an
    # empty index.json would clobber the served + committed index while every
    # status.json silently goes stale (nobody would be alerted by a green run).
    if not projects:
        gh_error("projects", "no valid projects after validation — refusing to publish an empty index")
        return 1

    if dry_run:
        print("dry-run: wrote plan.json; not invoking osmium.")
        return 0

    durations: dict[str, float] = {}
    for step in plan["steps"]:
        secs = run_step(step)
        if step.get("project"):
            durations[step["project"]] = secs  # leaf-step (final extract) duration, per project
    write_status(regions, projects, durations)
    print(f"Done: {len(projects)} projects, {len(plan['steps'])} steps.")
    return 0
