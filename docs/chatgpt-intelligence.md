# Use your ChatGPT plan for Pluto intelligence

During first-run setup, choose **Ollama**, **ChatGPT**, or **OpenRouter** after recording permissions.
For ChatGPT, review the text-context disclosure and choose **Sign in with ChatGPT**.
Complete sign-in and authorize plan usage in your browser, then return to Pluto.
A one-time confirmation explains plan usage and links to ChatGPT settings. Pluto saves your choice
and protected connection, skips this question on future launches, and refreshes
access automatically. An expired or revoked renewable session may require sign-in
again; it does not reset your provider choice.

Existing users keep their current provider after updating. To search your saved
meeting notes from ChatGPT Desktop or Claude Desktop, open **Settings →
Connections** and grant note access to the app you want to use.

Use **Settings → Intelligence** whenever you want to change providers or manage
the connection. Choosing ChatGPT here previews setup without changing your active
provider; successful connection and saved text-sharing consent activate it. Pluto lists the models available to that account;
use the automatic default, or change it under **Advanced settings**. New connections default to GPT-5.6 Terra
when available; an existing available model choice is preserved. GPT-6.1 Sol stays
available as an option for more detailed output. If Terra is unavailable, initial
selection prefers available Sol, then the first account model. Corrected saved
comparisons found Terra retained the reviewed follow-ups with lower token usage;
this limited sample does not establish accuracy across every workflow. An eligible
ChatGPT Plus or Pro account is required. Availability also depends on OpenAI's workspace and preview policies.

ChatGPT powers meeting notes, Ask Pluto (including live
meeting questions), preparation, entity extraction, commitment reconciliation,
knowledge documents, and background People/Project synthesis. Requests consume
the connected account's plan allowance. **Manage usage** opens ChatGPT's usage
settings. A usage-limit failure pauses new ChatGPT inference until you explicitly
choose **Try again**. Pluto never silently changes providers or billing.

### Usage protection

Settings → Intelligence shows today’s request count and a **Manage usage** link.
**Advanced settings** contains model selection, daily request/token limits, reported
input/output tokens by task and model, and avoided duplicates. These are local Pluto measurements,
not the remaining ChatGPT quota or a conversion to plan credits. Counting begins
with this version; prior requests cannot be reconstructed.

The default daily limits are 50 provider requests and a 200,000-token admission
budget. These are not counts of meetings or answers: each may need several
requests for extraction, scope resolution, or source checks. Saved representative
usage approached the token budget before 50 requests, so raising the request cap
to 100 would provide misleading headroom. Terra remains preferred from the saved
quality/usage comparisons; this is a conservative starting policy, not a guarantee
that every user’s workload fits.
Before dispatch Pluto durably counts the attempt and reserves estimated input plus
at least 8,192 output tokens. Completed responses replace that estimate with the
provider's reported input/output usage. Failed, interrupted, or unmeasured requests
retain their reservation, including after restart. Counters reset at local midnight;
30 days of content-free aggregates stay in the profile. Changing model, signing out,
or reconnecting does not reset the limits. These controls cover this Pluto profile;
other apps and profiles can share the same upstream plan allowance.

SIWC does not accept `max_output_tokens`. An in-flight response can exceed its
reservation, so this is a limit on admitting new requests, not a hard ceiling on
tokens charged by OpenAI. Increase limits explicitly in Settings when needed.
The UI links to ChatGPT's usage settings for the authoritative plan/app limits.

Automatic People and Project updates are **on for new connections**, limited to
10 background requests and a 40,000-token admission budget within the default
50-request/200,000-token daily totals. Background work is limited to 20% of both
configured daily budgets (and at most 10 requests). Its reservation includes failed
and interrupted calls; completed calls replace estimates with reported usage. One
running response can exceed its reservation; later background requests then wait.
Existing limits, pauses, and explicit background opt-outs are preserved. The toggle
saves immediately; advanced limit changes require **Save usage protection**. Notes, meeting extraction, and explicit user requests still run under
the overall limits. Explicit People/Project document refreshes are treated as user
requests. Paused background work remains queued; no provider is silently substituted.
An upstream usage-limit pause is durable and requires an explicit retry.

ChatGPT requests run one at a time, prioritizing interactive work without cancelling
paid background work just to restart it. Exact concurrent requests share one upstream
call; individual callers can cancel independently. Successful extraction/background
results can be reused in memory for ten minutes (at most 64 results of 256,000
characters each), keyed by account session, model, task, source context, and schema.
Source/model/account changes invalidate reuse; signing out clears it. Chat and
explicit note rewrites are never served from this response cache.
ChatGPT answers use the complete retrieved context rather than an assignment-only
or temporal extract, so a multi-part question reaches the answer model once.
Existing automatic notes publication and knowledge-document revision checks remain authoritative across
restarts. Switching to ChatGPT, changing its model, or updating its prompts does
not automatically rewrite existing published notes or backfill their extraction.
Use explicit regeneration to apply the new configuration to an older meeting.
Restarting does not automatically retry failed cloud meeting extraction; use an
explicit retry. Ollama keeps its existing startup recovery.
Changed source or user notes still trigger normal processing. No prompts,
responses, meeting IDs, credentials, or request fingerprints
are stored in the usage ledger.

