# Notes-first Ask Pluto design

**Status:** Approved for implementation
**Governing issue:** [#699](https://github.com/metagrover/pluto/issues/699)
**Related work:** #62, #614, #667, #694

## Outcome

Ask Pluto should answer saved-meeting questions from the concise, corrected meeting record instead of repeatedly searching and sending large transcripts. The normal path must be faster, more grounded, and consistent between meeting-scoped and multi-meeting chat. Transcript access remains available only when the user explicitly asks for exact wording or when a saved meeting has no usable notes. Active-meeting chat remains transcript-backed.

This is an evidence-routing and scheduling change, not a prompt-only optimization or a model-quality bet.

## Evidence behind the design

- The current retrieval path searches one FTS index containing titles, transcripts, enhanced notes, and user notes. Ranking and snippets can therefore be transcript-derived even when a prompt says to prefer notes.
- Completed-meeting chat also reserves transcript segments in its context independently of the global retrieval path.
- On the live corpus inspected for #699, average transcript JSON was roughly 93 times larger than average enhanced notes. That makes transcript-first retrieval expensive before generation begins.
- Quick and Deep chat route to different resident models. Switching between Phi and Gemma can unload and reload model state, while the current request gate coordinates only within one Pluto process.
- Two packaged Pluto runtimes were observed sharing the same production database and Ollama service. Process-local serialization cannot prevent their requests from competing.
- The #694 direct-MLX evaluation improved some raw generation times but did not clear semantic, latency, or memory acceptance gates. Replacing Ollama is therefore not a prerequisite for this outcome.

## Goals

1. Make saved-meeting retrieval notes-first by construction, not merely by instruction.
2. Keep user edits and source-grounded structured meeting intelligence authoritative.
3. Avoid model inference for simple, safely renderable recall.
4. Give interactive Ask Pluto work priority over background intelligence work.
5. Measure the complete user path with content-free timing and quality signals.
6. Preserve a provider-neutral boundary so Ollama, llama.cpp, or MLX can be benchmarked without rewriting retrieval or product behavior.

## Non-goals

- Regenerating the user's meeting notes or transcripts.
- Redesigning the Ask Pluto interface.
- Running different large models concurrently on a 16 GB machine.
- Promoting a direct MLX or llama.cpp runtime before it passes the same production-path gates.
- Treating generated notes as infallible or silently filling incomplete notes from a transcript.

## Evidence policy

Every saved-meeting request receives one explicit policy before retrieval:

- `notes_only`: the default. Search and answer from saved notes and structured meeting intelligence only.
- `transcript_exact`: used only for explicit exact-wording intent such as “quote,” “verbatim,” “word for word,” or “what exactly did they say.” Retrieve a small transcript span and label it as transcript evidence.
- `transcript_fallback`: used only when the selected saved meeting has no usable notes. The answer must disclose that it is based on the transcript because notes are unavailable.

Questions such as “what did Sam say about launch?” remain `notes_only`; naming a speaker does not imply a verbatim request. Partially complete or unhelpful notes do not silently trigger transcript access. The user can explicitly request exact wording if needed.

Active recordings are a separate mode. Their current transcript and rolling meeting context remain the best available evidence and may continue to use the fast live-chat model.

## Notes evidence document

Pluto will build one rebuildable saved-meeting evidence document from existing sources:

- published enhanced notes;
- user-authored notes and edits;
- structured decisions, action items, topics, dates, participants, and corrections from the existing analysis and MID records;
- meeting title and time metadata needed for selection and citation.

User-authored corrections win over generated values. Each field retains source type and trust metadata so the answer path can cite it truthfully.

A dedicated `meeting_notes_fts` derived index will contain searchable note evidence rather than sharing the transcript index. Its logical fields are `title`, `notes_text`, `decisions_text`, `action_items_text`, `topics_text`, `participants_text`, and an unindexed `meeting_id`. The index is a cache, never a source of truth. It is rebuilt transactionally when its source record changes and can be fully regenerated from the database.

Transcript search remains separate. Normal saved-meeting ranking, snippets, prompt context, and citations must not be transcript-derived.

## Retrieval and answer flow

Global and meeting-scoped Ask Pluto use the same evidence packet and policy:

1. Resolve scope and classify evidence policy deterministically.
2. Retrieve bounded notes evidence from `meeting_notes_fts`, or a bounded transcript span only for the two permitted escalation cases.
3. Attach source type, trust state, meeting identity, and citation metadata.
4. Attempt a deterministic answer for safe recall shapes.
5. If synthesis is required, send the compact evidence packet and conversation state to the selected model.
6. Validate that answer citations refer only to supplied evidence.

The deterministic path covers unambiguous single-meeting summaries, decisions, action items, owners, and explicit dates when the requested data is present in structured evidence. It renders existing evidence rather than generating new claims. Ambiguous, comparative, multi-meeting, or conversational questions continue to use model synthesis.

Saved-meeting synthesis uses Gemma with production response budgets. Completed Quick chat no longer causes a routine Phi-to-Gemma model swap; Phi remains available for active-meeting chat. Follow-up turns preserve the selected meetings and supplied evidence without reintroducing transcript history.

## Inference coordination and runtime boundary

One provider-neutral coordinator in the Electron main process owns inference admission, priority, cancellation, model residency decisions, and content-free timing. Renderers and background jobs submit typed tasks instead of calling a provider independently.

Priority order is:

1. active and saved-meeting Ask Pluto foreground work;
2. user-blocking notes work;
3. cancellable background analysis and maintenance.

The initial backend remains Ollama and admits one generation at a time. This avoids adding runtime risk before the much larger context reduction is measured. The interface supports later adapters for Ollama, llama.cpp, and MLX, but an adapter is promoted only after full-path quality, latency, peak-memory, cancellation, and concurrency testing.

Pluto's packaged application will use Electron's single-instance lock so two packaged runtimes cannot share the production profile and model service accidentally. Development runs use an isolated application profile and database path rather than the production profile.

Same-model parallel decoding may improve aggregate throughput after notes-first requests become small. It is a benchmark candidate, not the default: on unified memory it can increase time to first token and memory pressure. Concurrent different-model residency is out of scope unless measured headroom proves it safe.

## Failure and recovery behavior

- No usable notes: use the disclosed transcript fallback when a transcript exists; otherwise return a truthful no-evidence state.
- Exact quote not found: say that the exact wording could not be located; do not paraphrase and label it as a quote.
- Stale or missing derived index: rebuild from source records and retry once without modifying the source content.
- Model unavailable: preserve the deterministic path and return the existing actionable provider error for synthesis.
- Cancellation or supersession: stop queued work and ignore stale completions without publishing partial answers.
- Source deletion or correction: remove/rebuild derived evidence and invalidate any affected cached retrieval packet.

## Privacy-preserving observability

Record no meeting text in telemetry or logs. Per request, capture only:

- request/task identifier and mode;
- evidence policy, source counts, and character/token counts;
- retrieval, queue, model-load/switch, time-to-first-token, generation, and total durations;
- cancellation, timeout, and structural/grounding outcome;
- model/runtime identifiers and coarse memory measurements used by local benchmarks.

Private evaluation uses read-only access, content-free meeting identifiers, and no meeting content in fixtures, GitHub, or logs.

## Verification and acceptance

### Behavior

- A transcript-only conflicting or unique phrase cannot affect a normal saved-meeting answer when usable notes exist.
- Explicit quote intent retrieves only bounded transcript evidence and labels it correctly.
- A meeting with no usable notes can use the weakly labeled transcript fallback.
- User edits and corrections take precedence in retrieval and answers.
- Global and meeting-scoped chat follow the same evidence policy.
- Multi-meeting comparison, follow-ups, and citations remain grounded in the selected notes evidence.
- Active-meeting chat remains transcript-backed and responsive.

### Scheduling and lifecycle

- Two simultaneous Ask Pluto requests, Ask Pluto plus background analysis, and live chat plus background work respect priority, cancellation, and publication ownership.
- A second packaged Pluto instance does not open the production profile.
- Development mode demonstrably uses an isolated profile.

### Performance and quality gates

- Deterministic answers: p95 under 500 ms after database open.
- Notes retrieval: p95 under 100 ms on the private corpus.
- Warm saved-meeting synthesis: first useful token within 5 seconds for Quick-shaped requests and within 15 seconds for Deep-shaped requests.
- Foreground queue delay: p95 under 250 ms when only cancellable background work is active.
- Cold model load is reported separately from warm latency.
- Existing grounded-answer and exact-evidence quality must not regress; semantic evaluation remains distinct from schema/format success.

The benchmark must exercise production retrieval, queueing, prompt construction, response budgets, validation, and citation rendering. A direct model call with larger benchmark-only budgets is not accepted as Ask Pluto performance evidence.

After notes-first behavior passes, compare four identical full-path conditions: serialized Ollama, same-model parallel Ollama, direct llama.cpp, and direct MLX. Promote a different runtime or parallel mode only when it improves interactive latency without failing semantic fidelity, exact evidence, peak-memory, cancellation, or live/background contention gates.

## Delivery slices

### Slice A: notes-first evidence and answers

- Add and backfill the rebuildable notes index.
- Centralize evidence policy and packets across both saved-meeting entry points.
- Add deterministic safe answers and bounded transcript escalation.
- Update the production-path benchmark and content-free timing.

### Slice B: coordinated inference and runtime isolation

- Route foreground and background inference through the main-process coordinator.
- Add priority, cancellation, residency, and lifecycle tests.
- Enforce packaged single-instance behavior and isolated development profiles.
- Add runtime adapters only as benchmark seams; retain serialized Ollama initially.

Each slice follows TDD for non-UI logic and ships with a uniquely named changelog fragment. Schema migration must be reversible; rollback may discard and rebuild the derived notes index without touching notes or transcripts.

## Rejected approaches

- **Prompt-only notes preference:** transcript-derived FTS ranking and completed-meeting context still leak transcript evidence into the request.
- **Filtering snippets after mixed FTS search:** transcript terms would still affect candidate ranking and miss note-only matches.
- **Immediate Ollama replacement:** #694 showed that faster raw generation did not guarantee trusted notes, acceptable memory, or production latency.
- **Different models in parallel:** all model weights and contexts must fit unified memory, increasing pressure and interactive tail latency.
- **Silent transcript supplementation:** it makes concise corrected notes non-authoritative and hides the source of claims.
