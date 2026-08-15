# Evidence-grounded meeting analysis implementation plan

**Issue:** [#594](https://github.com/metagrover/pluto/issues/594)
**Design:** `docs/superpowers/specs/2026-08-14-evidence-grounded-meeting-analysis-design.md`

1. Add RED tests for evidence resolution, unsupported settled-item removal, and unsupported-field clearing.
2. Implement one pure grounding boundary and rebuild rollups from grounded topic arrays.
3. Add one shared extraction taxonomy to single-pass, per-topic, and repair prompts.
4. Add explicit Ollama structured-thinking and deterministic-seed capabilities with generation provenance.
5. Replace the fixture-only benchmark command with a real-provider, repeated, content-free quality gate.
6. Run Phi and Qwen under identical production configuration and record aggregate evidence.
7. Verify the full post-meeting pipeline, document the decision, and land the issue-scoped change.
