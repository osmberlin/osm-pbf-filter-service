"""Pure helpers for osmium tags-filter expressions and the per-node tag UNION (PLAN.md §B4).

Supported expression shape: [types/]key[=v1,v2,...]
  types: any of n,w,r (omitted => all three)
  key only    -> nwr/amenity        (matches any value)
  key=values  -> nw/amenity=cafe,bench
(osmium has more syntax; this covers what the project configs use.)
"""
import re
from dataclasses import dataclass


@dataclass
class ParsedFilter:
    types: str  # canonical subset of "nwr" in n,w,r order
    key: str
    values: list[str] | None  # None = key-only (any value)


def _canon_types(raw: str) -> str:
    return "".join(t for t in "nwr" if t in raw) or "nwr"


def parse_filter(expr: str) -> ParsedFilter:
    rest = expr.strip()
    types = ""
    pre, slash, post = rest.partition("/")
    # Only treat the part before '/' as object types if it is exactly [nwr]+.
    if slash and re.fullmatch(r"[nwr]+", pre):
        types, rest = pre, post

    key, eq, raw_values = rest.partition("=")
    if not eq:
        return ParsedFilter(_canon_types(types), key, None)
    values = [v.strip() for v in raw_values.split(",") if v.strip()]
    return ParsedFilter(_canon_types(types), key, values or None)


def format_filter(f: ParsedFilter) -> str:
    if f.values:
        return f"{f.types}/{f.key}={','.join(sorted(f.values))}"
    return f"{f.types}/{f.key}"


def merge_filters(exprs: list[str]) -> list[str]:
    """Merge many expressions into the minimal UNION for an intermediate (parent) node.

    Rules: group by key; union object types; "key-only beats values" (broadest
    wins). The result may slightly over-include vs. any single child — that is
    safe, because children re-filter to their exact tags downstream.
    """
    by_key: dict[str, dict] = {}
    for e in exprs:
        p = parse_filter(e)
        if not p.key:
            continue
        a = by_key.setdefault(p.key, {"types": set(), "key_only": False, "values": set()})
        a["types"].update(p.types)
        if p.values is None:
            a["key_only"] = True
        else:
            a["values"].update(p.values)

    return sorted(
        format_filter(
            ParsedFilter(_canon_types("".join(a["types"])), key, None if a["key_only"] else list(a["values"]))
        )
        for key, a in by_key.items()
    )
