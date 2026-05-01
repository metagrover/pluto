---
name: issue-driven-development
description: Use when starting feature work, product changes, architecture/process changes, bug fixes with product impact, or agentic implementation planning in Pluto.
---

# Issue-Driven Development

## Purpose

GitHub Issues are Pluto's active source of truth for evolving product and implementation intent. Repo docs preserve durable memory after decisions are made or work ships.

Use this skill before writing a design, implementation plan, or code for meaningful Pluto work.

## Core Rule

Start from an outcome-sized GitHub Issue.

An outcome-sized issue describes a user, product, technical, or process outcome that can ship in one focused PR or a small PR stack. Tasks, notes, and changed assumptions live inside that issue.

## Workflow

1. **Find or create the issue**
   - Search open issues first:
     ```bash
     gh issue list --repo metagrover/pluto --limit 30
     ```
   - If no suitable issue exists, create one with the closest template:
     - Product outcome
     - Bug or regression
     - Technical debt or architecture
   - Use the issue URL or number in branch names, plans, PR descriptions, and final summaries.

2. **Keep the issue current**
   - If scope, acceptance criteria, product direction, or constraints change materially, add an issue comment before continuing.
   - Do not treat the first plan as sacred when implementation reveals a better product direction.
   - The issue should answer: current goal, context, acceptance criteria, constraints, open questions, and useful agent notes.

3. **Use existing planning skills after the issue exists**
   - For creative/product work, use `brainstorming`.
   - For multi-step implementation, use `writing-plans`.
   - For execution, use `subagent-driven-development` or `executing-plans`.
   - This skill does not replace those skills; it anchors them to the live issue.

4. **Record durable memory**
   - Update `docs/decisions.md` when a product, design, process, or architecture decision should survive beyond the issue thread.
   - Create `docs/adr/YYYY-MM-DD-short-title.md` only for high-impact technical decisions with credible alternatives and long-lived consequences.
   - Update `docs/CHANGELOG.md` when work ships or materially changes Pluto's product/development direction.

5. **Finish with traceability**
   - PR descriptions should link the issue and mention any decision-log, ADR, or changelog updates.
   - Final agent summaries should answer:
     - What issue is this tied to?
     - What changed from the original intent?
     - What durable decision was recorded?
     - What shipped summary was recorded?

## When Not To Create A New Issue

- The user explicitly asks for a tiny local command or explanation.
- The work only fixes spelling or formatting in already-opened files.
- The current conversation is already tied to a suitable issue.

When in doubt, reuse an existing relevant issue rather than creating a duplicate.

## Common Mistakes

- Writing a new Markdown spec while the issue stays stale.
- Hiding product divergence in a final summary instead of commenting on the issue.
- Creating ADRs for routine product decisions that belong in `docs/decisions.md`.
- Writing changelog entries that say only what changed, without why it changed.
