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
