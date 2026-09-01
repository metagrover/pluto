# Person Relationship Briefings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build evidence-tiered person dossiers and move cross-meeting knowledge refresh onto a safe 15-minute idle path.

**Architecture:** A single Electron read model owns person evidence classification and commitment authority. The renderer consumes that model and the existing knowledge-brief compiler. A small main-process coordinator queues cross-meeting refresh after meeting-scoped secondary extraction and passes an abort signal through knowledge synthesis.

**Tech Stack:** Electron, React 18, TypeScript, SQLite via better-sqlite3, Vitest, Tailwind/PostCSS.

---

### Task 1: Person evidence read model

**Files:**
- Create: `src/utils/personBriefing.ts`
- Modify: `electron/db.ts`
- Modify: `electron/main.ts`
- Modify: `src/api/knowledgeGraph.ts`
- Test: `tests/unit/personBriefing.test.ts`

- [ ] Write failing tests proving that confirmed speaker/self-capture meetings outrank calendar-only and mentioned-only meetings, ambiguous calendar names are excluded, and only explicit user-owned commitments appear.
- [ ] Run `pnpm exec vitest run tests/unit/personBriefing.test.ts` and confirm failure because the person briefing model does not exist.
- [ ] Add `PersonMeetingEvidence`, `PersonBriefingCommitment`, and `PersonBriefingDetail` types plus pure sorting and evidence-deduplication helpers.
- [ ] Add `db.getPersonBriefing(personId)` to parse identity bindings, capture identity, calendar context, meeting mentions, explicit owner metadata, source meetings, the person-context doc, and its snapshot.
- [ ] Register `GET_PERSON_BRIEFING` and add `getPersonBriefing(personId)` to the renderer API.
- [ ] Rerun the focused test and confirm it passes.

### Task 2: Person dossier UI

**Files:**
- Modify: `src/components/KnowledgeGraph/PeopleTab.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`
- Modify: `tests/unit/PeopleTab.test.tsx`
- Modify: `tests/unit/AppSearchPluto.dom.test.tsx`

- [ ] Write failing DOM tests proving a directory row selects a person, the dossier renders cited context and explicit commitments, confirmed meetings are primary, weaker evidence is disclosed, and Back to people restores the directory.
- [ ] Run `pnpm exec vitest run tests/unit/PeopleTab.test.tsx tests/unit/AppSearchPluto.dom.test.tsx` and confirm the new expectations fail.
- [ ] Change directory rows to call `onSelectPerson(person.id)` and preserve their compact meeting-style visual language.
- [ ] Add `PersonDossier` with a back header, reliable context, open expectations, recent deliveries, confirmed meeting rows, and scheduled/mentioned disclosures. Use `compileKnowledgeBrief` and omit uncited or weak insight content.
- [ ] Wire `App.tsx` so People owns `selectedPersonId`, clears it on sidebar navigation, and opens a meeting only from dossier evidence rows.
- [ ] Add responsive, focus-visible styles using existing Pluto tokens and no nested card grid.
- [ ] Rerun the focused DOM tests and confirm they pass.

### Task 3: Quiet background knowledge refresh

**Files:**
- Create: `electron/backgroundKnowledgeRefresh.ts`
- Modify: `electron/knowledgeSynthesis.ts`
- Modify: `electron/main.ts`
- Test: `tests/unit/backgroundKnowledgeRefresh.test.ts`
- Test: `tests/unit/knowledgeSynthesisAbort.test.ts`

- [ ] Write failing tests for the 15-minute delay, system-idle/AC/thermal admission, one-at-a-time processing, retry retention, and foreground abort.
- [ ] Run `pnpm exec vitest run tests/unit/backgroundKnowledgeRefresh.test.ts tests/unit/knowledgeSynthesisAbort.test.ts` and confirm failure because the coordinator and abort path do not exist.
- [ ] Implement `createBackgroundKnowledgeRefreshCoordinator` with injected clock, timers, policy, pause state, runner, and content-free error hook.
- [ ] Thread an optional `AbortSignal` through `refreshKnowledgeDocsForMeetingNow`, chunk synthesis, merge synthesis, and provider calls. Treat abort/preemption as stale and retryable, not failed.
- [ ] Replace the synchronous `refreshKnowledgeDocsForMeetingNow` call at the end of `runSecondary` with coordinator enqueue.
- [ ] Instantiate the coordinator with `powerMonitor.getSystemIdleTime()`, battery/thermal policy, pause-reason state, and app shutdown cleanup. Interrupt it whenever foreground pause begins.
- [ ] Rerun the focused background tests and confirm they pass.

### Task 4: Durable product record and verification

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-31-704-person-relationship-briefings.md`

- [ ] Record the precision-first person evidence ladder and immediate-versus-idle processing boundary in `docs/decisions.md`.
- [ ] Add an issue-scoped changelog fragment explaining the user outcome and trust boundary.
- [ ] Run focused tests for People, person briefing, meeting analysis, knowledge synthesis, and background refresh.
- [ ] Run `pnpm test`, `pnpm run lint`, `pnpm run build`, `pnpm run changelog:check`, and `git diff --check`.
- [ ] Launch Electron after repairing the native ABI if necessary; inspect People directory and dossier at desktop and 430px width.
- [ ] Commit the verified implementation on `codex/704-person-briefings` and update issue #704 with evidence and any deviations.
