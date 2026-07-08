# Agent orchestration — Cursor IDE

**Goal:** **Fable 5** plans; **Composer 2.5** subagents (`/implementer`, `/verifier`) execute.

Full guide: fixmyskills `agent-orchestration` → `references/cursor-ide.md`.

## Setup

1. Pick **Fable 5** in the Agent model picker (any effort tier).
2. [`.cursor/agents/`](../.cursor/agents/) + [`.cursor/rules/orchestrator-worker.mdc`](../.cursor/rules/orchestrator-worker.mdc)
3. Bootstrap: `bash .agents/skills/agent-orchestration/scripts/init-cursor.sh`

## Daily usage

```
@orchestrator-worker

Implement [feature]. You orchestrate only:
- explore for discovery
- /implementer for edits and tests
- /verifier before declaring done
Do not edit files yourself.
```

## Cost traps

- `model: inherit` on subagents = Fable pricing — workers pin `composer-2.5[fast=false]`.
- Parallel subagents = parallel token spend.

## References

- [Cursor Subagents](https://cursor.com/docs/subagents)
- [Claude Fable 5](https://cursor.com/docs/models/claude-fable-5)
