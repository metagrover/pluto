# GEMINI.md — Antigravity Configuration

This file provides platform-specific mappings and instructions for the **Antigravity** agent (Gemini-based).

## 🛠 Tool Mapping

Antigravity tools differ from Claude Code names. When a skill references a tool, use the following mapping:

| Skill Reference | Antigravity Tool |
| :--- | :--- |
| `Read` (file reading) | `view_file` |
| `Write` (file creation) | `write_to_file` |
| `Edit` (file editing) | `replace_file_content` / `multi_replace_file_content` |
| `Bash` (run commands) | `run_command` |
| `Grep` (search content) | `grep_search` |
| `Glob` (search files) | `run_command` (use `find` or `ls`) |
| `WebSearch` | `search_web` |
| `WebFetch` | `read_url_content` |
| `Task` (subagent) | `browser_subagent` (for browser tasks) or follow instructions inline |

## ⚡️ Skill Activation

Skills are located in `.agent/skills/`. To use a skill:
1.  Read the `SKILL.md` file using `view_file`.
2.  Announce to the user which skill you are using.
3.  Follow the instructions in the skill exactly.

## 🎯 Project Guidelines

- **Issue-Driven Development:** GitHub Issues are the source of truth for active work. Use `.agent/skills/issue-driven-development/SKILL.md` before feature work, product changes, architecture/process changes, or meaningful bug fixes.
- **Issue Currency:** Find or create an outcome-sized issue before writing a design, implementation plan, or code. Update the issue when scope, acceptance criteria, constraints, or product direction change materially.
- **Durable Memory:** Record durable decisions in `docs/decisions.md`; use `docs/adr/` only for high-impact technical decisions; update `docs/CHANGELOG.md` when work ships or materially changes Pluto's direction.
- **Design Doc Location:** Always save design specs to `docs/superpowers/specs/`.
- **Implementation Plans:** Save to `docs/superpowers/plans/`.
- **TDD:** Use `vitest` for running tests.
