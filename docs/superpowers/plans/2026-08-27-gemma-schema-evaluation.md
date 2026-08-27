# Gemma schema reliability: acceptance record

Issue #674. Local-only implementation and synthetic evaluation; no default-model switch or production meeting regeneration.

## Predeclared evaluation

The previous report remains unchanged in `2026-08-27-local-notes-guardrails-evaluation.md`. Its successes and failures are not retroactively rescored.

Compare the same three short cases (personal conversation, qualified publication, accepted request/privacy) and one new longer exhibition-planning conversation at seeds 41 and 73. The new fixture checks early and late commitments, a conditional courier booking, an unrelated withdrawn promise, an unaccepted offer, a numeric decision and personal/contextual coverage. Exact expectations are in `tests/manual/fixtures/meetingNotesGemmaReliabilityCases.ts` before inference. It is a longer direct-input synthetic test, not evidence of real-recording or hierarchical acceptance.

The content prompt, model, sampling and per-stage output budgets stay fixed. Only generation structure is constrained. Existing source decoding, semantic validation and one repair per stage remain active. Short cases keep their prior 270-second case limit; the new longer case has a predeclared 600-second limit. No retries outside the pipeline to select favorable samples.

Report three separate outcomes: transport completion, accepted response structure, and source-level content quality. A mechanical pass is not a semantic pass. Inspect raw responses before decoding, all final visible claims, supported ownership/deadlines/prerequisites, cancellation, decisions, narrative coverage and invented details. Unexpected faithful paraphrases can be explained separately without changing assertions after observing output.

## Runtime and configuration

Verified before inference on 2026-08-27:

- Ollama 0.32.15 at the local loopback endpoint.
- Installed `gemma4:12b`, digest `4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c`, 11.9B Q4_K_M.
- Thinking disabled; temperature 0.1 for notes, seeds 41/73, eight threads, 16,384-token capacity. Actual bounded request context/output is recorded per attempt.
- Installed model parameters include top_k 64 and top_p 0.95. Notes temperature overrides the model's default 1.
- The shared server was serving Qwen work for another client during preflight. It is not an isolated runtime. Do not stop other clients, unload their model explicitly or alter server settings for this test. Elapsed times are observations, not model speed comparisons.

Ollama supports a JSON Schema object in its local `format` field, distinct from requesting generic JSON. This supplies structural constraints, not factual evidence. See [official structured-output documentation](https://docs.ollama.com/capabilities/structured-outputs).

## Delivery boundary

This record starts with the prospective contract, before model output. Production promotion requires completed acceptance; synthetic tests do not establish rendered-app or new-recording behavior. The original transcript, saved meeting notes and configured model remain unchanged.