Cloud notes use one finalized full-transcript writer request with local source
checks, rather than Ollama's 16,384-token chunk planning. Pluto uses a conservative
131,072-token application context budget for ChatGPT, including output headroom;
this is not the model's advertised maximum. Cloud notes do not precompute partial
transcript leaves. Exceeding the budget or receiving a context rejection stops
that attempt instead of creating paid leaf/merge requests. The usage admission
budget still applies independently. People/Project synthesis likewise sends the
selected evidence (up to 80 meetings) together, keeps existing evidence selection
and citation checks, and does not retry failures as progressively smaller chunks.
Actions, decisions and items held for source review receive one bounded semantic
check against their exact cited passages before canonical projection. It resolves
acceptance, owners, timing and scope, retaining material tentative context as
discussion. It batches at most 16 items, with up to 12,000 characters of case data for
Ollama or 48,000 for ChatGPT, has a 90-second deadline, and leaves time to
publish the conservative notes. It never
splits an oversized batch or retries a failed check. This counts as `notesAudit`
under the same usage limits; an identical completed response can be reused for
ten minutes. Blocked admission or failure keeps useful conservative notes with a
review warning. Ollama runs this check locally on the product's single-writer
path; its older two-stage callers keep their existing audit. Ordinary discussion
needs no additional request. No historical paid review or migration is introduced.
Cloud note items may cite up to 36 exact source fragments, accommodating speech
split across short canonical segments; the local-model default remains three.
Source validity, grounding, and ownership checks still apply. If an action or
decision classification cannot be supported, Pluto preserves its cited source
excerpts as discussion without inventing an owner, deadline, or settled choice.
Adjacent canonical fragments can support a colloquial first-person commitment;
source gaps and ambiguous speakers are not joined. Invalid cloud drafts
stop after one writer attempt rather than triggering an automatic paid repair.
Ollama retains its existing bounded chunking behavior.

For ChatGPT, a fresh Ask Pluto question first resolves its scope from meeting
titles and recording times, without sending transcripts for that step. A specific
meeting restricts the answer's evidence to that meeting. Ambiguous or unmatched
references ask for clarification instead of widening the search. Complete scope
catalogs are bounded to 800 headers and 64,000 characters; oversized catalogs stop
locally. Scope and answer each require usage admission. Identical scope requests
reuse the existing short-lived cache. Ollama keeps its existing local routing.

Recording, audio files, transcription, speaker processing, retrieval, source
provenance, and durable meeting storage remain local. Relevant transcript text,
notes, questions, and context are sent to OpenAI for intelligence, including
background synthesis. ChatGPT sign-in does not grant Pluto access to your ChatGPT
conversations or memories. This provider is separate from the ChatGPT plugin that
lets ChatGPT read Pluto's meeting notes.

Use **Sign out** to revoke the renewable session and clear its tokens locally.
If remote revocation cannot be confirmed, Pluto says so; disconnect the app in
ChatGPT settings. The registered account identity and installation host ID remain
available for reauthorization. This initial integration supports one connected
account/workspace per Pluto profile.

## Implementation and verification

- OAuth Authorization Code with PKCE, state, nonce, a `127.0.0.1` callback, dynamic
  client registration, and RS256 ID-token verification against OpenAI's JWKS.
- The issued client ID is retained with the verified subject. Tokens are encrypted
  using Electron's secure storage and written atomically by the existing secure
  settings backend. Tokens never enter the renderer, ordinary settings IPC,
  diagnostic output, or repository files.
- Refreshes are serialized and rotating token sets replaced together. Terminal
  refresh failures clear unusable tokens; transient failures retain credentials.
- Inference uses `POST https://api.openai.com/v1/responses`, `store: false`,
  `stream: true`, account model discovery, developer instructions, and explicitly
  supplied text history. Unsupported sampling/output-limit fields are omitted.
- Partial, failed, refused, or incomplete responses cannot become completed notes
  or answers. The existing local grounding and provenance checks still run.

Focused tests cover OAuth validation, protected storage, refresh and revocation,
stream parsing and failure handling, provider routing, notes provenance, and
settings interactions. Live account eligibility, plan charging, model behavior,
and a complete browser sign-in require an interactive acceptance run with a real
eligible account; mocked tests do not establish those properties.

Official contracts checked October 15, 2026:
[sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
