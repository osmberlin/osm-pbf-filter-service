// GitHub Actions reporting helpers (PLAN.md §C1). Plain console output +
// optional step-summary file; no external deps.
import { appendFileSync } from "node:fs";

/** ::error file=...:: highlights the offending file at the top of the run. */
export function ghError(file: string, msg: string): void {
  console.log(`::error file=${file}::${msg}`);
}

export function ghWarning(file: string, msg: string): void {
  console.log(`::warning file=${file}::${msg}`);
}

/** Append a line to the Actions run summary (falls back to stdout locally). */
export function summaryLine(md: string): void {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, md + "\n");
  else console.log(md);
}
