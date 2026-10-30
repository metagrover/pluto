# Native MTP adoption plan

Date: 2026-10-14

Historical experiment record. Later local-inference decisions in `docs/decisions.md` govern the current app; this plan does not reactivate MTP or an earlier notes-review pipeline.

Status: First-milestone evaluation and initial tuning complete; quality gate failed. No native integration candidate is accepted. Provider/default changes and release remain blocked pending semantic/source correction and renewed acceptance.

## Objective

Introduce native multi-token prediction (MTP) where it demonstrably improves Pluto, while preserving quality and recording reliability. Deep Ask and meeting notes qualify independently. Removing Ollama is a later milestone, after every route that depends on it has a verified replacement.

Keep runtime adoption separate from notes-prompt changes so each result is attributable. Use the accepted notes prompt for the initial runtime comparison; keep the rejected prompt candidate outside this experiment.

## 1. Freeze the baseline and acceptance criteria

Create a new private evaluation directory, preserving all previous results. Record:

- Application revision and hashes of relevant uncommitted changes.
- Accepted prompt version, pipeline settings and source-grounding rules.
- Target model, drafter and runtime versions, hashes and compatibility.
- Hardware, context limits, sampling settings and runtime arguments.
- Current Ollama configuration, including the separate quick-model route.

Measure three configurations:

| Configuration | Purpose |
|---|---|
| Current Ollama | Establish the user's existing experience |
| Native, MTP off | Isolate differences caused by changing runtime |
| Native, MTP on | Isolate the additional effect of MTP |

Only one large-model runtime should be resident at a time on the 16 GB test machine. Background generation must be stopped or accounted for.

**Deliverable:** a reproducible experiment manifest and a frozen set of promotion criteria.

## 2. Build a broader evaluation set

Retain the two existing real meetings as diagnostic cases, then add a proposed eight representative meetings, including several held out from tuning.

Cover:

- Short, medium and long transcripts.
- Multiple speakers and ambiguous pronouns.
- Requests followed by acceptance elsewhere.
- Deadlines or conditions separated from the commitment.
- Completed, cancelled and reassigned work.
- Tentative proposals versus settled decisions.
- Numbers representing different stages of the same process.
- Disfluent speech and corrections near the meeting's end.

For Deep Ask, prepare approximately 20 questions covering facts, decisions, commitments, cross-meeting synthesis and questions the supplied evidence cannot answer.

Use two Ask evaluations:

- **Fixed evidence:** identical retrieved context across runtimes, isolating generation.
- **Full application path:** real retrieval, context construction, generation and rendering.

Create the expected facts and evidence before reviewing candidate outputs. Keep all private meeting material in ignored local files; use fictional fixtures for committed regression tests.

**Deliverable:** a source-grounded evaluation set with explicit expected facts, acceptable uncertainty and prohibited claims.

## 3. Establish runtime correctness and quality parity

First run native MTP off/on at zero temperature to investigate output differences. Check rendered prompts, tokenization, stopping, JSON constraints, context handling and sampling configuration. Identical seeds alone do not guarantee identical outputs across implementations.

Then test production sampling settings:

- Run each tuning case three times per configuration.
- Rotate configuration order to reduce thermal and ordering bias.
- Separate cold-start and warm-runtime measurements.
- Review outputs without displaying the backend label where practical.
- Expand repetitions when a result is close or inconsistent.

Score the dimensions separately:

| Dimension | What must be checked |
|---|---|
| Grounding | Claims follow from the cited evidence |
| Attribution | Speaker, owner and recipient are correct |
| Current state | Later completion, cancellation or replacement is respected |
| Commitments | Accepted actions retain conditions and deadlines |
| Decisions | Proposals and unresolved choices remain qualified |
| Coverage | Material topics and qualifications survive |
| Structure | Output parses, references resolve and generation finishes |

