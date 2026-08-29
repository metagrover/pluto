# A little about you

Issue: #679. Approved by the user on 2026-08-28, including implementation, merge to master, and push. This supersedes the Settings-only self-selector restriction in the general identity specification.

## Experience

Add one skippable screen after recording readiness in first-run onboarding. Ask “What should Pluto call you?”, “What other names do people use for you?”, and optionally “What brings you to Pluto?” (work, study, personal, multiple selections). Role or field and industry accept free text with suggestions. Names appear as removable chips with a labelled add control. Everything is optional; a context-only profile is valid. Save failures retain input and do not masquerade as success. Skipping must finish onboarding without erasing an existing profile.

Reuse the same form in Settings under “About you”. Existing users receive a small dismissible invitation, not the onboarding wizard. Persist completion or dismissal so it does not recur on every launch. Keep meeting-specific speaker corrections unchanged. Use existing restrained typography, forms and tokens; no new artwork or global redesign.

## Data and trust

Persist the profile locally in this workspace, with preferred name, explicit alternate names, use cases, role/field, industry, and onboarding disposition. A preferred name creates or updates the currently selected stable self-person, not a new person on each save. Existing same-name people are not silently merged. Retain an advanced explicit existing-person selection and identity clearing control in Settings.

Store aliases by person ID, not in a global name map. Trim and deduplicate aliases case-insensitively, cap at 12 names of 200 characters, validate all payload fields and reject stale writes. Preferred name is at most 200 characters, role/industry at most 160; reject control characters. Profile and person/alias writes are atomic. A profile-only change must not invent speaker bindings or change capture-time self snapshots. Alias changes invalidate dependent cached identity results through the identity revision. Profile context must not enter identity prompts.

Expose declared aliases alongside each person candidate to the source-grounded resolver. A shared alias remains ambiguous: never return a person based on name overlap alone. Continue independent source verification and preserve raw transcript text. Profile context is collected only; terminology adaptation is a separately validated follow-up. Explain this honestly in UI copy. Do not claim profile data never leaves the device: configured providers may receive relevant names during identity analysis.

## Acceptance

Test profile save/update/clear, alias normalization and bounds, stale requests, workspace isolation, no duplicate person creation on repeat save, immutable capture snapshots, aliases reaching the resolver without role/industry, and same-name collision safety. Test onboarding save/skip/resume, returning-user dismissal, Settings edits, keyboard access, and failures. Use synthetic data for rendered QA. Finish all identity/semantic regression gates before merging; publish only this issue's changes, preserving unrelated local work.
