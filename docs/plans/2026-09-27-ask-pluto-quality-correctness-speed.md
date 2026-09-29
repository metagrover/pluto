# Ask Pluto: Quality, Correctness, and Speed Plan

Date: 2026-09-27

## Outcome

Improve Ask Pluto as a general conversational system rather than adding query-specific patches. The implementation should preserve structured conversational context, prefer the freshest synthesized information, produce useful and human answers, and substantially reduce latency.

The system must continue to use only synthesized meeting notes, project information, people information, and structured tasks or decisions. Raw transcripts must never enter Ask Pluto retrieval, prompts, model context, fallback behavior, or generated answers.

## Current baseline

The production-data benchmark is stored locally at:

`artifacts/ask-pluto-benchmark/live-2026-09-28T06-28-59-988Z.json`

Current results:

- 4 of 9 conversations passed every automated quality check.
- First-token latency was 40.3 seconds p50 and 54.2 seconds p95.
- Total latency was 54.8 seconds p50 and 71.8 seconds p95.
- The prepared “What should I focus on?” response completed in 4.7 seconds because it avoided normal model generation.
- All nine queries used synthesized information only, with zero transcript passages.

The main observed failures were:

- Project scope degrading into an unscoped meeting set during follow-ups.
- A generic project entity such as `Project` beating a specific project such as `Pluto`.
- Stale synthesized information being presented as current.
- Inline source markers leaking into visible answers.
- Answers ending in truncated sentences or incomplete source markers.
- Detail requests automatically taking the slow deep-reasoning path.
- Answers that were mechanically organized, repetitive, or lacking a clear point of view.

## Design principles

These are invariants, not optional optimizations:

1. Ask Pluto reads synthesized meeting notes, project profiles, people profiles, and structured tasks or decisions only.
2. Raw transcripts never enter retrieval, prompts, model context, or fallbacks.
3. Conversation scope is structured state rather than something reconstructed from phrases such as “tell me more.”
4. Synthesized information is trusted. There is no sentence-by-sentence lexical validation or deletion of otherwise useful prose.
5. Provenance remains available in the references interface, but Pluto does not narrate grounding policy or expose citation syntax in its prose.
6. Response depth and reasoning complexity are separate decisions. A request for more detail can receive a longer answer without automatically invoking the slowest reasoning path.
7. Performance changes are accepted only if correctness and answer quality remain at least as good.
8. A new explicitly named topic replaces inherited scope; elliptical follow-ups continue the active structured topic.

## Phase 1: Repair conversational correctness

### 1.1 Preserve active project scope

The query handler currently constructs both an explicitly matched `projectRecall` and an `inheritedProjectRecall`, but several later decisions continue using only the explicit recall. This permits a project conversation to degrade into a generic `meeting_set` after an elliptical follow-up.

Introduce one authoritative project value:

```ts
const effectiveProjectRecall = projectRecall ?? inheritedProjectRecall;
```

Use that value consistently for:

- Context selection.
- Prompt project context.
- Retrieval summaries and traces.
- Prepared workspace-answer eligibility.
- Meeting-section constraints.
- Search counts and source reporting.
- Conversation topic persisted for the next turn.

An inherited project must not depend on whether the generated prose happens to cite one of its sources. The active topic is conversation state, not a side effect of citation generation.

Primary implementation area:

- `electron/main.ts`

### 1.2 Fix generic project matching

`matchProjectEntity` currently allows generic entities such as `Project` to beat a meaningful project such as `Pluto`, because direct matches are scored largely by label length.

Change matching so that:

- Generic taxonomy names such as `Project`, `Initiative`, `Pipeline`, `Workstream`, and `Program` cannot override a meaningful named entity.
- Explicit, token-bounded project names win.
- Canonical identity and aliases are preferred over incidental key-term matches.
- A specifically named new entity replaces inherited conversation scope.
- A generic phrase such as “the project” continues the prior project only when an active project context exists.

Primary implementation area:

- `electron/intelligence/queryEngine.ts`

Required regression cases:

- “Give me a current read on the Pluto project” selects Pluto, not `Project`.
- A specifically named project followed by “what changed recently?” remains scoped to that project.
- A specifically named project followed by “now tell me about Pluto” deliberately switches to Pluto.
- A project discussion followed by a person-specific question about Morgan leaves project scope.
- “The project” without an active project does not invent a project match.

### 1.3 Add a synthesized-only runtime invariant

