# Notes Output Capacity Implementation Proposal

**Status:** Proposed design for review; no implementation or production retry authorized by this document.

**Issue:** https://github.com/metagrover/pluto/issues/753

**Goal:** Complete ordinary long-meeting notes through bounded, independently validated parts, retaining source attribution and preventing repeated unchanged truncation failures.

**Architecture:** Extend the existing compact writer/editor pipeline. Plan source parts against input capacity and expected output capacity; validate each completed part, assemble with code, and publish the complete document atomically. Use a bounded recovery schedule instead of rerunning the same oversized part.

**Tech stack:** TypeScript, Electron, Ollama, SQLite, Vitest.

## Evidence and correction to the earlier diagnosis

The September 6 manual run persisted two planned leaves. Its first writer call produced 1,024 tokens in approximately 154 seconds; the compact retry produced 1,024 tokens in approximately 87 seconds. Both were truncated. Repartition count was zero, and no editor ran. The meeting has 443 source segments and 21,952 source characters. The run failed without publishing analysis.

`runBoundedCompactNotes` permits bisection only when the original leaf count equals one. A two-leaf plan therefore cannot recover by splitting its failed leaf. The input-fit test also does not estimate how much output the supplied evidence requires. A larger output limit alone would not address both problems.

Current product bounds are three planned leaves and six logical model calls. The call counter wraps `input.generate`; preemption retries inside the provider can perform additional physical requests. Any revised call budget must account for those requests too.

## Format decision

Keep the existing compact JSON contract for the first implementation. Ollama already receives a response schema. The observed error is a length termination, before completed-output parsing. Plain Markdown can also terminate midway and does not encode the existing source-label, item-kind, owner, and due-date checks.

Generate independent complete objects for smaller source parts. Do not concatenate unfinished JSON, append closing braces, accept a truncated prefix, or ask the model to continue from an arbitrary token. Those approaches can silently omit later decisions or commitments.

A Markdown-with-citations alternative may be evaluated separately against the same private replay corpus. It should replace the contract only if it improves completion and latency without regressing citation validity, factual coverage, or downstream extraction. No claim that either format eliminates every possible failure is warranted.

## Proposed tasks

### 1. Reproduce the actual two-part failure

Files: `tests/unit/meetingNotesPipeline.test.ts`, `tests/unit/meetingAnalysisRuns.test.ts`.

- [ ] Add a synthetic two-leaf fixture where leaf one terminates for length and leaf two contains a distinct action and a later reversal.
- [ ] Assert that current behavior rejects before processing leaf two. Record planned leaves, actual requests, stage outcomes, and exact source coverage.
- [ ] Add separate cases for direct-path truncation, editor truncation, malformed completed JSON, invalid citations, cancellation, and changed source revisions.
- [ ] Add a deduplication test proving several subscribers share one run and receive its terminal result without multiplying model work.

### 2. Plan parts for output as well as input

Files: `electron/llm/meetingNotesBudget.ts`, `electron/llm/meetingNotesPipeline.ts`, `electron/llm/meetingNotesPrompts.ts`, corresponding unit tests.

- [ ] Introduce a deterministic planner returning primary source spans, bounded context overlap, writer output allowance, editor allowance, and worst-case request count.
- [ ] Require both normalized wire-input fit and a conservative source-content budget for each part. Count actual source text separately from prompt instructions and segment-envelope overhead. Highly fragmented short turns must not be mistaken for greater semantic volume.
- [ ] Use source ordering and speaker-turn boundaries; preserve exact original source offsets when splitting a long turn. Do not add an LLM topic-segmentation pass.
- [ ] Test 1,024 versus 2,048 writer tokens and smaller source packets in the private replay harness. Choose numerical packet limits from measured completion and latency, rather than treating input fit as proof of output fit.
- [ ] Reserve editor input headroom for the complete proposed draft, expanded citations, editor output, and safety margin. Recheck the actual draft before admitting the editor.

### 3. Replace unchanged truncation retries with bounded recovery

Files: `electron/llm/meetingNotesPipeline.ts`, `electron/llm/meetingNotesTypes.ts`, `electron/llm/unifiedProvider.ts`, `tests/unit/meetingNotesPipeline.test.ts`, provider tests.

