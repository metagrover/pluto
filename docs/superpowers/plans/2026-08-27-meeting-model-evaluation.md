# Meeting Model Evaluation — #674

User approval: evaluate alternatives to `qwen3.5:9b` using synthetic transcripts only. Keep production model/settings/meetings unchanged. No merge or push.

## Fixed comparison

- Same source-only reconciliation prompt, exact source-reference codec, four-array contract and independent semantic fixtures.
- First cases: conditional promise versus declined offer; six-turn withdrawal/qualified promise; request/acceptance/recipient holdout.
- Seed 41 first; expand passing candidates to the complete varied suite and seeds 42/43. No retries or source edits to improve a score.
- Existing provider request profile: temperature 0.1, thinking disabled, 16,384 context tokens, 2,048 output tokens, eight threads. Other sampling values are inherited from each model's installed manifest and recorded, not assumed identical.
- Raw output is recorded before parsing. Gate failure is not automatically semantic failure: distinguish malformed schema/provenance, production-validator false positive, fixture taxonomy mismatch, and substantive source contradiction. Inspect all raw arrays even when scoring is not reached.
- Specific known caveats: the original guard lacked `conditional on` vocabulary; a grounded choice to leave work unassigned may violate the fixture's zero-decision taxonomy without being invented. Do not weaken either gate silently or use these caveats to excuse cancelled/declined tasks.

## Feasible candidates

The machine has 16 GB unified memory. No OpenAI, Anthropic or Gemini API key is configured in Pluto's settings or the current process environment; no Codex login credentials will be repurposed as API credentials.