Although the current live benchmark found no transcript passages, enforce the boundary independently of individual retrieval implementations:

- Sanitize final retrieval context before prompt construction.
- Reject or remove any `transcript_passages`.
- Emit a diagnostic if a future change attempts to introduce transcript evidence.
- Never fall back to a transcript search when synthesized retrieval is empty.

Test the invariant across project, person, workspace, temporal, meeting, follow-up, drafting, and no-evidence routes.

### Phase 1 acceptance gate

- All existing Ask Pluto tests pass.
- New scope and entity regression tests pass.
- The five failing live-benchmark turns no longer drift topics.
- Every response reports zero transcript passages.
- No performance tuning begins until this gate passes.

## Phase 2: Improve freshness and answer quality

### 2.1 Establish a freshness policy for synthesized sources

Use this precedence for current-state questions:

1. Recent matching synthesized meeting-note sections.
2. Current project or people profile fields.
3. Older workspace snapshots as baseline context.

When synthesized sources conflict:

- Prefer the newest explicit update when its timestamp and subject match the question.
- Do not silently combine old and new statuses.
- If a conflict materially changes the answer, explain that the latest note supersedes an earlier snapshot.
- Do not describe an old target date as upcoming merely because it remains in a project profile.
- If equally recent synthesized sources genuinely disagree, use a concise uncertainty statement rather than arbitrarily choosing one.

Project recall should rank contributing meetings and sections before applying result limits. Recent, specific synthesized sections should not be discarded because an older list was sliced first.

Primary implementation area:

- `electron/intelligence/queryEngine.ts`

Required tests:

- A newer note supersedes an older workspace snapshot.
- The latest project section wins over an older matching section.
- Completed work is not presented as open.
- Stale deadlines are labeled historically or omitted.
- Equal-date contradictory synthesized notes produce bounded uncertainty.

### 2.2 Separate response depth from reasoning complexity

The current router sends every non-lookup task to deep reasoning. Expansion requests are classified as analysis, so a simple “tell me more” request receives the expensive 512-token deep path even when Pluto only needs to summarize trusted project notes.

Replace this one-dimensional choice with two independent decisions:

- Reasoning mode: `fast` or `deep`.
- Response depth: `concise` or `detailed`.

Expected routing:

| Request | Reasoning | Depth |
| --- | --- | --- |
| “What should I focus on?” | Fast or prepared | Concise |
| “Tell me more about Project Atlas” | Fast | Detailed |
| “Compare Project Atlas and Pluto risks” | Deep | Detailed |
| “Why is this blocked?” | Deep when synthesis is required | Appropriate to the question |
| “Draft a message to Gamma” | Fast | Task-appropriate |

A fast detailed response should have approximately 320–384 output tokens without using deep reasoning. Deep reasoning should remain reserved for comparisons, causal analysis, contradictions, multi-project synthesis, and nontrivial recommendations.

Primary implementation areas:

- `electron/intelligence/askPlutoConversation.ts`
- `electron/intelligence/askPlutoReasoning.ts`
- `electron/llm/unifiedProvider.ts`
- `src/types/askPlutoQuery.ts`

### 2.3 Make the prose naturally useful

Use a task-level response contract rather than fixed wording or per-query templates:

- Lead with the answer, judgment, or recommendation.
- Group related information under two or three descriptive labels when structure helps.
- Explain why a priority matters.
- Give the next concrete move when the synthesized information supports one.
- Distinguish current state, recent change, risk, and next action.
- Avoid database terminology, grounding narration, repetitive caveats, and mechanical inventories.
- Permit a conversational point of view such as “I’d start with…” while keeping factual claims within synthesized context.
- Do not force headings when a short conversational paragraph is clearer.

The response shape should come from the task and available information, not a hard-coded user phrase.

Primary implementation area:

- `electron/intelligence/queryPrompts.ts`

### 2.4 Remove inline citation generation from synthesized answers

For the trusted synthesized-data route:

- Stop asking the model to write `[Source N]` markers.
- Build the references drawer deterministically from the synthesized context used.
- Retain source and section provenance in response metadata.
- Keep citation parsing only as transitional cleanup and for stricter workflows that still require it.

This should reduce prompt complexity, improve prose, and eliminate the source-marker leakage observed in the benchmark.

### 2.5 Harden response finalization

During the transition away from inline markers:

