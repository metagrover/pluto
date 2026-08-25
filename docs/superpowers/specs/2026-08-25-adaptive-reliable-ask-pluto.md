# Adaptive and Reliable Ask Pluto

**Governing issue:** [#62 — Make Ask Pluto cited and correction-aware](https://github.com/metagrover/pluto/issues/62)  
**Related work:** [#614 — Add meeting-scoped chat](https://github.com/metagrover/pluto/issues/614), PR #636  
**Status:** Approved  
**Date:** 2026-08-25

## Outcome

Ask Pluto provides responsive, evidence-backed conversation across the current
meeting and meeting history. It uses fast generation for straightforward
retrieval and deeper reasoning when comparison, synthesis, or judgment is
required.

The phrase **current meeting** has one product meaning:

1. If a recording is active, use that recording.
2. Otherwise, use the most recently started persisted meeting.
3. If that meeting is processing, failed, or has incomplete evidence, expose
   that state. Do not silently substitute an older completed meeting.
4. If no meeting exists, return an explicit unavailable state.

## Problem

The current global Ask Pluto path can present an unexplained loader for minutes.
It submits a single non-streaming IPC request, disables the composer while the
request is pending, has no renderer cancellation path, and does not expose queue,
retrieval, or generation phases. It also sends only the latest question, so the
visible conversation and current-meeting context are absent from the backend
request.

Local Ollama work is serialized. Pluto now has a cooperative preemption primitive
for background knowledge synthesis, but Ask Pluto still needs an end-to-end
foreground lifecycle proving admission, abort settlement, bounded waits, and UI
recovery. Model choice or a global thinking toggle cannot repair these missing
contracts.

## Goals

- Make every Ask Pluto request visibly progress, complete, fail, or cancel.
- Resolve current-meeting language deterministically.
- Preserve bounded conversational continuity and evidence references.
- Pin the current meeting when comparing it with history.
- Select fast or deep local reasoning per request.
- Return claim-level evidence and honest answer-level trust.
- Reuse shared Pluto memory, attention, trust, and correction systems.

## Non-goals

- Cloud fallback or external document search.
- Autonomous external actions.
- Permanent storage of full chat transcripts.
- An Ask Pluto-specific memory, attention, or correction store.
- A new vector database in the first release.
- Employee evaluation or coaching inferences.

## Scope resolution

### Current-meeting resolver

At submission time, Pluto creates an immutable scope snapshot:

```text
active recording exists
  -> active recording meeting ID + frozen live evidence snapshot
otherwise
  -> latest persisted meeting by started_at/created_at
otherwise
  -> no-current-meeting state
```

The persisted fallback orders by `COALESCE(started_at, created_at) DESC`, with a
stable ID tie-breaker. It does not filter to finalized meetings.

The active recording uses its real meeting ID rather than a synthetic
`active-recording` identity. Its frozen snapshot contains bounded committed
transcript segments, bounded interim text, notes, participants, and the capture
timestamp.

An answer started during recording remains bound to that frozen snapshot even if
recording stops or finalization finishes while the answer is generated. A later
turn that explicitly says "current" or "latest" resolves again. Referential
follow-ups such as "Why?", "Compare that", or "What changed?" inherit the prior
turn's resolved scope and cited claims.

Live, provisional, processing, failed, and completed sources remain distinct. If
the latest meeting is processing, it remains the current meeting and Pluto says
which evidence is not ready.

### Supported scopes

- Current meeting.
- A selected meeting.
- Meeting history.
- Current meeting compared with history.
- Explicit meetings, people, projects, streams, or time periods.

When a question refers to the current meeting, that meeting is pinned into the
evidence packet. Retrieval ranking cannot remove the anchor.

## Adaptive reasoning

Thinking is selected per request, not globally.

| Request | Mode | Thinking |
| --- | --- | --- |
| Greeting or product guidance | Deterministic | No model where possible |
| Simple fact, quote, owner, date, or status | Fast | Off |
| Summary of one completed meeting | Fast | Off by default |
| Live "What was just said?" | Live Quick | Off; frozen snapshot where possible |
| Cross-meeting comparison | Deep | On |
| Change, conflict, trend, rationale, or risk analysis | Deep | On |
| Advice grounded in several meetings | Deep | On |
| Explicit "Analyze deeply" request | Deep | On |

Thinking never compensates for missing evidence. If retrieval cannot establish
the necessary sources, Pluto constrains the answer and states what is missing.
Automatic routing is the default; the composer offers an **Analyze deeply**
override.

Initial Qwen 3.5 9B budgets on the target 16 GB M1 Pro:

| Mode | Context | Output | Thinking |
| --- | ---: | ---: | --- |
| Classification | Small schema input | 128 tokens | Off |
| Fast answer | Up to 8K | 768-1,024 tokens | Off |
| Deep answer | Up to 16K | Up to 2,048 tokens | On |
| Live Quick | Frozen recent snapshot | Short bounded answer | Off |

These are initial limits and must be confirmed by local latency and quality
benchmarks. Pluto keeps Qwen 3.5 9B resident rather than routinely swapping
models.

## Conversation contract

The session retains bounded working context:

- The last six relevant turns.
- Resolved meeting scopes.
- Claims and citation IDs.
- Unresolved references such as "that decision".
- Current reasoning mode and trust state.

The transcript is session-scoped. Explicit corrections flow through Pluto's
shared correction and cognitive-memory system.

```ts
interface AskPlutoRequest {
  requestId: string;
  query: string;
  priorTurns: BoundedConversationTurn[];
  scope: ResolvedAskPlutoScope;
  modeOverride?: 'auto' | 'fast' | 'deep';
}
```

The frozen scope carries the resolution reason, meeting IDs, snapshot timestamp,
source processing states, bounded evidence, citation IDs, and trust metadata.

## Request lifecycle

Ask Pluto is foreground work:

1. Resolve and acknowledge scope.
2. Abort or checkpoint active background knowledge synthesis.
3. Wait for the background request to settle.
4. Retrieve evidence and generate the answer.
5. Resume background work later from a safe boundary.

Only one Ask Pluto request runs per conversation. The active request always has
a Cancel action, and abort propagates renderer -> IPC -> provider -> Ollama.

The backend emits typed lifecycle events:

```text
scope_resolved
retrieving
generating
answer_delta
citations_ready
completed
cancelled
unavailable
failed
```

Prose may stream before citation validation completes, but claims are not marked
grounded until their evidence audit finishes.

## Evidence assembly

For current-versus-history questions:

1. Pin the current-meeting evidence.
2. Retrieve historical candidates separately through existing FTS and entity
   graph seams.
3. Select evidence within the chosen mode's context budget.
4. Preserve source meeting, time, processing state, and transcript spans.
5. Require material comparison claims to cite both sides where applicable.

Structural citation existence is insufficient. Citation validation must assess
whether the evidence supports the claim. Unsupported claims are removed or
marked needs review.

## User experience

No unexplained loader may remain visible for more than two seconds. Within one
second, the UI shows a concrete state such as:

- Reading the current recording.
- Reading Product Review.
- Comparing Product Review with four earlier meetings.
- Checking the supporting transcript.
- This meeting is still processing.

The interface preserves the conversation and typed draft, exposes Cancel, and
allows Retry without losing the question. It distinguishes provisional live
answers from completed grounded answers. A request failure cannot leave the
composer permanently disabled.

## Acceptance criteria

### Reliability

- No silent loader lasts longer than two seconds.
- Foreground Ask Pluto interrupts or checkpoints active background synthesis
  within two seconds.
- Cancel settles the request and restores the composer within two seconds.
- Queue wait, provider timeout, cancellation, unavailable evidence, and provider
  failure have distinct truthful states.
- Background synthesis can resume without duplicate persistence or corrupted
  state.

### Responsiveness

With the local model warm:

- Fast factual requests begin streaming within five seconds at p95.
- Deep requests acknowledge their scope within one second.
- Deep requests begin streaming within fifteen seconds at p95.
- Queue, retrieval, first-token, generation, and cancellation timings are
  recorded separately.

### Current meeting

- During recording, current meeting resolves to that recording.
- Without a recording, it resolves to the most recently started persisted
  meeting, even when that meeting is processing.
- The request remains bound to its frozen scope when recording state changes.
- A later explicit current/latest reference resolves again.
- No-meeting state produces no invented evidence.

### Reasoning and trust

- Factual questions use Fast mode unless explicitly overridden.
- Comparison, conflict, trend, and current-versus-history questions use Deep
  mode.
- The current meeting cannot be displaced by historical ranking.
- Follow-up references use bounded conversation state.
- Material factual claims carry supporting meeting evidence.
- Comparative claims cite the relevant meetings on both sides.
- Live evidence is provisional and processing states remain visible.
- Insufficient evidence produces a constrained answer.

## Delivery slices

### 1. Reliability

Prove foreground preemption end to end; add cancellation, streaming lifecycle,
bounded generation, truthful status, and request timing.

### 2. Context

Add the current-meeting resolver, frozen snapshots, bounded continuity, and
pinned evidence retrieval. Reuse the scoped request and evidence packet work from
PR #636 where it matches this contract.

### 3. Intelligence

Add Fast/Deep routing, cross-meeting evidence assembly, claim-level support
auditing, and the deep-analysis override.

Each slice is independently testable and releasable.

## Verification

- Unit tests cover resolver precedence, recording transitions, routing, budgets,
  follow-up resolution, and trust derivation.
- Integration tests cover background preemption, abort settlement, cancellation,
  recording stop during a request, processing meetings, provider failure, and no
  meetings.
- Renderer tests cover lifecycle copy, streaming, Cancel, Retry, draft
  preservation, and composer recovery.
- Electron tests exercise local Ollama with synthetic meeting fixtures.
- A benchmark set covers factual lookup, selected/current meeting questions,
  current-versus-history comparison, conflict detection, follow-ups, and
  insufficient evidence.

## Rollout and rollback

Land the three slices separately behind the unified typed IPC contract. Keep the
existing global entry point available until the reliability and context
acceptance tests pass in Electron. If the new adaptive router regresses quality,
route all model-backed requests through Fast mode while retaining the new scope,
streaming, cancellation, and trust contracts.
