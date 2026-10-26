"""Orchestrator entry point (PLAN.md §B4).

    python3 -m extractor update          # seed missing sources, apply daily diffs
    python3 -m extractor build           # plan, run osmium, write status files
    python3 -m extractor build --dry-run # write plan.json only, no osmium
    python3 -m extractor seed [ids...]   # re-download sources from scratch
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

from . import sources as src
from .config import load_projects, load_tree
from .github import error_count, gh_error, summary_line
from .plan import build_plan, project_chains, project_out

# Settings live here as constants, not in GitHub env: the repo has one
# deployment. OSM_ROOT is the only override, for local test runs.
ROOT = os.environ.get("OSM_ROOT", "/srv/osm")  # = ansible osm_root
PATHS = {
    "sources": os.path.join(ROOT, "sources"),  # <id>.osm.pbf + <id>.state.json
    "work": os.path.join(ROOT, "work"),
    "extracts": os.path.join(ROOT, "extracts"),
}
# Public URL of the extracts in R2 (bucket osm-extracts, prefix extracts/).
# TODO: replace with the bucket's public r2.dev URL (docs/setup.md, step 3),
# later a custom domain.
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
    elif kind == "merge":
        def merge(tmp: str) -> None:
            # Geofabrik continents overlap a little and are cut on different days,
            # so one object can appear in two versions. Merge keeping history, then
            # time-filter (no time = "now") keeps only the newest version.
            # Workaround for https://github.com/osmcode/osmium-tool/issues/197,
            # same as k-yle/OpenSeaMap-vector (.github/workflows/planet.yml).
            print("+ osmium merge --with-history … | osmium time-filter", flush=True)
            m = subprocess.Popen(["osmium", "merge", "--with-history", "-f", "pbf", "-o", "-", *step["inputs"]],
                                 stdout=subprocess.PIPE)
            t = subprocess.run(["osmium", "time-filter", "-F", "pbf", "-f", "pbf", "-o", tmp, "-"], stdin=m.stdout)
            m.stdout.close()
            if m.wait() != 0 or t.returncode != 0:
                raise RuntimeError(f"merge for {step['project']} failed")
        build_to_tmp(step["output"], merge)
    elif kind == "cleanup":
        for f in step["files"]:
            if os.path.exists(f):
                os.remove(f)
    return round(time.monotonic() - t0, 3)


def sha256(file: str) -> str:
    """Streaming sha256 — extracts can be multiple GB; never read them into RAM."""
    h = hashlib.sha256()
    with open(file, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def publish(rel: str, text: str) -> None:
    """Each status file goes to the nginx dir (served) and the repo's status/ (committed audit log)."""
    for base in (PATHS["extracts"], REPO_STATUS_DIR):
        file = os.path.join(base, rel)
        os.makedirs(os.path.dirname(file), exist_ok=True)
        with open(file, "w", encoding="utf-8") as fh:
            fh.write(text)


def write_status(sources, regions, projects, durations: dict[str, float]) -> None:
    states = {sid: src.read_state(PATHS, sid) for sid in sources}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = []

    for p in projects:
        out = project_out(PATHS, p.id)
        if not os.path.exists(out):
            continue  # skip in dry-run / when a step was skipped
        download_url = f"{PUBLIC_BASE}/{p.id}/latest.osm.pbf"
        chains = project_chains(sources, regions, p)
        used = {c[0]: states[c[0]] for c in chains}
        # A merged (world) extract is only as fresh as its oldest source.
        stamps = [s.get("data_timestamp") for s in used.values()]
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
            "pipeline": chains[0] if len(chains) == 1 else [c[0] for c in chains] + ["merge"],
            # From the sources' state files (osmium extract drops the replication
            # header, so the extract itself can't tell).
            "data_timestamp": None if None in stamps else min(stamps, default=None),
            "sources": {sid: {"url": sources[sid].url,
                              "data_timestamp": s.get("data_timestamp"),
                              "sequence_number": s.get("sequence_number"),
                              "update_run_at": s.get("update_run_at")} for sid, s in used.items()},
            "extract_run_at": now,
            "extract_duration_seconds": durations.get(p.id),
            "download_url": download_url,
        }
        publish(os.path.join(p.id, "status.json"), to_json(status))
        index.append({"project": p.id, "download_url": download_url,
                      "data_timestamp": status["data_timestamp"], "extract_run_at": now})

    publish("index.json", to_json({"generated_at": now, "projects": index}))


def load():
    sources, regions = load_tree()
    projects = load_projects(sources, regions)
    return sources, regions, projects, build_plan(sources, regions, projects, PATHS)


def active_sources(sources, plan) -> list:
    return [sources[n["id"]] for n in plan["nodes"] if n["source"]]


def cmd_update() -> int:
    sources, _, _, plan = load()
    for source in active_sources(sources, plan):
        src.update(PATHS, source)
    return 0


def cmd_seed(ids: list[str]) -> int:
    sources, _, _, plan = load()
    chosen = [sources[i] for i in ids if i in sources] if ids else active_sources(sources, plan)
    for source in chosen:
        src.seed(PATHS, source)
    return 0


def cmd_build(dry_run: bool) -> int:
    sources, regions, projects, plan = load()

    with open("plan.json", "w", encoding="utf-8") as fh:
        fh.write(to_json(plan))

    summary_line("## OSM extract build")
    summary_line(f"- sources: **{', '.join(s.id for s in active_sources(sources, plan)) or '—'}**")
    summary_line(f"- active regions: **{sum(1 for n in plan['nodes'] if not n['source'])}**")
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

    missing = [s.id for s in active_sources(sources, plan) if not os.path.exists(os.path.join(PATHS["sources"], f"{s.id}.osm.pbf"))]
    if missing:
        gh_error("regions/regions.yaml", f"source file(s) missing: {', '.join(missing)} — run `python3 -m extractor update` first")
        return 1

    durations: dict[str, float] = {}
    for step in plan["steps"]:
        secs = run_step(step)
        if step.get("project"):
            # Final extract duration per project (world projects: summed over pieces + merge).
            durations[step["project"]] = round(durations.get(step["project"], 0) + secs, 3)
    write_status(sources, regions, projects, durations)
    print(f"Done: {len(projects)} projects, {len(plan['steps'])} steps.")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    cmd, rest = (args[0], args[1:]) if args and not args[0].startswith("-") else ("build", args)
    if cmd == "update":
        return cmd_update()
    if cmd == "seed":
        return cmd_seed(rest)
    if cmd == "build":
        return cmd_build("--dry-run" in rest)
    print(__doc__)
    return 2
