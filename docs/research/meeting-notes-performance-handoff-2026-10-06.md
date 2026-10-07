# Meeting notes performance: experiment handoff

Snapshot: October 6, 2026. Repository: `/Users/metagrover/Desktop/pluto`.
Branch at handoff: `master`, with substantial uncommitted work, including unrelated changes.

Latest continuation: see [the final-hour prompt/output-contract results](#final-hour-prompt-and-output-contract-work). Seven additional protocol variants did not produce an accepted 24K default; product code and production records remain unchanged.

## October 6 evening continuation: time-boxed prompt work

The user authorized a roughly 90-minute attempt to finish the 24K default work.
The investigation began at 02:55:41 UTC on October 7 and completed its frozen
generation runs at 03:54:19 UTC, within the proposed window. **No candidate has passed
the original-source quality gate. The product default remains 16,384 tokens.**
The experiments changed only the ignored private harness; no product prompt,
parser, grounding rule, cache identity, or context default was changed.

A fresh seeded case-8 baseline took 241.746s across three physical writers.
Removing unused owner/due fields from discussion points and questions took
225.595s: 6.7% less elapsed time and 14.4% fewer generated tokens, with essentially
unchanged prefill work. This demonstrated a small output-overhead mechanism,
not an accepted quality improvement. Actions and decisions retained their
metadata; the adapter restored omitted narrative fields to canonical nulls.
A separate cached baseline took 142.346s and is excluded from the fresh comparison.

Prompt and wire pilots then tested final-notes guidance, a task-first root
contract, explicit acceptance citations, native paragraphs, speaker dictionaries,
and readable same-speaker lines retaining every atomic citation label. The
completed case-8 pilots ranged from 139.813s to 202.311s, but omitted useful work
or introduced material errors. A denser atomic task-first trial reached the
300.120s provider deadline; it is a failure, not a speed result. The native
paragraph variant also demonstrated that preserving all words is insufficient:
a citation expanding into a broad speaker turn can include unrelated conditional
language and cause a valid commitment to be rejected by unchanged guards.

The final speaker-line variant was frozen for five sequential cases. It retained
each original fragment, speaker, order, and R label; unknown speakers were not
merged. Re-encoding the frozen source proved exact packet equality for all five
requests, and each conservative input estimate plus the 2,048-token output and
512-token safety reserves fit within 24K. These checks establish source
preservation and capacity, not comprehension.

| Case | 16K comparison seconds | Frozen 24K seconds | Accepted? |
| --- | ---: | ---: | --- |
| 8 | 241.746 | 193.733 | No |
| 4 | 244.479 | 177.489 | No |
| 2 | 111.197 | 107.596 | No |
| 5 | 101.588 | 135.563 | No |
| 0 | 293.022 | 252.144 | No |

Only case 8 has a new fresh baseline. The other baseline values are historical;
these are single runs, not a controlled aggregate causal estimate or a repeatable
latency promise. The model remained Gemma4:12b Q4_K_M on Ollama 0.35.1; batch size
was 128, context 24,576, output 2,048, and seed 42. Fresh prompt prefixes avoided
prior full-prompt cache reuse. The frozen trials used identical writing guidance;
minimum topic counts in the schema depended on source length. The private adapter
buffered responses to normalize the experimental protocol, so its preview counts
do not establish product streaming behavior. No unseeded stability claim is made.

Across the assessed cases, failures included lost accepted commitments, answered
questions kept open, completed work described as unresolved, conditions and
environment limits omitted, tentative architecture strengthened, and quoted
stakeholder messages attributed as decisions to the person reading them aloud.
Some decision-like assertions were emitted as ordinary discussion points,
illustrating why commitment validation alone cannot certify the final notes.
Shorter cases were more coherent but still had material certainty or coverage errors.
The final case additionally mixed individual travel details, mislabeled an expense,
kept an answered question open, and retained an earlier scheduling proposal after
a later confirmed invitation. All five frozen cases were rejected.

Read-only SQLCipher checks again confirmed all five production records unchanged.
All generation used mock publication (`productionWrites: false`). No accepted
implementation exists to regenerate in the real application. Dense hour-long
coverage, repeated timings, unseeded stability, product streaming integration,
and rendered real-meeting acceptance therefore remain outstanding.

Private continuation artifacts: `run-timebox-harness.ts`, `speaker-turn-wire.ts`,
`verify-timebox-source.ts`, `timebox-quality.json`, `summarize-timebox.py`, and
`timebox-final-results.json` under the existing private root. Per-run source proofs,
requests, physical responses, generated notes, and partial streams remain private.
Do not promote any of these candidates based on the table's elapsed times.

The narrow metadata experiment is now measured and retired from immediate adoption.
Repeating minor prompt variations has diminishing value. The next useful scope is
a bounded failure-driven evaluation of coverage, quotation attribution, and
accepted commitments, with protocol changes justified by those failures; a default
switch should not be described as a small remaining configuration edit.

## Follow-up: simpler writing prompt and reasoning control

After the user challenged whether prompt upgrades had addressed the misses,
the actual guides were reviewed again. Earlier variants already instructed the
model to preserve final state, quoted-message attribution, distinct personal
choices, constraints, and accepted work. Their failure is evidence about those
particular requests, not proof that an ordinary notes task exceeds 24K capacity.

A simpler colleague-facing guide removed forced section counts and the task-first
root protocol, while keeping lossless readable speaker lines, citations, and the
existing parser/grounding checks. Case 8 completed in 210.429s. It recovered a
previously missing delivery in raw output, but assigned the wrong owner and still
produced a rerun action for completed work; quality was rejected.

An important comparison difference was then verified in the physical requests
and current source: structured calls set `think` from
`ollama_structured_thinking ?? false` in `unifiedProvider.ts`. The local model's
`/api/show` reports thinking controls `[false, true]` with default `true`.
The plain Markdown diagnostic used that model default, whereas all earlier
structured trials explicitly disabled thinking. A plain Markdown request with
readable, unquoted source fragments timed out at 300.018s before a final answer;
it provides no semantic-quality verdict.

The same simpler JSON guide was tested with explicit reasoning and a 6,144-token
output allowance. The source, output reserve, and safety allowance still fit 24K.
The private adapter was corrected to forward generation progress while holding
the answer for protocol normalization; its earlier buffering could hide activity
and trigger the capacity deadline. This is a private harness correction, not a
product streaming change. The reasoning trial nevertheless failed after 592.438s
with `notes_output_truncated`, spending the allowance without final notes. It
cannot be counted as a latency or quality success.

A brief-planning variant was started, then cancelled when review of the older
private log confirmed that brief thinking had already failed similar trials.
That history should have been checked before this branch was repeated. The
thinking setting is an explicit earlier capability, not a newly discovered route.
The cancelled run supplies no quality or timing verdict.

The remaining pass used the simpler guide with separate system/source roles,
readable unquoted fragments, explicit thinking disabled, and no native JSON
grammar. JSON was requested in prose with an exact canonical example. It completed
one actual model call in 230.057s (10,890 uncached input tokens, 1,631 output tokens).
Raw output had more useful context and recovered a delivery with the correct owner,
but retained a stale query task, omitted a testing restriction, and presented a
proposed optimization as a decision. It also wrapped JSON in a code fence despite
the instruction to return JSON only. An exact-request frozen-response replay through
the real coordinator/decoder failed `notes_writer_invalid`; its 0.122s parsing time
is not a model-generation benchmark. No generated output was promoted.

No product setting or code has been changed by this follow-up.
Private artifacts add `run-plain-notes.ts`, `plain-notes-v7-8`, and the
`human-notes-v6`, `reasoning-v8`, `brief-reasoning-v9`, `plain-json-v10-8`, and
`plain-json-v10-frozen` run directories. `prompt-followup-results.json` records
the terminal outcomes without private source or generated content.

Ollama documents the separate reasoning field and explicit thinking controls in
[its thinking guide](https://docs.ollama.com/capabilities/thinking). Runtime behavior
was checked locally rather than inferred from documentation alone. Changing
thinking, output budget, roles, format, or source presentation together does not
isolate one causal effect; these are diagnostic comparisons, not promotion evidence.

## Final hour: prompt and output-contract work

The user authorized another hour specifically for prompt interpretation and the output contract. The window started at 04:54:19 UTC on October 7 and was bounded at 05:54:19 UTC. The model and lossless speaker-line source encoding stayed unchanged throughout this window. No transcript-cleanup experiment was introduced.

The new protocol separated narrative state from accepted follow-ups. Narrative items had explicit state, text, an anchor source, and supporting context. Accepted direct promises used a separate acceptance field. A native schema branch bound each eligible first-person promise to its original source speaker. This recovered correct ownership in two different meetings, but eligibility still includes quoted, hypothetical, superseded or completed promises; the prompt must exclude those. Short or implicit acceptances are not comprehensively covered by that experimental restriction.

Pilots compared evidence-first versus state/text-first writing, a concise reconciliation list, a final-state instruction after the source, and separate system instructions/user source. The reconciliation variant leaked citation labels into prose and was rejected by the existing editor. A larger version exhausted its 3,072-token output allowance. A trial with an additional prose pattern ended with the provider's repeated-token abort. These failed outputs are not successful latency measurements. A private mode-name collision also caused one pre-dispatch failure; it was corrected and is excluded from model timing.

The role-separated candidate was then frozen across all five cases. These actual uncached runs used context 24,576, output 3,072, batch 128, thinking disabled and seed 42. Each made one physical writer call with no repair. Every original source packet was independently re-encoded and matched, every capacity check fit, and all five prompt-guidance hashes matched. Publication was only to the mock database.

| Case | Seconds | Actions retained | Original-source assessment |
| --- | ---: | ---: | --- |
| 8 | 179.248 | 1 | Correct delivery owner; ranking/generation scope confusion and useful condition/status omissions |
| 0 | 211.899 | 0 | Earlier hotel suggestion treated as a shared settled choice; confirmed schedule and accepted delivery omitted |
| 4 | 157.358 | 0 | Tentative staffing and future timing strengthened; alternative guardrail outcome overstated |
| 2 | 100.380 | 0 | Preferred name treated as a former name; proposed session strengthened; agreed meeting time omitted |
| 5 | 113.656 | 1 | Correct forwarding owner; quoted proposed scope strengthened and revival condition omitted |

None passed the practical quality gate. Different organization and minor omissions remain acceptable; the rejection is based on material certainty, current-state, scope, identity or commitment problems. Do not present this table as a controlled aggregate speedup: only case 8 has the earlier fresh paired 16K baseline, and each candidate case is a single seeded run.

The final diagnostic required two or three closing-topic sections before other topics, with their anchors restricted to the final quarter of source. Case 8 completed in 193.980s but misclassified a valid delivery as a decision, lost it through unchanged checks, and still retained a resolved operation as a current problem. Case 0 completed in 239.154s. It recognized a later hotel preference, but mixed individual flight details, strengthened tentative product choices, and generated already-unnecessary work; six commitment items were removed by unchanged checks. Closing coverage constraints did not establish final-state correctness.

The output-contract gap is now clearer: valid source labels and enum states do not establish that the text follows the cited evidence, that later updates were understood, or that important accepted work was retained. Decision-like statements can also appear in narrative points without being certified by action/decision checks. Native speaker binding helps one narrower problem, but does not settle these semantic gaps.

Private artifacts: `contract-hour.ts`, `run-contract-hour-set.py`, `contract-hour-results.json`, `contract-hour-preservation.json`, and the `contract-hour-v11` through `contract-hour-v17` directories under the existing ignored root. All content remains private. The streaming adapter forwards progress while normalizing the completed experimental JSON; it does not establish product partial-preview behavior. No dense-hour, repeatability, installed-app regeneration or rendered-note acceptance was established.

The window produced seven protocol variants and twelve physical model attempts, including provider/format/truncation failures. No candidate was promoted. Fresh read-only SQLCipher comparisons confirmed all five production records unchanged; the eleven saved implementation/check-path hashes matched, and owner-only permissions passed. The default remains 16,384 tokens, and no product prompt, parser, grounding rule, cache identity or preview implementation was changed. No fresh unit/type suite was needed for these private-only experiments and documentation; historical green suites are not new validation.

## Outcome and current status

Several latency optimizations are implemented in the working tree. The whole-meeting 24K experiments have **not** established equal or better note quality at a reliably faster speed. They have not been enabled as the product default. No release, commit, or push was requested or performed for this handoff.

The strongest recent frozen five-meeting comparison reduced aggregate elapsed time by 21.2%, but failed source-based quality assessment. Some longer cases improved by roughly 30–42%; two shorter cases were slower. Faster output often contained fewer useful facts or incorrect commitments, so elapsed time alone is not a win.

Private replays used frozen source and mock publication rather than writing generated notes to the production database. `productionWrites: false` is recorded in their summaries. Read-only SQLCipher checks during the investigation confirmed the five compared production records were unchanged. Regenerating the latest real meeting with an accepted faster implementation remains outstanding.

The original snapshot below predates the evening continuation above. At that snapshot no benchmark was running and the unused-output-metadata experiment had not been measured; the continuation supersedes that experiment status.

## User intent and constraints

- Make note generation substantially faster while preserving or improving useful note quality.
- Keep the model unchanged; improve the prompt and harness first.
- Prefer one whole-meeting call using a 24K context when it works. Include the document title in that response.
- Disable model reviews for now; avoid excessive lineage analysis and redundant preparation.
- Use two hours, rather than four hours, for caching/model residency, with sensible memory-pressure behavior.
- Do not depend on live draft generation during recording. Many users will leave it disabled because of memory usage.
- Judge candidates against the original transcript. Existing notes are imperfect and must not be treated as the answer key.
- Test across multiple meetings. Longer 1–2 hour meeting coverage is stage 2, after the current approach is sound.
- Input filler removal is allowed as an experiment if safe and useful; preserve stored transcripts and source spans.
- Preserve encrypted data, recordings, user notes, identities, provenance, and unrelated work.
- Keep meeting names, participants, transcript excerpts, credentials, and private outputs out of Git and shared materials.

User authorization covers continued investigation and focused implementation. It does not make failed candidates acceptable or authorize a release of unrelated changes.

## Current source configuration

These values were checked in source when preparing this handoff:

| Setting | Current working-tree value | Location |
| --- | --- | --- |
| Product notes context | 16,384 tokens | `electron/meetingAnalysisRuns.ts`, `NOTES_CONTEXT_TOKENS` |
| Model audit strategy | `deterministic_only` | `electron/meetingAnalysisRuns.ts` coordinator invocation |
| Parsed stage cache lifetime | 2 hours | `electron/meetingAnalysisRuns.ts`, `NotesStageCache` construction |
| Ollama model keep-alive | `2h` | `electron/llm/unifiedProvider.ts` request construction |
| Default notes batch size | 128 | `electron/llm/unifiedProvider.ts` |
| Writer output budget | 2,048 tokens | `electron/llm/meetingNotesPipeline.ts` and provider |
| Planner safety allowance | 512 tokens | `electron/llm/meetingNotesPipeline.ts` |
| Default leaf source cap | 8,000 characters | `electron/llm/meetingNotesPipeline.ts` |
| Paragraph source codec | Optional experimental input; not enabled by default | `electron/llm/unifiedProvider.ts`, `sourceParagraphs` |

The source cap is a partitioning input, not a declaration that every meeting requires multiple writers. The whole-source fit path can avoid splitting. Planning uses the encoded request budget, so source length, instruction overhead, output reserve, and context capacity matter. Increasing the configured context does not guarantee either better coverage or faster generation.

The Ollama desktop slider in the supplied screenshot does not establish Pluto's request context. The application explicitly passes its own context budget. No global 256K setting was adopted as a Pluto optimization.

## Changes already present in the working tree

The notes-related work includes:

1. Model reviews disabled in the product coordinator, while deterministic parsing, source validation, and commitment grounding remain.
2. Capacity planning based on the actual encoded request, with the unused editor reservation removed.
3. Two-hour parsed-writer cache with revision-sensitive keys and bounded retention. This is separate from Ollama's model residency and provider prefix caching.
4. Two-hour Ollama keep-alive, plus idle-model release under memory pressure/shutdown. Keeping weights resident can still consume memory; two hours does not mean zero memory cost or guaranteed residency.
5. Reduced duplicate preparation/source lookup work and scheduling improvements.
6. A notes-generation power-save blocker and revision-guarded publication/preview handling.
7. Support for a title returned with notes. A missing-title fallback runs after notes publication so title generation need not block usable notes. Multi-leaf title handling remains more constrained than a single whole-meeting response.
8. Narrow grounding fixes for evidence consisting entirely of fillers and generic assignee phrases beginning with conversational fillers.

Relevant files include `electron/meetingAnalysisRuns.ts`, `electron/llm/unifiedProvider.ts`, `electron/llm/meetingNotesPipeline.ts`, `electron/llm/meetingNotesStageCache.ts`, `electron/llm/meetingNotesWire.ts`, `electron/llm/meetingNotesSource.ts`, `electron/llm/analysisGrounding.ts`, and their focused tests. This list is not a complete ownership map of the dirty checkout.

These are source changes, not proof that an installed application contains them. The entire dirty diff must not be treated as this task's changes.

## Latest frozen cross-meeting result

Candidate: private lean integer-source final-v3 whole-context protocol. Source words, speakers, and references were checked for lossless encoding. That check proves source preservation, not generated-note quality.

Opaque case keys below are local benchmark identifiers, not meeting names.

| Case | Baseline seconds | Candidate seconds | Time reduction | Quality accepted? |
| --- | ---: | ---: | ---: | --- |
| 8 | 249.790 | 170.476 | 31.8% | No |
| 4 | 244.479 | 141.082 | 42.3% | No |
| 2 | 111.197 | 164.387 | -47.8% | No |
| 5 | 101.588 | 106.531 | -4.9% | No |
| 0 | 293.022 | 205.438 | 29.9% | No |

Aggregate reduction is computed from summed elapsed time, not the average of the percentages. Recorded result: **21.2%**, `promotion: rejected_quality`.

Reasons for rejection included omitted valid commitments and testing restrictions; uncertain allocations presented as settled; missing launch conditions and capacity details; output-contract text leaking into a heading; duplicated facts; stale choices retained after the meeting moved on; incorrect participant attribution; and completed access treated as future work. Some defects also occur in baseline notes. Candidates should improve those defects rather than reproduce them.

These are individual local runs, not repeated statistical estimates. Baselines came from different refreshed runs; case 8 used the seeded paired baseline. Load, cache state, and output length can affect timings. Do not describe the table as a controlled five-case causal estimate for one isolated optimization.

## Other experiments and what they taught us

| Experiment | Observed result | Decision / interpretation |
| --- | --- | --- |
| Current atomic prompt/wire with 24K and batch 512 | Case 8: 179.833s; case 0: 240.318s | Too brief and inaccurate. Context capacity alone did not solve quality. |
| Batch-only paired 128 vs 512, case 8 | 249.790s vs 256.351s; identical total input tokens | Prefill improved only about 0.5s; output differed. Keep default 128. |
| Integer source IDs, current 16K partition/prompt/item fields | 225.523s vs 249.790s; three writers | Input 14,761 to 14,205; prefill 118.432 to 112.883s. Most total gain came from fewer generated tokens; incorrect recipient remained. Not accepted. |
| Merged same-speaker source rows | Failed after 62.144s | Expanding one label exceeded the unchanged atomic parser's three-span limit. Failed run is not a latency win. Parser was not weakened. |
| Existing native paragraph codec, 12K budget, current pipeline | 236.414s vs 249.790s; three writers, no repairs | Some counts and final-state details improved, but environmental restrictions were lost and an unsupported sequence appeared. Not accepted. |
| Replace source-label schema enum with an R-ID pattern | First writer still 4,711 input tokens, exactly matching baseline | Stopped: no input-token/prefill mechanism gain. Do not assume the enum is injected into prompt tokens. |
| Full meeting repeated for three focused writer calls | 267.015s, three physical calls | Prefix reuse occurred on later calls, but aggregate speed and quality were unfavorable. One logical stage did not mean one model request. |
| Larger 1,024/2,048 batch and denser outputs | Mixed timings; one dense trial reached the provider deadline | No established speed-quality win. Larger batches are not automatically better. |
| Direct Markdown, facts-first, source-first, quote-copy, regional coverage, and alternate response shapes | Some fast outputs; others failed parsing/quote validation | Repeated completeness, status, ownership, and condition problems. None promoted. |
| Conservative filler removal | Only 0.00–0.22% characters removed across 15 sources | Too little demonstrated benefit to enable by default. Broad removal can damage terms, quoted content, or meaningful responses. |

Use physical request artifacts rather than logical-stage counts when accounting for model calls. The focused full-context trial made three physical writer calls even though its adapter reported one logical outer stage.

Do not count parser-only frozen-response replays, setup failures, cancelled runs, timeouts, or invalid outputs as successful model-generation benchmarks.

## Bottleneck and caching diagnosis

Measurements point to model prefill and token generation as the dominant costs; deterministic checks are comparatively small. Removing safety checks will not recover the minutes spent in inference.

Observed environment: M1 Pro with 16GB memory, Ollama 0.35.1, Gemma4:12b Q4_K_M, approximately 8.1GB model weights, all 49 layers on GPU. Flash Attention was already active. These are historical measured environment facts; refresh them before a new benchmark.

The measured KV allocation was about 864MiB at 24K versus 656MiB at 16K, an increase of roughly 208MiB. This is not a complete total-memory estimate. Watch memory pressure and swap rather than promising that a larger context or longer keep-alive has no user impact.

Three distinct caches must be kept separate:

- **Parsed stage cache:** reuses validated writer output for the same generation identity; a changed source or relevant configuration must invalidate it.
- **Model keep-alive:** avoids loading weights again. It does not eliminate prompt evaluation or generation.
- **Provider prefix/KV reuse:** depends on actual shared input, model/runtime state, and checkpoint behavior. It is not guaranteed by `keep_alive`.

Observed shared instruction prefixes were roughly 5.5–5.9K characters, approximately 1.5K tokens. The local runner's observed cache checkpoint spacing was 8,192 tokens; several current writer calls reported zero cached input despite shared instructions. Repeating an identical full prompt can reuse cache, but new meeting source is different. Do not pad instructions or modify an unowned Ollama server merely to force a cache boundary.

## Quality acceptance for the next thread

Assess original transcripts and generated notes directly. A schema-valid, source-valid, published mock result is not sufficient.

- Correct factual meaning, participants, and current state.
- Useful coverage of material subjects, quantitative limits, conditions, environments, blockers, and unresolved questions.
- Accepted work distinguished from requests, proposals, completed work, and generic discussion.
- Correct owners and deadlines when supported; no invented certainty when attribution is ambiguous.
- Readable notes and title without duplicate sections, contract leakage, or excessive generic prose.
- Faster end-to-end generation without achieving the gain simply by dropping useful content.

Different organization and minor omissions are acceptable. Do not require reproduction of every baseline fact. Do not obsess over later corrections as a special prompt theme; they are one ordinary aspect of understanding the full meeting.

The prior tests establish implementation behavior, not semantic parity. Earlier work reported 319 focused tests across eight files plus type/lint checks, and a later grounding pass reported 230 tests across three files with types/scoped lint. Those are historical checks, not freshly rerun for this documentation change. Rerun the relevant checks after any new implementation.

## Original proposal: narrow the generated metadata

The evening continuation above measured this proposal in the private harness.
It remains **unimplemented in the product** because quality acceptance failed.

Keep the current writing guidance and partitioning. Test whether discussion points and questions can omit unused owner/due fields while actions and decisions retain the fields needed for commitment grounding. A small decoder could normalize omitted fields into the established canonical representation.

Before adoption, account for schema branches, partial stream previews, parser behavior, cache/protocol identity, and existing source checks. Do not remove provenance or invent source matching to make a response pass.

Run one paired case first to establish whether the physical request/output tokens actually decrease. If the mechanism does not work, stop that branch. If it does, freeze the candidate and compare the five existing cases sequentially with original-transcript assessment. Repeat promising cases under comparable quiet load before reporting a durable gain.

This isolates output overhead better than another wholesale prompt redesign, but it may have small or no benefit. No speed estimate should be promised in advance.

## Continuation procedure and private artifacts

Private root, local to this Mac and ignored by Git:

`/Users/metagrover/Desktop/pluto/.private/notes-cache-check-20261005/`

Useful files:

- `lean-final-v3-comparison.json`: latest five-case table and rejection status.
- `stage-comparison.md`: detailed chronological experiment log. Contains private content and provisional diagnoses; later results supersede earlier hypotheses.
- `run-whole-harness.ts`: private replay driver using actual provider/coordinator with a mock database and experimental adapters. Do not port it wholesale into the product.
- `candidates-expanded.json`, source snapshots, and state/history fixtures: frozen private source and saved-note inputs. Never commit them.
- Per-run `summary.json`, `request-N.json`, response streams, physical response streams, metrics, and generated notes: inspect both actual request count and output validity.
- `stage-current-paired-batch128-no-source-enum-8/summary.json`: final stopped/no-gain result; supersedes the preceding log's schema-token hypothesis.
- `verify-expanded.cjs`: read-only, key-aware production-record comparison.

The latest tested meeting is opaque case 0. Refresh source revision before any eventual real regeneration; do not assume a frozen snapshot is still the latest meeting.

Resume steps:

1. Read this handoff, repository instructions, and current Git status. Preserve unrelated changes; do not reset the checkout.
2. Confirm graph project/generation before code discovery. Prefer graph symbols/traces/snippets and check coverage, with source fallback for missing ranges. This handoff's paths are pointers, not an exhaustive current call graph.
3. Inspect current provider, planner, parser, cache, and preview behavior before implementing the narrow metadata experiment.
4. Use the established `pnpm exec tsx` replay driver. The attempted Electron-as-Node + tsx CLI loader failed before GPU dispatch and is not the working harness invocation. Read the driver's current arguments before running it.
5. Dispatch GPU work sequentially. Record load, model warmth, cache reuse, physical calls, input/output tokens, prefill/decode time, elapsed time, repairs, failures, and useful output quality. Keep the Mac awake with a bounded owned assertion while active experiments run; release it when done.
6. Never use plain SQLite against an encrypted Pluto database. For the existing verification script, the prior working command was:

   ```bash
   rtk proxy env ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .private/notes-cache-check-20261005/verify-expanded.cjs
   ```

7. If Node tests require a different SQLite ABI, rebuild for Node, then restore Electron with `pnpm run ensure:sqlite-abi` before application checks.
8. Promote only after favorable quality and timing results across the frozen cases. Update regression coverage and any superseded accepted decision. Then regenerate the latest real meeting, compare rendered notes against its source, and report actual timing.
9. Stage 2: actual hour-long and 1–2 hour meetings, source exceeding the full 24K envelope, continuity across multiple writers, merge/reconciliation behavior, cold/warm starts, and memory-pressure behavior. Existing sparse long-duration cases do not establish dense hour-long performance.

Keep private directories owner-only and private files owner-readable/writable. Do not print keys or copy private prompts/output into documentation or commit messages.

## Suggested first message in a fresh thread

> Continue the notes-performance work in `/Users/metagrover/Desktop/pluto`. Read the final-hour section in `docs/research/meeting-notes-performance-handoff-2026-10-06.md` and the private `contract-hour-results.json` first. Keep the model and transcript format unchanged and preserve unrelated work and private data. The 24K requests fit and completed, but semantic acceptance failed; do not enable a default based on format checks or latency. Review the accepted-task binding improvements alongside the remaining certainty, final-state, identity and coverage errors before choosing a materially different experiment. Reconciliation lists, closing-first constraints, forced coverage, quote protocols and simple role separation have already been measured; do not repeat them as new ideas. Any eventual implementation still needs focused regressions, actual-provider validation and rendered real-meeting acceptance.
