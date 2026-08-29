# AGENTS.md — Pluto

Intelligent meeting assistant and "second brain" application.

## 🚀 Development Workflow

- **Install:** `pnpm install`
- **Build native:** `pnpm run build-native`
- **Run dev:** `pnpm run dev`
- **Test:** `pnpm run test`
- **Lint:** `pnpm run lint`

## 🛠 Project Structure

- `src/` - React/Electron source code
- `python/` - Python server (WhisperX) and requirements
- `scripts/` - Build and setup automation scripts
- `electron/` - Electron main process code
- `.agent/skills/` - Superpowers skills for agentic workflows

## ⚡️ Superpowers Skills

This repository is equipped with **Superpowers** skills. These skills provide a disciplined, multi-step workflow for complex tasks.

**REQUIRED:** You MUST check for relevant skills before taking any action.

## 🧭 Issue-Driven Development

GitHub Issues are Pluto's source of truth for active product and implementation work. PRDs and Markdown specs are supporting artifacts, not the live backlog.

- Before starting feature work, product changes, architecture/process changes, or meaningful bug fixes, use `.agent/skills/issue-driven-development/SKILL.md`.
- Find or create an outcome-sized GitHub Issue before writing a design, implementation plan, or code.
- Keep the issue current when scope, acceptance criteria, constraints, or product direction change materially.
- Record durable decisions in `docs/decisions.md`; create ADRs in `docs/adr/` only for high-impact technical choices.
- Add a uniquely named fragment under `docs/changelog/entries/` when work ships or materially changes Pluto's product/development direction. Do not edit the archived `docs/CHANGELOG.md` from ordinary pull requests.

### How to use:
1.  **Search:** Check the `.agent/skills` directory for a skill that matches your current task.
2.  **Activate:** If using a platform with a `Skill` or `activate_skill` tool, use it. Otherwise, read the `SKILL.md` file and follow its instructions exactly.
3.  **Conflict Resolution:** User instructions in `CLAUDE.md`, `GEMINI.md`, or `AGENTS.md` always take precedence over skill instructions.

### Platform Compatibility:
- **Codex:** See `.agent/skills/using-superpowers/references/codex-tools.md` for tool mappings.
- **Gemini / Antigravity:** See `GEMINI.md` for tool mappings.

## 🎯 Constraints

- **TDD:** Always follow Test-Driven Development for non-UI logic.
- **Design First:** For any feature or modification, brainstorm the design and get user approval before writing code.
- **No Placeholders:** Never use placeholders. If an image is needed, use your image generation tool.
- **Aesthetics First:** Web components must be visually stunning and premium.
