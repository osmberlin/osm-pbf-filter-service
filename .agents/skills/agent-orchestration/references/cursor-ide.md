# Agent orchestration — Cursor IDE

**Fable 5** orchestrates in Cursor Agent chat. **Composer 2.5** workers run as subagents with explicit `model:` pins in `.cursor/agents/`.

---

## What goes where

| Piece                 | Location                                       | How it gets there                                                      |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Procedure + templates | fixmyskills `agent-orchestration`              | Skills CLI → `.agents/skills/`                                         |
| Worker model pins     | `.cursor/agents/implementer.md`, `verifier.md` | `init-cursor.sh`                                                       |
| Orchestrator behavior | `.cursor/rules/orchestrator-worker.mdc`        | `init-cursor.sh`                                                       |
| Human cheat sheet     | `docs/agent-orchestration-cursor.md`           | `init-cursor.sh` (optional `--no-docs`)                                |
| Parent model          | Cursor Agent model picker                      | You pick Fable 5 each session                                          |
| Personal workers      | `~/.cursor/agents/`                            | Manual copy — see [cursor-personal-setup.md](cursor-personal-setup.md) |

```mermaid
flowchart LR
  Fable["Fable 5"]
  Rule["@orchestrator-worker"]
  Workers[".cursor/agents composer pin"]
  Fable --> Rule --> Workers
```

Skills CLI does **not** install `.cursor/agents/` — run `init-cursor.sh` after `bunx skills add`.

---

## Bootstrap (one-time per repo)

```bash
bunx skills add FixMyBerlin/fixmyskills --skill agent-orchestration -a cursor -y
bash .agents/skills/agent-orchestration/scripts/init-cursor.sh
git add .cursor/agents .cursor/rules docs/agent-orchestration-cursor.md skills-lock.json
git commit -m "Add Cursor Fable orchestration setup"
```

`--no-docs` skips the docs copy. `TARGET_REPO=/path` overrides destination.

Reset templates: re-run `init-cursor.sh` (overwrites).

---

## Daily usage

1. Pick **Fable 5** (any effort tier).
2. Start large tasks with **`@orchestrator-worker`**:

```
@orchestrator-worker

Implement [feature]. You orchestrate only:
- explore for discovery
- /implementer for edits and tests
- /verifier before declaring done
Do not edit files yourself.
```

**Skip** trivial one-file edits — subagent startup costs more than inline work.

---

## Delegation

| Task                             | Delegate to                    |
| -------------------------------- | ------------------------------ |
| Codebase search                  | Built-in `explore`             |
| Shell, tests, state-changing git | `/implementer` or `shell`      |
| Multi-file implementation        | `/implementer`                 |
| Post-change validation           | `/verifier` (readonly)         |
| Browser / UI                     | `browser` or agent-browser MCP |

Orchestrator may inline only trivial fixes (~10 lines) or when user says “no subagents”.

---

## Worker model pins

`.cursor/agents/` frontmatter: `model: composer-2.5[fast=false]` (default; `composer-2.5[]` is an alternative base pin). Verifier adds `readonly: true`. **Avoid** `inherit`/omitted — bills at Fable rates. Parallel subagents = parallel token spend.

---

## Customize & verify

- Edit copied files in the target repo (`verifier.md` check commands, rule delegation for MCP, etc.). Do **not** put orchestration in global Cursor User Rules — use `@orchestrator-worker` per task.
- Verify: `@orchestrator-worker` in rule picker; `/implementer` and `/verifier` show `composer-2.5[fast=false]`; delegation prompt spawns workers instead of editing directly.

---

## References

- [Cursor Subagents](https://cursor.com/docs/subagents)
- [Claude Fable 5](https://cursor.com/docs/models/claude-fable-5)
- Prototype: tilda-geo commit `9572b85`
