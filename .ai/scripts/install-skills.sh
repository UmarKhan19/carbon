#!/usr/bin/env bash
# install-skills.sh — Symlink .ai/ rules and skills into .claude/ for Claude Code
#
# The source of truth for rules and skills is .ai/. This script creates
# symlinks in .claude/ so Claude Code auto-loads rules (via paths: frontmatter)
# and discovers skills.
#
# Runs automatically via `pnpm prepare` or manually after cloning.
#
# Usage:
#   bash .ai/scripts/install-skills.sh              # all rules + all skills
#   bash .ai/scripts/install-skills.sh --skills-only # skills only
#   bash .ai/scripts/install-skills.sh --rules-only  # rules only

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AI_DIR="$REPO_ROOT/.ai"
CLAUDE_DIR="$REPO_ROOT/.claude"

INSTALL_RULES=true
INSTALL_SKILLS=true

for arg in "$@"; do
  case "$arg" in
    --skills-only) INSTALL_RULES=false ;;
    --rules-only)  INSTALL_SKILLS=false ;;
    --help|-h)
      echo "Usage: $0 [--skills-only|--rules-only]"
      exit 0
      ;;
  esac
done

# ── Rules ────────────────────────────────────────────────────────────────────

if $INSTALL_RULES; then
  mkdir -p "$CLAUDE_DIR/rules"

  # Remove existing symlinks (preserves real files as safety net)
  find "$CLAUDE_DIR/rules" -maxdepth 1 -type l -delete 2>/dev/null || true

  count=0
  for rule in "$AI_DIR"/rules/*.md; do
    [ -f "$rule" ] || continue
    name=$(basename "$rule")
    ln -sf "../../.ai/rules/$name" "$CLAUDE_DIR/rules/$name"
    count=$((count + 1))
  done

  echo "✓ Linked $count rules → .claude/rules/"
fi

# ── Skills ───────────────────────────────────────────────────────────────────

if $INSTALL_SKILLS; then
  mkdir -p "$CLAUDE_DIR/skills"

  # Remove existing symlinks (preserves real dirs as safety net)
  find "$CLAUDE_DIR/skills" -maxdepth 1 -type l -delete 2>/dev/null || true

  count=0
  for skill in "$AI_DIR"/skills/*/; do
    [ -d "$skill" ] || continue
    name=$(basename "$skill")
    [ -f "$skill/SKILL.md" ] || continue
    ln -sf "../../.ai/skills/$name" "$CLAUDE_DIR/skills/$name"
    count=$((count + 1))
  done

  echo "✓ Linked $count skills → .claude/skills/"
fi

echo "Done. Claude Code will auto-load rules and discover skills via .claude/ symlinks."