1. **Phi-4 Mini 3.8B:** already installed, different-family reference; not presumed stronger because of its size.
2. **Gemma 4 12B Q4_K_M:** [official Ollama package](https://ollama.com/library/gemma4:12b), approximately 7.6 GB download, distinct current model family. Test actual memory/runtime behavior; package size is not a runtime-memory guarantee.
3. **Ministral 3 8B:** [official Ollama package](https://ollama.com/library/ministral-3:8b), approximately 6 GB download; test if a second newly downloaded family is needed. Do not download an untested collection.

An additional already-installed reference, **Qwen2.5 Coder 7B**, was tested without a download. This is a diagnostic comparison, not an assumption that a coding model is appropriate for meeting notes.

Downloads add local model packages only. They do not modify Pluto's default. Run inference sequentially; do not stop or restart the user's app. Timings with the production app running are not isolated benchmarks.

## Completion record

- [x] Critical cases tested with raw artifacts and exact model digests.
- [x] Independent review distinguishes semantic errors from guard/taxonomy failures.
- [x] Expand any passing candidate across varied cases and seeds, or record that none passed.
- [x] Record final recommendation, remaining gates and local package additions; verify code and preserve a local checkpoint without promotion.

No candidate is a production recommendation until its accuracy and reliability gates pass. This comparison is not permission to switch the default or regenerate production meetings.

## Verified intermediate results

Raw responses, hashes, model digests and failure-stage annotations are retained in `tests/manual/fixtures/meetingNotesAlternativeModelEvaluation.json`.

- **Phi-4 Mini 3.8B, seed 41:** 0/3 unchanged gates passed. Conditional Ava action is correct; grounded leave-unassigned content fails the decision guard/taxonomy. The six-turn case copies schema-example strings instead of source content. The holdout omits provenance and action fields and invents an action for recipient Amara. Independent semantic assertions were not reached; manual review establishes the latter substantive failures.
- **Qwen2.5 Coder 7B, seed 41:** 0/3 gates passed, all reaching the independent scorer. Every response has an empty action array despite an explicit qualified promise; additional discussion coverage/attribution is missing. These are not validator false positives.
- **Gemma 4 12B, seed 41, baseline:** 0/3 unchanged gates passed. The first response drops the action prerequisite and emits a source-less `None` question. The six-turn response correctly resolves Ava's withdrawal and retains Dana's qualified promise, but promotes Ben's unaccepted offer. The holdout correctly preserves Sol's single qualified action, historical work and recipient role; its remaining observed failure is a grounded no-summary decision/guard-taxonomy mismatch. Independent scorers were not reached. The model loads on this machine: Ollama reported 8,058,788,903 GPU bytes with the requested 16K context. First case includes cold-load time; none of these timings is an isolated performance benchmark.
- **Validator correction:** TDD reproduced three equivalent-condition false positives and added `conditional on` / `contingent on/upon` to the existing vocabulary. Eight regression cases preserve exact text/source and reject dropped/negated prerequisites and reversed ordering. Independent review found no actionable issue; 228 unit/DOM files and 2,283 tests passed. Electron 40.8.0 SQLite ABI 143 was restored and verified in memory afterward.
- **Saved-output replay:** The previous Qwen recommended-sampling response now passes its Ava action but the complete unedited response still fails at decision `s0:item:4`. Isolating the unchanged action confirmed the vocabulary fix only; this diagnostic is not counted as a model pass. No prompt, fixture assertion, source or raw model output was repaired.

The first Phi/Qwen2.5 runs precede the guard correction; subsequent candidates use it. Their documented failures are unrelated to the corrected vocabulary. Model metadata for those first two runs was read from installed manifests immediately afterward; subsequent runs log it before inference.

## Bounded Gemma thinking diagnostic

Gemma's baseline resolves several difficult facts correctly but still confuses willingness with commitment. Its [official package documentation](https://ollama.com/library/gemma4:12b) and [Ollama thinking API](https://docs.ollama.com/capabilities/thinking) support a separate thinking profile. Test the six-turn case once at seed 41 before deciding whether to expand. Set `MEETING_NOTES_RECONCILIATION_THINKING=1`: thinking enabled, output budget 8,192 and caller deadline 600 seconds. Keep the prompt, source, context, temperature, inherited sampling and semantic assertions unchanged. This changes thinking and its resource allowance together, so it is a profile comparison, not an isolated thinking-only measurement. Raw scoring uses final content only, never hidden reasoning. No production setting is changed.

**Result:** The single six-turn diagnostic timed out after 600,042 ms without returning a completed final response. No semantic score is inferred from that timeout. It does not justify a larger run or promotion.

## Decision and remaining boundary

Do not switch the default or integrate the source-only stage on this evidence. Nine baseline attempts across three alternatives passed zero unchanged gates, but that count must not be misreported as nine equally severe semantic failures: two Gemma cases have substantive defects, while its holdout is correct on action ownership/modality and fails a grounded non-assignment decision boundary. Phi's conditional case has a similar taxonomy caveat. Gemma's separate thinking profile failed operationally. No candidate qualifies for the planned 30-case/seed expansion.

The bounded comparison is complete. It does **not** establish that every local model or sampling configuration is incapable. Ministral was shortlisted but not downloaded/tested; adding another package is not necessary to substantiate the conclusion about these tested profiles. The useful next discriminator is a stronger independent hosted-model baseline on the same synthetic sources, with a pre-agreed treatment of grounded non-assignment decisions. That requires a configured provider key and a separate bounded comparison; no key is available here, no account login was repurposed, and no cloud request was made. Do not request secrets in chat. A stronger baseline would test whether the prompt/contract is adequate before adding pipeline stages; it is not a production recommendation in advance.

The only added local package is `gemma4:12b` (approximately 7.6 GB). Existing Phi and Qwen2.5 packages were reused. The user's app was neither stopped nor restarted; unrelated main-checkout edits were preserved. The shared local Ollama runner loaded test models during inference, but no persisted model setting or meeting was changed.

Verification: 228 unit/DOM files, 2,283 tests passed; typecheck, scoped Biome and diff checks passed; 142 changelog fragments validated. Both spec and independent code-quality reviews approved the bounded condition-vocabulary correction and harness changes. All nine raw response hashes were verified. Electron SQLite ABI 143 was restored and verified in memory. Ordinary manual-test invocation skips all 30 provider cases unless explicitly opted in. No final-composition, long-source or rendered-app acceptance is claimed.

## Reproduction

Run from this worktree, with an already-installed candidate and the local Ollama server. These commands are opt-in and use synthetic data only:

```sh
OLLAMA_BENCHMARK_MODEL=gemma4:12b MEETING_NOTES_ACCEPTANCE_SEED=41 \
RUN_MEETING_NOTES_PROVIDER_BENCHMARK=1 pnpm exec vitest run \
  --disableConsoleIntercept --config vitest.manual.config.ts \
  tests/manual/meetingNotesReconciliationAcceptance.test.ts \
  -t 'conditional-promise|withdrawal and qualified|reassigned'

OLLAMA_BENCHMARK_MODEL=gemma4:12b MEETING_NOTES_RECONCILIATION_THINKING=1 \
MEETING_NOTES_ACCEPTANCE_SEED=41 RUN_MEETING_NOTES_PROVIDER_BENCHMARK=1 \
pnpm exec vitest run --disableConsoleIntercept --config vitest.manual.config.ts \
  tests/manual/meetingNotesReconciliationAcceptance.test.ts \
  -t 'withdrawal and qualified'
```

For a justified full acceptance run, omit both the test-name filter and `MEETING_NOTES_ACCEPTANCE_SEED` to test all ten cases across seeds 41/42/43. The stage adapter exposes every raw claim to the semantic scorer without filling owners or repairing text; it does not prove final note composition. Real-provider failure exit codes are expected evidence for rejected candidates, not permission to loosen checks.
