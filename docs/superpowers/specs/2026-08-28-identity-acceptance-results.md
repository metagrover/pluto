# Identity resolution local-model acceptance — 2026-08-28

Issue: #679. Status: **acceptance blocked; semantic accuracy not established**.

The opt-in suite uses neutral frozen source fixtures, the production owner resolver, its independent verification pass, and `UnifiedLLMProvider('ollama', { ollama_model: 'qwen3.5:9b' })` with `purpose: 'commitmentReconciliation'`. It does not import the database, read user meetings, create recordings, pull models, or use a cloud fallback.

Installed model: `qwen3.5:9b`, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`. Local Ollama reported version `0.33.1`.

## Production-path attempt

Fourteen cases are defined: bound first person, named assignee different from speaker, source self-introduction, imported Me, duplicate names, quotation, collective, ambiguous pronoun, conflicting corrections, mixed remote channel, request without acceptance, unique declared profile alias, shared profile alias, and validated local capture.

| Case | Expected owner | Observed result |
| --- | --- | --- |
| Bound first person | person-rowan | Capacity timeout after 90.0 seconds; no model JSON |
| Named assignee, not speaker | person-morgan | `notes_provider_error` after 13.0 seconds; no model JSON |
| Source self-introduction | person-rowan | Capacity timeout after 90.0 seconds; no model JSON |

The run was stopped during the fourth case after these repeated infrastructure failures. Remaining cases were not evaluated. There are **zero completed semantic judgments**, not a demonstrated zero wrong-person rate. Provider errors are not counted as abstentions or successful safety decisions. Preliminary intercepted-console runs were discarded; the results above came from direct console output.

## Controlled transport diagnostics

Identical 3,469-character production source prompt, local model, `think:false`, streaming, temperature zero, and production context/output budget. Each diagnostic had a 60-second deadline. These are diagnostic variants, not production acceptance results.

| Endpoint / format | First packet | Outcome |
| --- | --- | --- |
| Generate / full production JSON schema | None | HTTP 400 at 9.98 seconds: `Failed to initialize samplers: failed to parse grammar` |
| Chat / full production JSON schema | None | 60-second deadline |
| Generate / schema with min/max string and array bounds removed | None | 60-second deadline |
| Generate / `format: 'json'` | 58.3 seconds | Partial JSON began with resolved/person-rowan; deadline before completion |

The explicit grammar-init error establishes a real structured-generation failure. Switching to chat is not proven to fix it. The very late first packet also leaves runtime contention/capacity as a separate contributor. During a 4,096-context diagnostic, `/api/ps` reported a 7,168-context model. Later socket inspection confirmed another diagnostic process and the running Pluto Electron app had concurrent Ollama connections; a connection alone can be idle keep-alive and does not prove active contention. Those unrelated processes were not modified.

No service restart, model pull, or settings change was performed. The existing commitment semantic acceptance suite was not run because the same provider path remained unreliable.

## Isolated grammar root cause

A tiny structured request with a single string enum succeeded on the installed model in 14.03 seconds (13.50 seconds model load; six generated tokens). The runtime can perform basic structured generation. Subsequent live schema-subset checks timed out during concurrent app traffic and were stopped; these timeouts do not establish schema validity or failure.

The offending construct was then reproduced **offline**, without model requests, by converting minimal schemas using the upstream JSON-schema converter and parsing the resulting GBNF with the installed Ollama `libllama.0.3.0.dylib`. The installed library is x86_64, so the read-only parser check used the system Python under Rosetta.

| Schema construct | Installed parser result |
| --- | --- |
| Nullable string enum containing a supplied person ID and null | Parses |
| Nested evidence quote, `minLength: 1`, `maxLength: 500` | Parses |
| Same quote with `maxLength: 1000` or `1999` | Parses |
| Same quote with `maxLength: 2000` | Fails: repetition exceeds parser sanity limit |
| Same quote retaining `minLength: 1` and removing `maxLength` | Parses |

The active Ollama log was `server-1.log`, not the initially inspected rotated `server.log`. Filtered error lines confirm the actual production-generated grammar contains both `evidence-item-quote` and `identityEvidence-item-quote` rules with `char{1,2000}`, immediately followed by the same repetition-limit error and sampler-init failure. This connects the offline reproducer to the observed HTTP 400. The finding matches upstream [llama.cpp issue #25746](https://github.com/ggml-org/llama.cpp/issues/25746) and the repetition guard in the [grammar parser](https://github.com/ggml-org/llama.cpp/blob/master/src/llama-grammar.cpp).

Recommended repair: normalize unsupported large `maxLength` constraints only in the Ollama wire schema. Preserve minimum lengths, enums, the caller's original schema, and the resolver's strict post-generation quote-length and source validation. This fixes grammar compatibility; it does not establish semantic accuracy or eliminate independent model-queue contention. The parent implementation owns the regression test and production fix.

## Post-fix production latency smoke

After the wire-schema fix, bound first person and named assignee each failed with the production 90-second capacity deadline (90.018 and 90.006 seconds). The run was stopped after these two failures; no completed semantic judgments resulted.

Sanitized server metrics establish active generation rather than merely an idle socket: an earlier request generated 4,096 tokens in 208.9 seconds and completed at 16:41:54. A new single-slot runner started at 16:41:58 with a 7,168-token context and 2,006-token prompt, before this benchmark started at 16:42:07. It continued generating at approximately 19.7 tokens/second while the benchmark waited. Caller attribution was not inspected. The runner used approximately 6.2 GB resident memory and the system reported 20% memory free; these measurements do not show stalled token throughput or prove memory pressure caused the delays.

## Extended-capacity semantic evaluation

The separate `IDENTITY_ACCEPTANCE_EXTENDED_CAPACITY=1` mode keeps the production resolver, source prompts, exported wire-schema adapter, strict output parser, model, streaming completion checks, context/output budgets, temperature zero, eight threads, `think:false`, and one-hour keep-alive. It uses direct local HTTP with the production progress-aware deadline helper, extending only capacity wait from 90 to 300 seconds per generation. Idle and active-generation limits remain unchanged. A case is additionally bounded to 660 seconds for the proposal and verification calls. This is real-model semantic evaluation, **not a passing production-latency acceptance result**.

Initial prompt revision produced two completed proposal responses, both rejected by strict source validation:

| Case | Proposal prompt SHA-256 | Timing | Observed model failure |
| --- | --- | --- | --- |
| Bound first person | `b41ae2f7d6265130e53c5dcad1591cfd0e61e44e370036418937a65cb8712557` | First packet 138.7s; complete 149.9s | Chose person-rowan, but included `identityEvidence: [{turnId: "t0", quote: "Speaker 1"}]`; the speaker label is not in source text |
| Named assignee, not speaker | `517574e63a69da43f73fdcd29d9f1b629a15aabeab3deef4719908ecc07b64f1` | First packet 75.7s; complete 87.6s | Returned unresolved/collective, incorrectly requiring the named assignee to match the speaking person's binding; also fabricated the same speaker-label quote |

Both calls failed with `Invalid identity resolution: foreign source turn or unsupported quote`. Neither reached independent verification or emitted a wrong owner. They are output-validity/semantic failures, not successful abstentions. The run was stopped after case two for one focused prompt clarification; these results are retained rather than replaced by the rerun.

A quote-only intermediate revision (`91f14ecf47466531254538c2cb0845b7f18c7fdcb82308ded91ce7704bfb2af3`) produced a correct first proposal with empty identity evidence in 29.7 seconds. That run was interrupted before a final verified resolution while the named-assignment clarification was being added; it is not counted as a successful case. The final evaluation uses one frozen revision containing both clarifications.

### Frozen final revision

The final revision was frozen before evaluation. Five cases started before the run met its sustained-capacity stop criterion; nine were not evaluated. There were zero successful final resolutions, zero emitted wrong-person owners, two semantic false negatives, and three infrastructure errors. Zero emitted wrong-person owners is not a demonstrated wrong-person rate because no case completed successfully.

| Case | Proposal prompt SHA-256 | Final outcome |
| --- | --- | --- |
| Bound first person | `bf1c8d547ad220ec6755b22375eef9d4d9144b1c571540f1a6f34564e7f87184` | Semantic failure: selected person-rowan but misclassified the first-person promise as `named_assignment`; resolver safely returned unresolved (`No source identity evidence`) |
| Named assignee, not speaker | `629bd5c7e444092fb2c3d99c06e03c3fae7f7dc0af3f7c27999a9014b2d220de` | Semantic failure: emitted `named_assignment` but unresolved/null and continued to require assignee Morgan to match the speaking person's Rowan binding; safe false negative |
| Source self-introduction | `5b03dcbe9d8939b9cb940b0e0d3c199874da1147d4b3cba3ac084aa5adaf952a` | Proposal correctly selected person-rowan with exact obligation and self-introduction evidence; independent verifier received no packet within 300 seconds, so final result is an infrastructure error, not a pass |
| Imported Me | `516bd98d4738358cae1e1475e3f4078f509ff14d94a75e5dae2d7e326735898e` | Proposal received no packet within 300 seconds; infrastructure error |
| Duplicate display names | `baabdb8bccddf0ddfb4a9b10f204feb206ea315836f47b5ac73ff965b597f934` | Proposal received no packet within 300 seconds; infrastructure error |

Quotation, collective, ambiguous pronoun, conflicting corrections, mixed remote channel, request without acceptance, unique alias, shared alias, and validated capture were not evaluated due sustained queue capacity. The run stopped immediately after the third consecutive no-packet capacity failure; the next quotation request had only begun and was cancelled before producing evidence. The commitment semantic acceptance suite was not run because the identity run never achieved stable model capacity.

## Reproduction

```sh
RUN_IDENTITY_RESOLUTION_ACCEPTANCE=1 pnpm exec vitest run \
  --config vitest.manual.config.ts tests/manual/identityResolutionAcceptance.test.ts \
  --cache=false --pool=forks --maxWorkers=1 --disableConsoleIntercept --reporter=verbose

RUN_IDENTITY_TRANSPORT_DIAGNOSTIC=1 pnpm exec vitest run \
  --config vitest.manual.config.ts tests/manual/identityResolutionAcceptance.test.ts \
  --cache=false --pool=forks --maxWorkers=1 --disableConsoleIntercept --reporter=verbose

RUN_IDENTITY_RESOLUTION_ACCEPTANCE=1 IDENTITY_ACCEPTANCE_EXTENDED_CAPACITY=1 \
  pnpm exec vitest run --config vitest.manual.config.ts \
  tests/manual/identityResolutionAcceptance.test.ts \
  --cache=false --pool=forks --maxWorkers=1 --disableConsoleIntercept --reporter=verbose
```

Diagnostic-only `IDENTITY_DIAGNOSTIC_SCHEMA=json` or `unbounded` selects the alternative wire formats. `-t generate` limits the diagnostic to that endpoint. The production acceptance always retains its original schema and strict resolver parser.

Next gate: land the regression-tested wire-schema fix, obtain a completed controlled structured response with a quiet local-model queue, then rerun all twelve semantic cases. Do not ship a semantic-accuracy claim based on schema validity, partial JSON, or deterministic unit tests alone.
