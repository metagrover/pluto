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

## Scope the workflow to the work

Assess scope, uncertainty, and risk before selecting process skills. Use judgment; do not invoke brainstorming or issue-driven development merely because the user raises a point or requests a change.

- **Trivial work:** A small, localized, low-risk change with a clear intended result and straightforward verification, such as a typo, copy/style adjustment, lint cleanup, or an obvious bounded bug fix. Implement directly, run relevant checks and `pnpm run lint`, fix lint failures caused by the change, and open a PR. Keep TDD for non-UI logic. Do not require an issue, brainstorming, design approval, a spec, an implementation plan, or process-only artifacts.
- **Non-trivial work:** Meaningful features, broad or uncertain bug fixes, architecture changes, migrations, or work with significant behavioral or data risk. Use `.agent/skills/issue-driven-development/SKILL.md` and find or create an outcome-sized issue before design, planning, or implementation. Use brainstorming and design approval when substantial design choices or unresolved requirements need agreement; an already agreed design need not be approved again.
- **Escalate when evidence warrants it:** If a seemingly trivial fix reveals broader scope, uncertainty, or risk, move to the non-trivial workflow. A small diff alone does not make a change trivial. Do not ask the user to classify routine work when the available context is sufficient.
- **Precedence:** This scope rule overrides blanket skill triggers and gates, including those in `using-superpowers`, `brainstorming`, and `issue-driven-development`. Read and apply only skills relevant to the assessed work.

## 🧭 Issue-Driven Development

GitHub Issues are Pluto's source of truth for non-trivial active product and implementation work. PRDs and Markdown specs are supporting artifacts, not the live backlog. Trivial work is tracked by its PR and does not need a new issue or an issue search.

- Keep the issue current when scope, acceptance criteria, constraints, or product direction change materially.
- Record durable decisions in `docs/decisions.md`; create ADRs in `docs/adr/` only for high-impact technical choices.
- For issue-backed work, add a uniquely named fragment under `docs/changelog/entries/` when work ships or materially changes Pluto's product/development direction. Trivial PRs can describe the change and verification in the PR itself; do not create an issue solely to satisfy the fragment format. Do not edit the archived `docs/CHANGELOG.md` from ordinary pull requests.

### How to use:
1.  **Search:** Check the `.agent/skills` directory for a skill that matches your current task.
2.  **Activate:** If using a platform with a `Skill` or `activate_skill` tool, use it. Otherwise, read the `SKILL.md` file and follow its instructions exactly.
3.  **Conflict Resolution:** User instructions in `CLAUDE.md`, `GEMINI.md`, or `AGENTS.md` always take precedence over skill instructions.

### Platform Compatibility:
- **Codex:** See `.agent/skills/using-superpowers/references/codex-tools.md` for tool mappings.
- **Gemini / Antigravity:** See `GEMINI.md` for tool mappings.

## 🎯 Constraints

- **TDD:** Always follow Test-Driven Development for non-UI logic.
- **Design First:** For non-trivial work with unresolved requirements or substantial design choices, brainstorm and get design approval before implementation. Apply the scope rule above; trivial fixes proceed directly.
- **No Placeholders:** Never use placeholders. If an image is needed, use your image generation tool.
- **Aesthetics First:** Web components must be visually stunning and premium.