Classify failures as shared baseline errors, native-runtime differences, MTP-associated differences, or unresolved variation. Investigate rather than attributing every differing answer to MTP.

**Gate:** no unresolved material regression attributable to the candidate configuration. Existing serious errors remain visible; baseline parity alone does not make a known unsafe output acceptable.

## 4. Tune MTP and prompt processing independently

The latest notes experiment showed approximately 59% of inference time spent processing prompts. That makes prompt processing a major optimization target alongside decoding. This is a prior pilot observation, not a fresh measurement or a performance ceiling.

Use a staged search rather than running every possible combination:

1. **Draft length:** compare MTP off with supported draft lengths such as 1, 2, 3 and 4.
2. **Batch and microbatch:** test controlled increases from the current 128 setting, starting with 256 and 512 where memory permits.
3. **Prompt reuse:** measure actual reused tokens and processing time before changing cache settings. Separate repeated-request benefits from fresh-meeting performance.
4. **Runtime alternatives:** if tuning plateaus, evaluate a compatible MLX implementation as a separate experiment. Record any weight or quantization differences that prevent a direct comparison.

Do not change prompts, context limits, quantization and runtime simultaneously. Do not increase context size merely to avoid multiple writer calls without a separate quality and memory experiment.

Track:

- Time to first visible text.
- Time to a complete usable answer or notes document.
- Prompt-processing and decoding time.
- Draft acceptance and verification overhead.
- Output length, retries and failures.
- Memory pressure, swap growth and serving-process memory.

**Deliverable:** a small set of configurations with measured tradeoffs, followed by confirmation on the held-out cases.

## 5. Keep notes-quality improvements as a separate experiment

Reuse the existing editor/correction machinery before introducing another review subsystem.

Test whether focused correction can repair:

- Missing accepted commitments.
- Incorrect owners or recipients.
- Lost deadlines and conditions.
- Stale actions after later completion.
- Unsupported decisions.

The reviewer must have enough original context to find antecedents and later changes. Reviewing only the writer's chosen citations would miss precisely the evidence the writer omitted. Reviewing only existing actions would also miss commitments classified as discussion.

Compare, with MTP off and on:

- Accepted writer and existing deterministic checks.
- Accepted writer plus bounded corrections.

Measure the complete corrected result, including review, retries and acceptance. The current observed saving is roughly 23 seconds per notes job; an additional pass could consume it. Treat that saving as a pilot observation to remeasure.

**Gate:** retain the correction approach only if it improves the intended quality dimensions without introducing other material errors. Its performance must be reported separately from MTP's benefit.

## 6. Integrate the qualifying runtime behind an opt-in provider

Start with Deep Ask if it qualifies first. Leave meeting notes and the quick-model route on their current providers until they independently qualify.

The native provider needs:

- Verified model and drafter installation, independent of Ollama's blob directory.
- Managed startup, readiness checks, cancellation and shutdown.
- Request scheduling that respects recording and transcription.
- Streaming, structured output and bounded context behavior.
- Explicit handling of crashes, timeouts and memory pressure.
- Local diagnostics without private prompt content in shared logs.
- A simple route back to the existing provider.

Avoid keeping both large-model runtimes loaded. Any fallback should release the failed runtime before loading another and prevent partial or duplicate results from being saved.

**Deliverable:** an opt-in development build. Existing user defaults remain unchanged.

## 7. Run packaged-app acceptance, including recording

Test the actual packaged provider through Pluto's UI, IPC and persistence path in a disposable profile.

Cover:

- Deep Ask while recording.
- Notes generation while recording.
- Recording stop and finalization while inference is active.
- Cancellation and repeated requests.
- Runtime failure and subsequent recovery.
- Relaunch, idle unloading and model reloading.

Verify audio continuity, journal sealing, transcript finalization, saved output, UI responsiveness and process cleanup. Include controlled real-speech replay as well as packaged recording checks; silent or ambient capture alone cannot establish transcription quality.

