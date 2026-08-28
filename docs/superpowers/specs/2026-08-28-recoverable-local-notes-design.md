# Recoverable local meeting-note quality

Approved by the user after the Gemma-only real-meeting evaluation. Issue #674 / PR #676.

## Product contract

Use Gemma 4 12B for local meeting notes. Deliver useful complete notes despite ordinary quality misses. Review remains corrective, with the existing single repair; it is no longer an all-or-nothing semantic release gate. Questionable commitments are excluded from confirmed task/decision records. Broken contracts, invalid or out-of-scope source references, cancellation, provider failures and capacity bounds remain hard failures.

## Implementation boundary

Only the production local writer/audit route becomes advisory after its existing correction attempt. Hosted providers and the opt-in editor prototype retain their current behavior. Writer and review parsing, exact source validation, and publication ownership remain intact. No additional model calls, model downloads, prompt rewrites, production regeneration, or user-data migration.

The second audit response is still parsed and structurally validated in full. Only recognized semantic diagnostics may recover. Invalid commitments are removed, not silently reworded into facts or confirmed by bypassing checks. Source-detected conflicting actions and missing prerequisites cannot remain confirmed tasks. Missing content and merge-conservation quality misses become recorded warnings, not fabricated replacements. The rest of the valid reviewed document proceeds through remaining sections and merges; a partial section is never published as a full meeting.

Warnings must survive later successful merges and be visible in persisted quality metadata. Use a distinct completed-with-warnings review status. Do not mark these results as the legacy failed fallback or show a new UI banner. Keep source provenance, current edits, history, publication races and secondary sequencing unchanged.

Local note model selection and the meeting-run fingerprint use one shared Gemma constant. General chat/secondary model settings and hosted-provider settings remain unchanged. An unavailable Gemma must fail normally rather than silently select a different model. Bump the production note policy identity so old published results are not reused under the new behavior.

## Verification and release bar

Use test-first unit/integration coverage and existing saved model responses. Cover valid quality-warning publication, excluded questionable commitments, all hard-failure boundaries, warning aggregation through hierarchy, and local/hosted/non-note model routing. Retain historical strict results unchanged. Private captured real runs ended at partial sections; replay may demonstrate continuation beyond those failures but cannot establish newly completed real-meeting quality.

Run normal code, packaging and native-runtime checks. Smaller fidelity misses are follow-up improvements, not blockers. No further design approval or model comparison round is needed for this approved scope.
