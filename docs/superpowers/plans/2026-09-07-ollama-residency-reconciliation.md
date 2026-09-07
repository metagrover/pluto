# Ollama Residency Reconciliation Implementation Plan

> Issue: #784

## Goal

Make local-model switches reliable after Pluto or a diagnostic process restarts while Ollama still retains a different model under the one-hour keep-alive policy.

## Confirmed boundary

- Ollama residency outlives a `UnifiedLLMProvider` process.
- Pluto currently remembers the active model only in process memory.
- Frozen evaluation artifacts recorded fresh-process model requests reaching the 90-second deadline while a different model was resident.
- A settled direct Ollama switch can complete quickly, so the repair is a deterministic residency guard rather than a latency-threshold or model-routing change.

## Tasks

1. Add failing unit coverage for a fresh provider discovering a non-target resident model, unloading it before generation, retaining an already matching target, and stopping on discovery or cleanup failure/cancellation.
2. Add a bounded residency preflight inside the serialized Ollama inference admission. Query `/api/ps`, normalize returned model names, unload each non-target resident model with `keep_alive: 0`, and only then issue the target generation.
3. Keep explicit user/background unload best-effort, but make required switch cleanup fail closed so Pluto never knowingly starts a second model after cleanup failure.
4. Add an issue #784 changelog fragment and update the evaluation report only with executed evidence.
5. Verify targeted tests, the full suite, TypeScript, lint, changelog validation, and a real Gemma-to-Phi-to-Gemma switch. Then run the frozen 12-case evaluation with exact model digests and settings.

## Non-goals

- No model-selection change.
- No change to note acceptance criteria or frozen corpus.
- No claim that point-in-time memory, swap, or thermal snapshots are peak measurements.
- No weakening of cancellation, preemption, or provider-error behavior.