- Remove singular, plural, grouped, ranged, and unfinished source markers.
- Detect incomplete trailing citation syntax.
- Trim genuinely incomplete trailing sentences conservatively.
- Preserve valid markdown lists and intentional short fragments.
- Never return endings such as `late August 202` or `[Source 4`.

Primary implementation area:

- `electron/intelligence/citationEngine.ts`

Required tests:

- `[Source 1]`, `[Sources 1, 2]`, ranges, and incomplete markers are removed.
- A complete markdown list remains intact.
- A genuinely incomplete final sentence is removed without damaging earlier content.
- Streaming never exposes an incomplete citation marker.
- Finalization does not remove a valid short closing sentence.

## Phase 3: Measure and improve speed

### 3.1 Add complete phase timing

Measure the full request rather than only the later retrieval portion:

- Settings and database setup.
- Conversation resolution.
- Workspace, project, or person recall.
- Search and context assembly.
- Prompt construction.
- Provider acquisition and model residency.
- Provider request to first callback.
- First raw token.
- First visible token.
- Generation.
- Finalization.
- Total request.

Expose these diagnostics in benchmark output and development logs only. They should not appear in normal user-facing UI.

Primary implementation areas:

- `electron/main.ts`
- `src/types/askPlutoQuery.ts`
- `scripts/run_ask_pluto_live_benchmark.mjs`

### 3.2 Remove known avoidable work

After the timing data is trustworthy:

- Reuse settings loaded at request start instead of loading them again before provider creation.
- Avoid broad retrieval when a prepared workspace answer already has sufficient synthesized context.
- Constrain inherited project follow-ups directly to the project context instead of running generic expansion retrieval first.
- Remove duplicated context between project artifacts and matching meeting sections.
- Rank context before prompt construction and enforce a bounded prompt budget.
- Keep Ollama resident during an active Ask Pluto session.
- Cache prepared workspace recall by synthesis revision, with explicit invalidation when synthesized data changes.

Each optimization should have an isolated before-and-after benchmark. Broad caching should not be introduced until invalidation behavior is explicit.

### 3.3 Treat model/runtime changes as an explicit decision

If prompt reduction, context selection, response routing, and residency improvements cannot meet the latency goals on the current local hardware, model or runtime selection should become an explicit product decision. Do not disguise a model-performance limitation with more phrase-specific routing heuristics.

## Phase 4: Production-data evaluation

Expand the existing nine-query benchmark into a realistic conversational suite covering:

- Workspace focus → project detail → latest update → recommendation.
- Person status → urgency → friendly draft.
- Project status → unresolved issues → next move.
- Explicit topic switches between projects.
- Ambiguous and elliptical follow-ups.
- Fresh synthesized notes versus older snapshots.
- No-evidence responses.
- Contradictory synthesized updates.
- Detailed requests that should remain fast.
- Comparisons that should use deep reasoning.

For every response, record:

- Selected conversation topic.
- Synthesized source types.
- Raw transcript count.
- Freshest source timestamp.
- First-token latency.
- Total latency.
- Completion and truncation state.
- Marker leakage.
- Scope drift.
- Human-review scores for correctness, freshness, usefulness, organization, and voice.

Run two benchmark passes:

1. Cold start, including application and model startup.
2. Warm conversational session, representing normal repeated use.

The production database remains local. Benchmark reports must not copy private note contents into Git or shared output.

## Release gates

### Correctness

- 100% expected topic continuity and explicit topic switching.
- Zero known scope drift.
- Zero raw transcript passages.
- Zero invented owners, assignments, dates, or project status.
- Complete answers with no citation or truncation artifacts.

### Quality

- Every benchmark answer passes automated checks.
- Average human-review score is at least 4.5 out of 5.
- No answer is judged bland, mechanical, or structurally confusing.
- Detailed follow-ups materially add information instead of repeating the prior answer.
- Fresh updates outrank older snapshots.
- No-evidence answers state the search limitation without claiming that the underlying source contains nothing.

### Speed

Initial targets on the current local hardware:

- Prepared workspace answer: under 1.5 seconds total.
- Warm fast answer: under 3 seconds to first token and under 20 seconds total.
- Warm detailed answer: under 5 seconds to first token and under 25 seconds total.
- Deep reasoning: under 8 seconds to first token and under 30 seconds total.
- No normal query approaches the current 60–72 second range.

These targets must be reported alongside the model, provider, hardware, cold/warm state, context size, and output length.

## Verification matrix

### Focused automated coverage