Compare recording latency, queue growth, memory pressure and failures against the same workload without MTP.

**Gate:** no recording-data loss, new finalization failure, persistence corruption or unresolved material responsiveness regression.

## 8. Make the promotion decision per workload

Freeze practical thresholds before inspecting the final results. Proposed targets:

| Workload | Proposed performance target |
|---|---|
| Deep Ask | At least 20% lower median completion time |
| Meeting notes | At least 15% lower median time to usable notes |
| Both | No material first-token or slow-case regression; quality and recording gates pass |

These are proposed product thresholds, not claims that current results meet them. Report per-case results and uncertainty; do not present a small sample as a reliable production p95.

Possible outcomes:

- **Deep Ask passes, notes fail:** promote only Deep Ask.
- **Both pass:** enable both incrementally.
- **Quality passes, performance is marginal:** retain the experiment without changing defaults.
- **Correctness or recording fails:** fix the identified cause and rerun the affected checks.
- **Ollama removal:** proceed only after the quick-model route and remaining dependencies have their own acceptance results.

The final review package should contain the experiment manifest, reproducible commands, aggregate measurements, semantic findings, packaged-app results and rollback procedure. Private evidence stays local.

## First milestone and boundaries

Establish accepted-prompt MTP parity and complete the initial draft-length/batch tuning sweep. That gives us a defensible integration candidate before spending effort on provider packaging or another notes rewrite.

Preserve unrelated work, production recordings, transcripts, notes and settings. Keep private evidence, names, meeting titles and credentials out of Git and shared reports. Do not overwrite earlier benchmark artifacts.

No release or default-provider change is authorized by drafting or saving this plan. Promotion remains a separate decision based on the completed gates.

## Execution checkpoint — 2026-10-14

- Created a new ignored private evaluation directory and preserved prior artifacts.
- Verified target/drafter/runtime hashes and the accepted notes-v34 writer prompt. Recorded revision, relevant source hashes, runtime arguments, hardware, model routes, sampling and promotion criteria.
- Reused two diagnostic cases and their existing expected-fact ledgers. Attempted one notes case and two fixed-evidence Deep Ask cases at zero temperature.
- Rejected the baseline: two tasks timed out, and pre-run CPU plus a separate 32K-context request showed competing inference activity. Memory pressure and existing swap further confound timings. No native comparison or tuning was performed.
- Added a stricter isolated-run preflight. Next: establish a quiet inference window, rerun in a fresh private directory, review parity, then begin draft-length/batch tuning.
- No application code, provider defaults or production data were changed. Private reports and source material remain outside Git.

## First-milestone evaluation results — 2026-10-14

The isolated comparison and initial tuning are complete on the two existing diagnostic cases. This is a completed experiment with a failed quality gate, not an accepted runtime integration.

- Verified model/runtime hashes, accepted notes-v34 prompt, and token-equivalent native/Ollama inputs; preserved the original prompt throughout.
- Completed the MTP-off/draft1–4 sweep, batch/microbatch128/256/512 comparisons with matching off controls, confirmation on the other diagnostic case, and repeated production-temperature Ask runs with paired seeds.
- The performance reference is draft4 with batch/microbatch128. Warm fixed-evidence Ask median was about 22.4 seconds versus 31.5 seconds for Ollama, roughly 29% faster. Larger batches showed no meaningful benefit. These are generation-only measurements on two cases, not production latency guarantees.
- Notes failed ownership and current-state checks. Ask lost an explicit commitment in a paired comparison; the loss persisted at the smallest batch and with the other useful draft settings. Shared baseline and saved-note errors also remain visible.
- No provider is promoted or integrated. Application code, accepted prompts, settings and model defaults were not changed; private evidence remains ignored.
- Next: the separately planned semantic/source-correction experiment, followed by broader held-out parity and full application/recording acceptance. Do not substitute structural validation or speed for those gates.
