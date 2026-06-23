// Pure helpers for osmium tags-filter expressions and computing the per-node
// tag UNION (PLAN.md §B4). No IO / no Bun imports — unit-testable.
//
// Supported expression shape: [types/]key[=v1,v2,...]
//   types: any of n,w,r (omitted => all three)
//   key only    -> nwr/amenity        (matches any value)
//   key=values  -> nw/amenity=cafe,bench
// (osmium has more syntax; this covers what the project configs use.)

const TYPE_ORDER = ["n", "w", "r"] as const;

export type ParsedFilter = {
  types: string; // canonical subset of "nwr" in n,w,r order
  key: string;
  values: string[] | null; // null = key-only (any value)
};

function canonTypes(raw: string): string {
  const set = new Set(raw.split("").filter((c) => c === "n" || c === "w" || c === "r"));
  if (set.size === 0) return "nwr";
  return TYPE_ORDER.filter((t) => set.has(t)).join("");
}

export function parseFilter(expr: string): ParsedFilter {
  const trimmed = expr.trim();
  let types = "";
  let rest = trimmed;

  const slash = trimmed.indexOf("/");
  if (slash >= 0) {
    const pre = trimmed.slice(0, slash);
    // Only treat the part before '/' as object types if it is exactly [nwr]+.
    if (/^[nwr]+$/.test(pre)) {
      types = pre;
      rest = trimmed.slice(slash + 1);
    }
  }

  const eq = rest.indexOf("=");
  if (eq < 0) return { types: canonTypes(types), key: rest, values: null };

  const key = rest.slice(0, eq);
  const values = rest.slice(eq + 1).split(",").map((v) => v.trim()).filter(Boolean);
  return { types: canonTypes(types), key, values: values.length ? values : null };
}

export function formatFilter(f: ParsedFilter): string {
  return f.values && f.values.length
    ? `${f.types}/${f.key}=${[...f.values].sort().join(",")}`
    : `${f.types}/${f.key}`;
}

/**
 * Merge many expressions into the minimal UNION for an intermediate (parent)
 * node. Rules: group by key; union object types; "key-only beats values"
 * (broadest wins). The result may slightly over-include vs. any single child —
 * that is safe, because children re-filter to their exact tags downstream.
 */
export function mergeFilters(exprs: string[]): string[] {
  type Agg = { types: Set<string>; keyOnly: boolean; values: Set<string> };
  const byKey = new Map<string, Agg>();

  for (const e of exprs) {
    const p = parseFilter(e);
    if (!p.key) continue;
    let a = byKey.get(p.key);
    if (!a) { a = { types: new Set(), keyOnly: false, values: new Set() }; byKey.set(p.key, a); }
    for (const c of p.types) a.types.add(c);
    if (p.values === null) a.keyOnly = true;
    else for (const v of p.values) a.values.add(v);
  }

  const out: string[] = [];
  for (const [key, a] of byKey) {
    const types = TYPE_ORDER.filter((t) => a.types.has(t)).join("");
    out.push(a.keyOnly ? `${types}/${key}` : `${types}/${key}=${[...a.values].sort().join(",")}`);
  }
  return out.sort();
}
