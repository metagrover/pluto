### Make Projects a selective, evidence-backed overview

- **Issue:** [#677](https://github.com/metagrover/pluto/issues/677)
- **PR:** Not created; local implementation.
- **Changed:** Projects distinguishes independent initiatives from tasks, topics, and uncertain context. Scope requires an outcome and multiple distinct work items with source quotations. Existing entries receive a bounded, resumable review without deleting evidence or merging identities. Dossiers show actual scope and source meetings, and task access remains available behind secondary disclosure.
- **Why:** Routine activities were being promoted into projects, overwhelming the overview and presenting unsupported status. Missing task links do not establish project completion.
- **Replaced:** Unfiltered extracted-project listing, task-count-derived completion, and permanent placeholder dossier content.
- **Notes:** Qualification is distinct from lifecycle. User-confirmed organization is retained, and parent grouping requires direct evidence. Ambiguous records remain accessible. No meetings, transcripts, or entity IDs are deleted.

Follow-up: scope review now honors queued cancellation, gets a turn ahead of resumable notes while Projects is open, and reviews one candidate per request to avoid oversized local-model batches. Chat retains higher priority; capture/finalization deferral is unchanged.

Response recovery: project review now constrains candidate/source IDs and response fields with a JSON schema and rejects incomplete output. Malformed candidates remain pending while other candidates progress; Retry revisits skipped records. The overview distinguishes incomplete review from active work. Source grounding, user corrections, and all saved records remain intact.

Unresolved-review recovery: source selection now considers bounded relevant excerpts across linked conversation history instead of only two recent snippets. Legacy uncertainty is reconsidered once under a versioned contract; unresolved and malformed attempts keep a specific reason, do not loop on reload or navigation, and remain explicitly retryable. In-flight review cannot overwrite concurrent entity or transcript corrections.

Provider recovery: project-scope review now allows up to three minutes for the first schema-constrained Ollama packet, below its five-minute caller cap. This covers buffered structured output without removing idle deadlines or turning timeouts into assessments.

Initiative discovery: Projects now reviews one validated source conversation at a time for a cohesive goal and at least two contributing actions. It creates a separate deterministic initiative only after exact full-transcript validation, links it to the source meeting, and records source-revision progress so reloads do not repeat completed work. Existing fragments are never renamed, merged, deleted, or automatically parented. Unsupported optional model evidence is discarded only when two independently grounded actions remain.