- [ ] Unify direct and multipart truncation handling so every part is eligible for the same recovery policy.
- [ ] On writer length termination, bisect only the failed part at a precomputed source boundary. Do not first spend another request on the same source packet and output ceiling.
- [ ] Reserve one recovery split per run for the initial policy. A three-part base plan needs at most six normal requests plus three extra requests if one writer fails and is replaced by two writer/editor pairs: nine total. A failure requiring more work terminates precisely; it never opens an unbounded recursion.
- [ ] Before every request, check the remaining call budget and existing absolute run deadline. Count physical provider starts, including restarted preempted requests, with one shared run budget. Queued requests that never start do not count as inference calls.
- [ ] Preserve completed validated parts in the existing stage cache with source, prompt, model, and policy-version keys. Persistent checkpoints across app restarts are a separate enhancement, not required for this first change.
- [ ] Distinguish length termination, malformed completed output, source-reference failure, preemption, and budget exhaustion. Permit only the existing explicitly supported deterministic acceptance paths; never broaden validation fallback to unknown citations or unsafe content.
- [ ] Treat an editor length termination explicitly: use a separately reserved capacity-compatible editor attempt if affordable, otherwise retain the validated draft checkpoint and end with a precise reason. Do not silently mark the part reviewed.

### 4. Assemble complete notes without another model rewrite

Files: `electron/llm/meetingNotesPipeline.ts`, `electron/llm/meetingNotesGuardrails.ts`, associated tests.

- [ ] Reuse deterministic assembly and the current persisted notes document contract.
- [ ] Preserve every accepted section, item, source span, owner, date, condition, and withdrawal. Remove only exact duplicates with matching evidence; avoid name-based or similarity-based commitment merges.
- [ ] Retain bounded boundary context as evidence while assigning each source range to one primary part. Verify a later cancellation or replacement is reflected by final whole-source checks; do not publish mutually contradictory commitments as simultaneously active.
- [ ] Require all primary source parts to finish before normal publication. Partial checkpoints remain internal and must not be presented as complete meeting notes.
- [ ] Preserve transactional publication and stale-run checks. Existing published notes remain until the replacement is accepted.

### 5. Make retry and progress behavior understandable

Files: `electron/meetingAnalysisRuns.ts`, `electron/llm/meetingNotesRunMetrics.ts`, existing downstream-processing presentation utilities, `src/components/features/MeetingView.tsx`.

- [ ] Emit run ID, part ID, source size, planned and actual requests, requested output ceiling, termination reason, and stage outcome. Do not log transcript or generated note content.
- [ ] Present “Writing notes, part 2 of 3” and “Checking notes” from coordinator state; deduplicated subscribers show the same result.
- [ ] Expose an actionable terminal message such as “This section needs a smaller processing batch” rather than a generic formatting failure.
- [ ] Include the revised pipeline policy version in run fingerprints and checkpoint keys. Retain the existing automatic retry guard; do not reset counters or trigger a bulk historical retry merely because the policy changed. Roll out recovery through an explicit selected-meeting retry first.
- [ ] Coordinate with the existing uncommitted MeetingView and CSS changes during implementation.

### 6. Verify against real failures before delivery

- [ ] Run focused pipeline, budgeting, wire-format, publication, and UI presentation tests, then TypeScript and repository lint.
- [ ] Run a private local-Ollama replay of the affected meeting without publishing results. Require full accepted output, valid source references, inclusion of late-meeting material, bounded requests, and recorded wall time.
- [ ] Replay other known truncation cases and short successful meetings. Include a boundary reversal, dense decisions, absent owner/deadline, and a highly segmented transcript.
- [ ] Compare the current baseline with the selected output allowance and packet sizes. Report failed cases honestly; unit tests with mocked model responses are not proof of real-model completion.
- [ ] Keep source text and generated private notes out of committed fixtures and public issue comments. Publish aggregate metrics only.
- [ ] Update #753 acceptance criteria with the approved policy and measured result during implementation; add a changelog fragment when shipping.

## Separate scheduling follow-up

Project discovery should move off the Projects overview mount path into the existing idle scheduling mechanism, with cached results shown immediately and an explicit refresh action. Expected preemption should return a paused/deferred state and reschedule after foreground work ends. Scope this as a separate PR: it improves browsing and resource scheduling but does not repair the notes length failure.

## Acceptance boundary

The affected meeting must complete in an isolated real-model replay before claiming this issue resolved. Every request and recovery must fit an explicit call budget and deadline. No invalid or truncated output is published, no later source part is silently omitted, and the previous notes remain recoverable. Arbitrarily long meetings can still exceed the configured processing bounds; they must receive a precise recoverable result rather than an endless retry loop.
