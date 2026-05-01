# CLAUDE.md — Codex & Claude Configuration

This repository uses **Superpowers** skills. 

## ⚡️ Skill Usage

Skills are located in `.agent/skills/`.

- If your platform supports the `Skill` tool, use it to load skills.
- Otherwise, read the `SKILL.md` files in `.agent/skills/` and follow them exactly.

## 🧭 Issue-Driven Development

GitHub Issues are Pluto's source of truth for active product and implementation work.

- Use `.agent/skills/issue-driven-development/SKILL.md` before feature work, product changes, architecture/process changes, or meaningful bug fixes.
- Find or create an outcome-sized GitHub Issue before writing a design, implementation plan, or code.
- Update the issue when scope, acceptance criteria, constraints, or product direction change materially.
- Record durable decisions in `docs/decisions.md`; use `docs/adr/` only for high-impact technical decisions.
- Update `docs/CHANGELOG.md` when work ships or materially changes Pluto's direction.

## 🛠 Tool Mapping (for Codex)

If you are running on Codex, please refer to the tool mapping in:
`.agent/skills/using-superpowers/references/codex-tools.md`

## 🎯 Best Practices

- **Brainstorming:** Perform design brainstorming before any code changes.
- **TDD:** Write tests before implementation.
- **Subagents:** Use subagents for complex, independent tasks if supported by your platform.
