# CLAUDE.md — Codex & Claude Configuration

This repository uses **Superpowers** skills. 

## ⚡️ Skill Usage

Skills are located in `.agent/skills/`.

- If your platform supports the `Skill` tool, use it to load skills.
- Otherwise, read the `SKILL.md` files in `.agent/skills/` and follow them exactly.

## 🛠 Tool Mapping (for Codex)

If you are running on Codex, please refer to the tool mapping in:
`.agent/skills/using-superpowers/references/codex-tools.md`

## 🎯 Best Practices

- **Brainstorming:** Perform design brainstorming before any code changes.
- **TDD:** Write tests before implementation.
- **Subagents:** Use subagents for complex, independent tasks if supported by your platform.
