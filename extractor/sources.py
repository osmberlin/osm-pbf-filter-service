"""Keep the source files (Geofabrik continent extracts) on disk and up to date.

    python3 -m extractor update          # nightly: seed missing sources, apply daily diffs
    python3 -m extractor seed [ids...]   # manual: re-download sources from scratch

Only sources that some project uses are touched, so an unused continent never
takes disk space or download time.
"""
import hashlib
import json
import os
import subprocess
import urllib.request
from datetime import datetime, timezone

from .github import gh_error

# pyosmium-up-to-date downloads at most this many MB of diffs per pass, and every
# pass rewrites the whole source file. ~3 GB covers weeks of daily diffs for a
# continent, so a normal catch-up is a single rewrite.
MAX_DOWNLOAD_MB = 3000
MAX_PASSES = 10


def state_file(paths: dict, sid: str) -> str:
    return os.path.join(paths["sources"], f"{sid}.state.json")


def read_state(paths: dict, sid: str) -> dict:
    try:
        with open(state_file(paths, sid), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _header(file: str, key: str) -> str | None:
    """A pbf header option — no `-e`, so osmium reads only the header, not the data."""
    r = subprocess.run(["osmium", "fileinfo", "-g", f"header.option.{key}", file],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return r.stdout.strip() or None


def _write_state(paths: dict, source, file: str, started: str, seconds: float) -> None:
    seq = _header(file, "osmosis_replication_sequence_number")
    state = {
        "source": source.id,
        "url": source.url,
        "data_timestamp": _header(file, "osmosis_replication_timestamp"),
        "sequence_number": int(seq) if seq and seq.isdigit() else None,
        "update_run_at": started,
        "update_duration_seconds": round(seconds),
    }
    with open(state_file(paths, source.id), "w", encoding="utf-8") as fh:
        fh.write(json.dumps(state, indent=2) + "\n")
    print(f"==> {source.id}: data as of {state['data_timestamp']} (seq {state['sequence_number']})", flush=True)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def seed(paths: dict, source) -> None:
    """Download a source and its .md5, verify, then swap it in atomically."""
    os.makedirs(paths["sources"], exist_ok=True)
    target = os.path.join(paths["sources"], f"{source.id}.osm.pbf")
    tmp = target + ".download"
    started, t0 = _now(), datetime.now().timestamp()
    print(f"==> {source.id}: downloading {source.url}", flush=True)
    try:
        # curl for retries (quiet: a progress meter only clutters the Actions log).
        # No resume (-C -): "-latest" rotates daily, so a stale partial would splice
        # two different files.
        subprocess.run(["curl", "-fsSL", "--retry", "3", "-o", tmp, source.url], check=True)
        with urllib.request.urlopen(source.url + ".md5", timeout=60) as r:
            expected = r.read().decode().split()[0]
        h = hashlib.md5()
        with open(tmp, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() != expected:
            raise RuntimeError(f"checksum mismatch (expected {expected}, got {h.hexdigest()})")
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    _write_state(paths, source, target, started, datetime.now().timestamp() - t0)


def update(paths: dict, source) -> None:
    """Apply Geofabrik's daily diffs; seed first if the file is missing."""
    target = os.path.join(paths["sources"], f"{source.id}.osm.pbf")
    if not os.path.exists(target):
        seed(paths, source)
        return
    started, t0 = _now(), datetime.now().timestamp()
    # Exit codes (pyosmium-up-to-date(1)): 0 = up to date; 1 = updates applied but
    # more remain (download cap hit) — routine after a gap; >1 = real error.
    for attempt in range(1, MAX_PASSES + 1):
        print(f"==> {source.id}: applying diffs from {source.updates_url} (pass {attempt})", flush=True)
        before = _header(target, "osmosis_replication_sequence_number")
        rc = subprocess.run(["pyosmium-up-to-date", "--size", str(MAX_DOWNLOAD_MB),
                             "--server", source.updates_url, target]).returncode
        if rc == 0:
            break
        # 1 should mean "progress, more to come", but an uncaught exception in
        # pyosmium also exits with 1. No sequence change = no progress = error.
        if rc != 1 or _header(target, "osmosis_replication_sequence_number") == before:
            raise RuntimeError(f"pyosmium-up-to-date failed for {source.id} (exit code {rc})")
    else:
        gh_error(target, f"{source.id} still behind after {MAX_PASSES} passes; progress is kept")
    _write_state(paths, source, target, started, datetime.now().timestamp() - t0)
