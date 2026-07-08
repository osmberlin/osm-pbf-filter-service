#!/usr/bin/env bash
# Bootstrap Cursor IDE orchestration (.cursor/agents + rule + optional docs).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

SKILL_DIR="$(agent_orchestration_skill_dir)"
REPO_ROOT="$(cd "${TARGET_REPO:-$(agent_orchestration_repo_root "$SKILL_DIR")}" && pwd)"
ASSETS="$SKILL_DIR/assets/cursor"

SKIP_DOCS=false
for arg in "$@"; do
  case "$arg" in
    --no-docs) SKIP_DOCS=true ;;
    -h | --help)
      echo "Usage: bash scripts/init-cursor.sh [--no-docs]"
      echo "Copies Cursor IDE templates into .cursor/ (and docs/agent-orchestration-cursor.md)."
      echo "Set TARGET_REPO=/path/to/repo to override destination."
      exit 0
      ;;
  esac
done

mkdir -p "$REPO_ROOT/.cursor/agents" "$REPO_ROOT/.cursor/rules"

cp "$ASSETS/implementer.md" "$REPO_ROOT/.cursor/agents/implementer.md"
cp "$ASSETS/verifier.md" "$REPO_ROOT/.cursor/agents/verifier.md"
cp "$ASSETS/orchestrator-worker.mdc" "$REPO_ROOT/.cursor/rules/orchestrator-worker.mdc"

DOCS="$REPO_ROOT/docs/agent-orchestration-cursor.md"
if [[ "$SKIP_DOCS" == false ]]; then
  mkdir -p "$(dirname "$DOCS")"
  cp "$ASSETS/docs-agent-orchestration.md" "$DOCS"
fi

echo "Cursor IDE orchestration setup complete in: $REPO_ROOT"
echo "  $REPO_ROOT/.cursor/agents/implementer.md"
echo "  $REPO_ROOT/.cursor/agents/verifier.md"
echo "  $REPO_ROOT/.cursor/rules/orchestrator-worker.mdc"
[[ "$SKIP_DOCS" == false ]] && echo "  $DOCS"
echo ""
echo "Next: commit .cursor/; pick Fable 5; use @orchestrator-worker on large tasks"
