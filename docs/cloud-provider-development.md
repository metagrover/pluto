# Cloud provider development runbook

Cloud inference is optional. Pluto must remain fully usable with Ollama and no
cloud credential. Never put a credential, provider project identifier, private
transcript, or benchmark output containing meeting content in this repository.

## OpenAI development setup

1. In the OpenAI Platform, create a project used only for Pluto development and
   testing. Do not reuse a personal or production project.
2. Create a project-scoped API key with the smallest available permissions.
   Add only a small prepaid balance or project budget and configure a low budget
   alert.
3. Paste the key into Pluto Settings. Pluto stores it through Electron secure
   storage backed by macOS Keychain; it is not read from a checked-in config
   file. If secure storage is unavailable, credential writes and cloud
   execution fail closed.
4. Rotate the key after shared testing, suspected exposure, or a contributor
   handoff. Revoke the old key in the OpenAI project before deleting the local
   value.
5. Exercise meeting notes, commitments, people/profile updates, project updates,
   Meeting Q&A, and suggested questions. Confirm the Cloud badge and exact model
   are visible during every request.

OpenAI calls use the Responses API with `store: false`, bounded cancellation,
and structured output where the production contract supplies a schema.

## OpenRouter development setup

Use a separate, limited OpenRouter key and select an explicit model slug in
Settings. Pluto never silently chooses a free or paid OpenRouter model. Start
with a low-cost benchmark candidate, then run the same fixed fixtures against
the candidate production model. OpenRouter calls use the fixed
`https://openrouter.ai/api/v1/chat/completions` endpoint and Pluto attribution
headers.

## Consent and test-data rules

Selecting a cloud provider displays the versioned disclosure before Pluto saves
the selection. Returning to Local revokes that consent. An older selection with
no matching disclosure version cannot execute. Use only synthetic or explicitly
anonymized fixtures for shared benchmark runs, and keep live-provider runs
opt-in and outside normal CI.