- `tests/unit/queryEngine.test.ts`
- `tests/unit/askPlutoConversation.test.ts`
- `tests/unit/askPlutoReasoning.test.ts`
- `tests/unit/citationEngine.test.ts`
- `tests/unit/queryPrompts.test.ts`
- `tests/unit/unifiedProvider.test.ts`
- `tests/unit/askPlutoQueryIpcBoundary.test.ts`
- `tests/unit/askPlutoConversationReplay.test.ts`

### Repository checks

- Focused Ask Pluto test suite.
- Broader affected unit-test suite.
- `pnpm exec tsc --noEmit`.
- Biome/lint on changed files.
- `git diff --check`.
- SQLite ABI restoration with `pnpm run ensure:sqlite-abi` after Node tests when needed.
- Electron smoke test for the actual IPC and streaming route.

### Live acceptance

- Rerun the affected benchmark scenarios after each phase.
- Run the complete cold and warm production-data benchmark before acceptance.
- Manually review every failed or partial answer and a representative sample of passing answers.
- Treat unit tests and simulated responses as regression protection, not proof of production quality.

## Implementation order

1. Introduce effective project scope and correct entity selection.
2. Add the synthesized-only runtime invariant.
3. Harden final-answer cleanup.
4. Implement freshness precedence and project-note ranking.
5. Separate response depth from reasoning complexity.
6. Improve the natural response contract and response-level provenance.
7. Add complete timing instrumentation.
8. Perform targeted performance work based on measured phase costs.
9. Run the full cold and warm production-data benchmark and human review.
10. Complete repository verification and report any remaining limitations.

This sequence keeps correctness ahead of optimization while ensuring quality and speed are evaluated through the real Electron, IPC, retrieval, provider, streaming, and production-data path.

## Implementation checkpoint (2026-09-28)

The conversation pipeline now preserves structured project/person scope, keeps raw transcripts out of Ask Pluto context, handles social closure separately from retrieval, and uses response-level synthesized-source references. Project recall combines the project profile with matching synthesized note sections. Current-state questions over aged project material give a dated last-known answer rather than promoting an old target into a current task. Elliptical project follow-ups retain both their project and the current-read intent. A copied-profile benchmark exercises the real Electron/IPC/provider route without modifying the live profile; its reports remain local and Git-ignored.

The first broad copied-profile replay passed its mechanical checks, but human review caught old meeting plans phrased as current and an unrelated agenda topic in a project expansion. The project prompt no longer receives meeting-wide topics, decisions, or action items when a project-specific section was selected. Subsequent current-read continuations use dated source-limited answers and complete in roughly one second on the copied profile. This is a correctness improvement, not proof that every detailed project question is ready for release.

Acceptance remains open. A dated project profile cannot establish the project's live state, and short synthesized sections can leave a detail request with little new information. Startup-discovered knowledge-document work is now enqueued into the existing idle scheduler, with the recently asked-about project or person moved to the front of its pending queue. The scheduler still waits for safe idle conditions and pauses during an active chat; actual refresh latency needs measurement before a freshness claim. Model-backed historical or technical detail questions, comparisons, and person-specific quality still need representative human scoring under the release gates above. Automated pass counts alone are insufficient.

## Further validation (2026-09-28)

A copied-profile Electron/API replay exposed two distinct performance regimes. Prepared workspace-risk turns completed in about one second, while broad model-backed turns using the configured local 12B model took roughly 28–44 seconds total, mostly in model prefill and generation rather than retrieval. The broad route also turned historical meeting material into seemingly current recommendations. Workspace-wide concern questions now use synthesized risks and open loops, label aged snapshot items as recorded watch points, and keep that context on expansion turns. Recent synthesized-note selection is bounded by occurrence time and scans beyond the first handful of meetings. A two-turn copied-profile replay passed automated checks at about one second per turn, but the available synthesized risk detail remained thin; this is not a human-quality release pass.

No-evidence drafting now avoids inventing a previous discussion, and its copied-profile follow-up completed in under one second. The full unit suite and TypeScript check passed after that change. Remaining work is to compare smaller local models on representative substantive turns, human-score the resulting answers, measure actual background synthesis completion, and decide whether an answer should return a dated last-known picture while a refresh proceeds or wait for refreshed synthesis. Keep all profile copies and raw benchmark reports local and ignored.

