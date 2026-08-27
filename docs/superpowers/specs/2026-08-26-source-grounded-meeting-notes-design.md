# Source-grounded meeting notes: approved design

**Issue:** [#674](https://github.com/metagrover/pluto/issues/674)

**Status:** Architecture approved; implementation not started.

**Baseline:** `f1fbb7d53` on local `master`.

**Implementation plan:** [Task-by-task plan](../plans/2026-08-26-source-grounded-meeting-notes.md)

## Outcome

Produce useful, trustworthy general-purpose meeting notes promptly, without forcing every local recording through topic segmentation and per-topic generation. The user approved choosing the architecture from the observed failures and published guidance; do not reopen an architecture comparison as a prerequisite to implementation.

## Chosen architecture

```text
Eligible persisted transcript + user context
                    |
          immutable source snapshot
                    |
        shared context-budget router
          /                       \
   complete input fits       input exceeds budget
          |                       |
     one writer          source-linked chunk writers
          |              + bounded hierarchical merges
     one source audit             |
          |              source audits at bounded nodes
          \                       /
           checked v3 notes document
                    |
       revision-checked atomic publication
                    |
    background signals / entities / knowledge
```

The successful direct path has exactly two LLM requests: writer and audit. The audit returns constrained edits and source-backed review results; code applies them without another full-document generation. Invalid or timed-out audits do not silently become successful notes. The hierarchy is an input-size fallback, not a provider-specific default.

## Product contract

- Preserve what mattered, including exploratory or personal material when relevant. Do not force executive language, a fixed number of topics, or action items into every meeting.
- Distinguish facts, proposals, uncertainties, decisions, and commitments. A complete interview or brainstorming note may legitimately contain no actions.
- Extract owners separately from task text. Use verified speaker labels or explicit names; never infer identity from the meeting title or invent a collective owner.
- The source audit checks summaries and titles as well as structured actions. It actively scans for omissions even when the draft action list is empty.
- Preserve conditions, negation, quantities, chronology, and later reversals. A current event and a possible next event are not interchangeable.
- Keep canonical transcript bytes unchanged. Source references resolve to exact original spans; spelling aliases affect generated notes, not quotations.

## Model and latency contract

- Retain the configured provider, model, thinking setting, and privacy boundary. Terra is the implementation agent, not a replacement meeting-analysis model.
- Route using a single conservative estimator and output reservations for both writer and audit. The initial local context ceiling remains the existing 16,384-token ordinary-task ceiling; no automatic increase to the advertised model maximum.
- Reduce generated redundancy: each action/decision appears once in model output; code derives rollups and evidence strings.
- Fold terminology proposals into the writer/audit exchange. No unconditional standalone terminology request.
- Save and expose reviewed notes before value signals, entity extraction, MID, or knowledge synthesis completes. A meaningful existing title is preserved.
- No unreviewed draft streaming into persisted notes. Keep the previous good revision visible during regeneration.
- Coalesce duplicate requests and cache only bounded, completed stages for identical input/policy/model keys. A new explicit regenerate request after a completed run still performs a fresh audit.

## Long-input contract

Split by token budget at utterance boundaries, retaining source spans and bounded overlap. Never discard a tail to make a request fit. All leaf chunks must be processed before final publication. Consolidate in a bounded tree, never by repeatedly rewriting an ever-growing running summary. Retain the union of source-backed commitments and later cancellation/qualification records across nodes. Parent audits see original evidence passages for inherited claims, not only generated summaries. When a request cannot fit even after safe splitting, fail explicitly and retain existing notes.

## Terminology contract

Known entity names from automatic extraction are candidate hints, not automatically trusted spellings. Trust explicit user corrections, user-provided spellings, or clear definitions in the source. The audit may propose contextual aliases, but unsupported proposals remain unapplied. Confidence labels alone cannot authorize correction. Reuse the existing versioned terminology artifact for compatibility; do not promote model guesses into a persistent glossary.

## Persistence and recovery contract

- One current analysis run per meeting, shared across manual regeneration and automatic downstream processing.
- The database owns the run identity and publication compare-and-swap. Source/user-context revisions must still match when publication commits.
- Publication updates only analysis-owned fields, taking the latest title and edit map from the database. Never spread a stale renderer meeting object over current data.
- Ignore no-op whitespace edits. Rebase genuine edits only onto an unambiguous matching block; otherwise retain them in a visible, recoverable conflict collection.
- Audit failure keeps the previous notes; first-generation failure leaves the transcript available with an explicit retry state.
- Secondary failure retains already-published notes and records the failing stage. Empty successful extraction remains distinguishable from failed extraction.
- Preserve v2/v3 readers and existing transcript eligibility, including the narrowly authorized partial-capture-gap path. Do not change recording or recovery policy.

## Scope boundaries

No model migration, automatic cloud fallback, live-recording LLM inference, multi-agent runtime, new retrieval database, audio retranscription, broad UI redesign, or bulk regeneration. Existing generation gates, source-trust checks, v3 rendering, terminology gates, owner normalization, and entity idempotency must be reused where applicable.

## Evidence and limits

- [Anthropic workflow guidance](https://www.anthropic.com/engineering/building-effective-agents): prefer simple, predefined workflows when the task is bounded.
- [Long-context guidance](https://ai.google.dev/gemini-api/docs/long-context): direct context is useful, but context capacity does not establish complete retrieval. This is not evidence that Qwen on this machine has Gemini's capabilities.
- [Meeting-summary refinement](https://aclanthology.org/2025.coling-main.143/): targeted error identification/refinement can improve summaries; the studied multi-LLM setup is not identical to this two-request local adaptation.
- [Self-correction survey](https://aclanthology.org/2024.tacl-1.78/): prompted self-confidence is not a reliable correctness guarantee.
- [SummN](https://aclanthology.org/2022.acl-long.112/): bounded multi-stage summarization is a defensible fallback for over-context inputs.
- [Latency guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency): remove unnecessary input/output work; hard truncation is not a quality-preserving optimization.

These sources inform the design. They do not establish a latency multiplier or perfect factuality for Pluto. Tests and real-provider checks verify implementation acceptance after the architectural decision.
