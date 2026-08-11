# Known-person transcription vocabulary design

## Outcome

Improve local recognition of relevant person names without rewriting transcript evidence or exposing private context outside Pluto.

## Policy

- Policy version: `known_person_v1`.
- Explicit participants are selected first in caller order.
- Remaining capacity is filled by known-person entities ordered deterministically by saliency, recency bucket, distinct meeting count, mention count, and normalized name.
- Selection is capped at 12 names and a 240-character MLX prompt.
- Names are Unicode-normalized, whitespace-collapsed, length-bounded, deduplicated case-insensitively, and limited to letters, marks, spaces, apostrophes, and hyphens.
- Empty or invalid context sends no prompt.
- One selection is resolved at recording start and reused for all live, checkpoint, repair, and final transcription requests in that meeting.

## Trust and privacy

- The prompt contains names only, never transcript, meeting, or knowledge prose.
- MLX receives the prompt locally as `initial_prompt`; no cloud service is involved.
- Production logs and persisted transcription metadata contain only `known_person_v1` and the selected hint count.
- The transcript remains ASR output. Pluto does not replace phonetically similar common words after recognition.

## Verification

- Pure selection tests cover participant priority, deterministic graph ranking, bounds, duplicates, punctuation, and empty context.
- TypeScript and Python transport tests prove the prompt reaches MLX while diagnostics remain content-free.
- Synthetic local audio compares a confusable synthetic name with and without the prompt, plus unrelated speech under the same prompt, before any quality claim is made.

