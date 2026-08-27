# Gemma local schema reliability implementation plan

> **For agentic workers:** Use subagent-driven-development with test-first implementation and independent specification then quality review.

**Goal:** Prevent local notes from failing solely because Gemma emits the wrong JSON field shape, without treating valid structure as factual accuracy.

**Architecture:** Keep the approved compact prompt and existing parsers/grounding unchanged. Add a local generation schema for each notes response contract, selected explicitly by the pipeline and passed through the source-label transport to Ollama's `format` field. Non-notes and hosted requests keep their current behavior. Existing source decoding, cancellation, hierarchy conservation and one-repair-per-stage semantics remain authoritative.

**Tech stack:** TypeScript, Vitest, existing Ollama `/api/chat`; no new runtime dependencies.

Issue #674. User approved this direction on 2026-08-27. Continue in the existing isolated branch; no production default change, download, production regeneration, merge or push.

## Task 1: Schema contract and transport

Files: new `electron/llm/meetingNotesSchema.ts`; `meetingNotesTypes.ts`, `meetingNotesPipeline.ts`, `unifiedProvider.ts`; corresponding schema, pipeline and provider unit tests.

- [ ] Add failing tests for flat text/source fields, valid item kinds, nullable owner/due, optional recent win, audit operations/verdicts/dispositions/terminology, and the editor response shape. Require real parser round trips for accepted fixtures, not merely snapshots.
- [ ] Add failing transport tests: notes writer/merge use draft schema; audit uses audit schema; editor explicitly uses editor schema; repair keeps the same contract; other JSON requests still use `format: 'json'`; hosted behavior is unchanged. Verify invalid source labels still fail source validation and semantic errors still consume at most one repair.
- [ ] Implement a focused schema builder using plain JSON Schema objects. Use source-label strings, not offset objects, on the wire. Require the parser's necessary fields and disallow unknown fields. Preserve optional ids needed by inherited commitments and correction records; do not require fabricated ids or owners. Keep shapes compatible with existing parsers. Do not infer the contract by searching prompt text.
- [ ] Carry the explicit response contract in `NotesRequest`, through the actual production provider adapter and the manual acceptance adapter. Enforce schemas only for local notes requests. Advance generation/cache identity to avoid reusing pre-schema output.
- [ ] Run `pnpm exec vitest run tests/unit/meetingNotesSchema.test.ts tests/unit/meetingNotesPipeline.test.ts tests/unit/unifiedProvider.test.ts tests/unit/meetingNotesWire.test.ts`; inspect red before implementation, green afterward. Run scoped Biome/typecheck. Complete independent specification and quality reviews, then commit only implementation files locally.

## Task 2: Bounded local acceptance

Files: existing `tests/manual/meetingNotesLocalGuardrailsAcceptance.test.ts`, new synthetic reliability cases and evidence artifact/report.

- [ ] Preserve historic three-case inputs and outputs. Use installed `gemma4:12b`, thinking disabled, fixed content prompt; record exact digest/settings and raw attempts before decoding. Include seeds 41 and 73, original three cases plus one longer synthetic meeting containing early/late commitments, an unaccepted offer, cancellation and a settled decision.
- [ ] Predeclare content expectations before inference. Keep mechanical counts separate from source-fidelity review. Bound each case and do not loop on failures until a pass appears. Check runtime occupancy read-only; do not kill other clients or alter the server to obtain isolation.
- [ ] Review final visible content and raw attempts for supported ownership, dates, prerequisites, cancellation, decisions, narrative coverage and invented details. Record timeout/format/semantic failures separately. If runtime is occupied, report non-isolation rather than asserting clean performance.

## Task 3: Verification and local checkpoint

- [ ] Run full unit/DOM suite, TypeScript, scoped Biome, changelog and diff checks. Restore/verify Electron SQLite ABI if Node tests require rebuilding it.
- [ ] Record exact results, unresolved acceptance gaps and scope in the evaluation report, decisions, changelog and #674. Commit scoped work locally and inspect status after hooks. Do not claim live recording/rendered-app acceptance from synthetic tests.

**Exit rule:** Finish the bounded implementation and evaluation; do not expand prompts or add pipeline stages to chase fixtures. Default-model promotion requires separate successful product acceptance.