A smaller installed 4B model reduced the measured substantive turns to roughly 11–18 seconds total, but one answer still combined unrelated people and work as if they were connected. It therefore does not meet the correctness gate and must not become the default solely for speed. The source selection and entity-boundary failures need correction and another human-reviewed replay before any model or routing change is accepted.

The follow-up replay found an explicit-person switch that was still inheriting the prior person's expanded retrieval query. Named person questions now use the literal new question before inheritance, and assignment evidence is isolated from unrelated generic results. Factual turns after a no-evidence answer search again rather than asking a conversation-only model to improvise. No-evidence wording distinguishes requirements from attribution. On the copied profile, the three-turn fictional-person sequence no longer attached the previous person's answer or invented a cross-person dependency, with sub-second no-evidence responses. Its remaining automated failure is a fixture expecting a substantive requirement for a fictional default person; that result still requires human review and is not a release pass.

The two-turn workspace-focus replay exposed duplicated watch points and an expansion that only reformatted the original answer. Workspace focus now deduplicates attention items and adds only further relevant synthesized detail on expansion; when no such detail exists, it says so. A copied-profile replay also surfaced an unrelated confidential aside in a broad focus response. Default workspace briefings now exclude such private aside notes, and expansion selects updates tied to the stated priorities. The replay remained near one second per turn without that aside. This protects the broad briefing, not every possible private-note classification; privacy and relevance need wider scenario coverage before release acceptance.

## Person-conversation replay (2026-09-28)

The user approved immediate answers from synthesized information with dated limits. Review showed that freshly processed meeting notes already enter Ask Pluto directly; project and person summaries are a separate background-refreshed layer. Do not refresh merely because a summary is old when there is no newer source. Date the summary and distinguish it from newer notes instead.

A two-turn copied-profile replay of a named-person overview followed by a pronoun coaching question exposed a real scope failure: the second turn was classified as a new topic and retrieved six loosely related sources. Named-person overviews now select the person dossier, and pronoun follow-ups keep that scope. Synthesized sources explicitly marked confidential are excluded from general Ask Pluto context, including structured note fields, and older confidential assistant turns are excluded from model conversation context. Aged person dossiers carry their synthesis date and are presented as last-recorded information. The same replay then used one person-scoped source on both turns and passed mechanical privacy checks. Human review still found overly current wording in an answer from an aged profile, so the source labels and prompt were tightened; that final wording change has focused test coverage but has not yet received a model-backed acceptance replay.

On the configured local 12B model, the corrected two turns took about 29 and 28 seconds. An opt-in 4B comparison took about 8–11 seconds with the same one-source scope, but one scenario is not enough to approve a default-model change. The privacy rule is conservative: it may omit an entire source containing a confidentiality cue, so completeness needs review. Full automated tests passed (467 files, 5,474 tests) after rebuilding SQLite for Node; TypeScript and targeted Biome checks passed, and the Electron SQLite binding was restored. The release quality and speed gates remain open.

Follow-up checks refined the boundary: when synthesized sections are available, confidential sections are removed before meeting results are assembled, allowing unrelated work from that meeting to remain searchable. A note-only result or person dossier containing a confidentiality cue is still excluded as a whole. Focused tests cover this mixed-section case. The final stronger aged-profile wording and section-level filter have focused automated coverage, but the copied-profile replay was not repeated after those last edits; they are not a live quality acceptance claim.

Additional copied-profile replays did run after those edits. Person conversations now combine a dated profile with up to two newer, explicitly person-naming synthesized note extracts. The pronoun coaching follow-up stays in that person scope; the private-topic check passed. A source-only 12B replay produced a more coherent coaching reply but took roughly 40–45 seconds per turn. The 4B replay took roughly 11–14 seconds on the richer context and still sometimes promoted adjacent work into advice. The default model was not changed.

A broader 13-turn 4B replay passed its initial mechanical checks, but human review found that a referential request for a short message returned a profile summary. Separating factual person-answer framing from draft framing produced an actual message, yet a later draft mixed unrelated work and turned an old relative deadline into "tomorrow." The benchmark now checks draft format, unrelated-topic bleed, and unanchored relative deadlines; rescoring that draft fails the latter two checks. This is a release-blocking conversational-focus problem, not a reason to add another reply-specific template. The next implementation needs a durable representation of the focal item within the active conversation and evidence selected for that item, so "about it" cannot fall back to the person's entire dossier or an earlier answer treated as evidence. Human-reviewed quality and warm first-token latency still fail the release gates.
