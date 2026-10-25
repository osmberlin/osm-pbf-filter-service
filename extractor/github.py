"""GitHub Actions reporting helpers (PLAN.md §C1): annotations + step summary.

Workflow-command values MUST be escaped (the runner parses stdout): otherwise a
multi-line YAML parse error truncates the annotation, and a crafted message
containing "\\n::error::…" could inject forged commands into the log.
"""
import os

_errors = 0


def _esc_data(s: str) -> str:
    return s.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _esc_prop(s: str) -> str:
    return _esc_data(s).replace(":", "%3A").replace(",", "%2C")


def gh_error(file: str, msg: str) -> None:
    """::error file=...:: highlights the offending file at the top of the run."""
    global _errors
    _errors += 1
    print(f"::error file={_esc_prop(file)}::{_esc_data(msg)}", flush=True)


def gh_warning(file: str, msg: str) -> None:
    print(f"::warning file={_esc_prop(file)}::{_esc_data(msg)}", flush=True)


def error_count() -> int:
    return _errors


def summary_line(md: str) -> None:
    """Append a line to the Actions run summary (falls back to stdout locally)."""
    f = os.environ.get("GITHUB_STEP_SUMMARY")
    if f:
        with open(f, "a", encoding="utf-8") as fh:
            fh.write(md + "\n")
    else:
        print(md, flush=True)
