### Publish safe local notes and announce them truthfully

- **Issue:** [#776](https://github.com/metagrover/pluto/issues/776)
- **PR:** [#777](https://github.com/metagrover/pluto/pull/777)
- **Changed:** A direct compact writer retries one truncated response with the bounded concise contract. When the complete-document editor for a compact Ollama run truncates or returns an allowed schema or guardrail validation failure, Pluto can publish the writer draft only after deterministic acceptance. The native “Meeting notes ready” notification is emitted only after durable publication, and terminal metrics are best-effort so metric persistence failures cannot replace the run outcome.
- **Why:** A bounded local run could otherwise discard a deterministically safe writer draft after the editor exceeded its output budget or failed an allowed validation category. Readiness notifications also shared the generic progress callback, while terminal metric persistence could obscure the actual publication or cancellation result.
- **Trust:** Invalid source references, inherited-commitment violations, unsafe writer drafts, transport failures, cancellation, and stale publication still fail closed. Recovered drafts carry an explicit warning rather than claiming a clean model audit.
- **Replaced:** Immediate compact-writer truncation failure, terminal failure after an otherwise deterministically accepted writer result, native readiness notifications on non-terminal progress updates, and metric failures overriding terminal outcomes.
- **Notes:** The renderer continues receiving all meeting-note progress updates; only the native operating-system notification moved to the durable publication boundary.
