"""Shared data types + tiny pure validators (no IO, so tests never touch disk)."""
import re
from dataclasses import dataclass, field


@dataclass
class Source:
    """An input file: a Geofabrik continent extract, kept on disk and updated daily."""
    id: str
    url: str  # e.g. https://download.geofabrik.de/europe-latest.osm.pbf

    @property
    def updates_url(self) -> str:
        # Geofabrik publishes daily diffs next to each extract: europe-latest.osm.pbf
        # -> europe-updates. Must match the pbf header's osmosis_replication_base_url
        # exactly (no trailing slash), or pyosmium-up-to-date refuses to run.
        return self.url.removesuffix("-latest.osm.pbf") + "-updates"


# A project area of `region: world` means "every source", merged into one file.
WORLD = "world"


@dataclass
class Region:
    id: str
    parent: str  # parent region id, or a source id (= cut straight from that input file)
    polygon: str | None = None  # repo-relative path to a GeoJSON Polygon/MultiPolygon
    name: str | None = None


@dataclass
class Project:
    id: str  # = folder name
    area: dict  # {"region": ...} or {"polygon": ...}
    filters: list[str]  # osmium tags-filter expressions; [] = keep everything
    extract_strategy: str = "smart"
    add_referenced: bool = True
    description: str | None = None
    repository: str | None = None
    homepage: str | None = None
    contact: str | None = None


# Region ids and project folder names become filesystem paths (work/<id>.pbf,
# extracts/<id>/) and public URLs. Restricting them up front is the systemic
# guard against path traversal ('../x'), nested paths ('a/b'), and broken URLs —
# important because third parties contribute configs via PRs on a public repo.
_ID_RE = re.compile(r"[a-z0-9][a-z0-9_-]*")

ID_RULE = "lowercase letters, digits, '-' or '_', starting with a letter or digit"


def is_valid_id(id: str) -> bool:
    return bool(_ID_RE.fullmatch(id))
