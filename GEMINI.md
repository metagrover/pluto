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

- **Workflow Scope:** Follow **Scope the workflow to the work** in `AGENTS.md`; it overrides blanket skill triggers. Trivial, clear, localized, low-risk fixes go directly to implementation, relevant checks, lint, and a PR without an issue search, new issue, brainstorming, design approval, spec, or plan. Escalate if scope or risk grows.
- **Issue-Driven Development:** For non-trivial work, follow the issue and durable-memory guidance in `AGENTS.md`. Brainstorm when unresolved requirements or substantial design choices need agreement.
- **Durable Memory:** Use `docs/decisions.md` for durable decisions and `docs/adr/` for high-impact technical choices. Issue-backed work uses fragments under `docs/changelog/entries/`; do not edit the archived `docs/CHANGELOG.md`.
- **Design Doc Location:** Always save design specs to `docs/superpowers/specs/`.
- **Implementation Plans:** Save to `docs/superpowers/plans/`.
- **TDD:** Use `vitest` for running tests.
