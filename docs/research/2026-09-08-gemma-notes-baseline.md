# Gemma notes development baseline: resource-stopped, not acceptance

The owner redirected work from experimental Phi notes to the production Gemma
provider and model-neutral harness. The same private latest-ten source export was
used without re-querying, replacing, or writing production meetings. Existing
notes/settings and user notes/entity hints were not imported. The source-only
comparison used the actual compact writer/editor provider path, 16K context and
production optional-review budget; it was not an application publication run.

## Recorded outcomes

| Case index, newest first | Outcome | Physical requests |
| --- | --- | ---: |
| 1–2 | Source ineligible; retained in denominator | 0 |
| 3 | Accepted in replay with guarded fallback warnings | 2 |
| 4 | Rejected by missing-action guardrail | 2 |
| 5 | Accepted in replay with warnings | 2 |
| 6 | Interrupted by operator safety stop | 1, censored |
| 7–10 | Not started | 0 |

The three completed eligible cases took 309.884, 346.967 and 110.408 seconds.
These are diagnostic elapsed times, not isolated or statistically comparable
performance results. They include model residency changes and shared-host load.

System swap was 3107.88 MiB initially, 4226.50 MiB after case 3, 6579.19 MiB
after case 4 and 8725.44 MiB after case 5; a subsequent observation reached
9100.94 MiB. The owned replay process was terminated for safety during case 6.
The original ledger and partial response remain intact, with a separate operator
stop record; no successful terminal was fabricated. The shared model daemon and
production application were not killed. System-wide swap growth does not isolate
causation to Gemma. It does invalidate a clean resource/performance claim.

## What the evidence supports

Gemma produced readable synthesis for case 3, a source that Phi's candidate
rejected at preflight. This is a positive feasibility result, not quality approval.
Assistant review found important qualifications/coordination details missing and
an overstated role description. The retained writer/editor responses show that
guarded fallback removed proposed commitments rather than solving all semantics.
Case 5 was readable but omitted a qualified follow-up scheduling statement.
Neither output has blinded human approval or a frozen-gold completeness score.

The first three completed eligible outcomes, including the rejection, were
reproduced from exact captured request/response artifacts with zero new model
requests. Serialized accepted results matched, ignoring only generation time.
An initial replay comparison incorrectly treated an in-memory undefined property
as a difference from persisted JSON; comparison now uses serialized semantics.
This was a harness diagnostic, not another model attempt.

## Harness improvements and next gate

- Exact private request and streamed response retention, including failures.
- Wire model/context assertions and explicit headers versus terminal events.
- Durable scheduled/started/terminal reconciliation, with unstarted and censored
  cases preserved; partial final ledger appends are disclosed.
- Model-neutral visible-provenance and literal-citation triage; transcript-dump
  and pipeline-warning flags. No automatic quality approval.
- An automatic five-second resource guard added after this run: stop on >512 MiB
  swap growth, <10% reported memory headroom, thermal/performance warnings or lost
  telemetry. Graceful operator cancellation is also implemented.

Do not resume the interrupted model attempt invisibly or erase this run. Completing
the baseline requires a separately identified attempt in a quieter resource window,
with the new guard active. No Phi-specific tuning or Gemma production prompt/routing
changes were made. The next pipeline changes should be driven by the captured
Gemma failure cases, not by another model-selection exercise.
