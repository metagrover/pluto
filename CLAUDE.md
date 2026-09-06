# CLAUDE.md — Codex & Claude Configuration

This repository uses **Superpowers** skills. 

## ⚡️ Skill Usage

Skills are located in `.agent/skills/`.

- If your platform supports the `Skill` tool, use it to load skills.
- Otherwise, read the `SKILL.md` files in `.agent/skills/` and follow them exactly.

## Workflow scope

Follow **Scope the workflow to the work** in `AGENTS.md`. It overrides blanket skill triggers: trivial, clear, localized, low-risk fixes go directly to implementation, relevant checks, lint, and a PR without an issue search, new issue, brainstorming, design approval, spec, or plan. If the scope or risk grows, use the non-trivial workflow.

For non-trivial work, follow the issue and durable-memory guidance in `AGENTS.md`. Use changelog fragments under `docs/changelog/entries/` for issue-backed work; do not edit the archived `docs/CHANGELOG.md`.

## 🛠 Tool Mapping (for Codex)

If you are running on Codex, please refer to the tool mapping in:
`.agent/skills/using-superpowers/references/codex-tools.md`

## 🎯 Best Practices

- **Brainstorming:** Use for non-trivial work with unresolved requirements or substantial design choices, as scoped in `AGENTS.md`.
- **TDD:** Write tests before implementation.
- **Subagents:** Use subagents for complex, independent tasks if supported by your platform.
