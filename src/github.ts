// GitHub Actions reporting helpers (PLAN.md §C1). Plain console output +
// optional step-summary file; no external deps.
//
// Workflow-command values MUST be escaped (the runner parses stdout): otherwise a
// multi-line YAML parse error truncates the annotation, and a crafted message
// containing "\n::error::…" could inject forged commands into the log.
import { appendFileSync } from "node:fs";

/** Escape a workflow-command message (data part). */
const escData = (s: string) => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
/** Escape a workflow-command property (file=…) — data escapes plus : and , . */
const escProp = (s: string) => escData(s).replaceAll(":", "%3A").replaceAll(",", "%2C");

let errors = 0;

/** ::error file=...:: highlights the offending file at the top of the run. */
export function ghError(file: string, msg: string): void {
  errors++;
  console.log(`::error file=${escProp(file)}::${escData(msg)}`);
}

export function ghWarning(file: string, msg: string): void {
  console.log(`::warning file=${escProp(file)}::${escData(msg)}`);
}

/** Number of ghError calls so far — lets the entrypoint fail the run at the end. */
export function errorCount(): number {
  return errors;
}

/** Append a line to the Actions run summary (falls back to stdout locally). */
export function summaryLine(md: string): void {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, md + "\n");
  else console.log(md);
}
