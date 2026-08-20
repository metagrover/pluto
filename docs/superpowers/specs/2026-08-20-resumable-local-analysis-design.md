# Resumable local meeting analysis

Issue: #647

## Outcome

Long local meeting analysis completes from bounded, cancellable work rather
than timing out as one opaque request and racing its own retries.

## Root cause

The renderer applies a five-minute deadline to the entire multi-pass analysis
workflow. When it expires, its abort signal does not reach Electron's IPC
handler or the Ollama request. The renderer records failure while the original
generation continues. The automatic processor then sees the failed meeting as
eligible and starts another attempt against the same single local-model slot.

## Approved minimal architecture

`downstream_processing_json` becomes a versioned analysis-job record for the
analysis stage. It records only content-free operational state:

- run ID and attempt ID
- transcript validation identity
- current stage and window index
- completed-window count
- attempt start/deadline timestamps
- terminal failure category

The canonical transcript remains unchanged. Generated notes are committed only
after all analysis windows and the final editorial pass have completed for the
current run.

```text
claim run
  -> analyze window N
  -> persist checkpoint N
  -> analyze window N + 1
  -> final editorial pass
  -> persist analysis
  -> downstream knowledge work
  -> complete

timeout or user cancellation
  -> cancel current Ollama request
  -> wait for cancellation acknowledgement
  -> persist retryable terminal state
  -> no automatic retry of that state
```

## Cancellation contract

1. The renderer passes the downstream run ID with every analysis request.
2. Electron owns an `AbortController` for that run and exposes a cancellation
   IPC that targets only the matching active run.
3. The provider receives the controller signal. Ollama HTTP requests already
   support `RequestInit.signal`; the provider passes the signal through.
4. The serialized local-model gate checks the signal before a queued task
   begins and rejects cancelled queued work without calling Ollama.
5. A timeout requests cancellation, then persists the terminal outcome only
   after the run is no longer active. A newer claim is rejected while the
   previous run remains active.

## Budget and checkpoints

- Each Ollama generation has a short, cancellable request timeout.
- The overall job budget is derived from the number of analysis windows, with
  a conservative cap.
- Completion of each transcript window is a durable checkpoint. A restart or
  manual retry resumes at the next unfinished window.
- The first implementation checkpoints window completion and uses a final
  editorial pass. It does not checkpoint individual topic prompts within a
  window; those are retried by resuming that window.

## Retry policy

- Background processing claims only new or interrupted processing jobs whose
  active run is absent. It never automatically claims a terminal failed job.
- A manual retry starts a new run only after the previous run has cancelled or
  reached a terminal state.
- A terminal failure stores one named, content-free category: request timeout,
  cancellation, provider unavailable, malformed response, or persistence
  conflict.

## User experience

- Active work shows the current window progress, such as `Preparing analysis,
  part 2 of 5`, with an enabled Cancel action.
- Terminal failure says the analysis could not complete and exposes `Retry
  analysis`. It does not show a permanently disabled retry control.
- Existing notes, transcripts, and user edits remain readable throughout.

## Tests

- unit tests for job-record parsing, claiming, cancellation, and terminal
  retry eligibility
- provider/gate tests proving a cancelled queued task never calls Ollama
- downstream worker tests for window checkpointing, resume, timeout, and
  claim conflict
- DOM tests for active progress, cancel, terminal failure, and manual retry
- a content-free integration fixture with a multi-window synthetic transcript

## Non-goals

- Change transcription, canonical evidence, or analysis quality policy.
- Persist transcript text, prompts, or model output as diagnostic telemetry.
- Generalize every background task into a shared scheduler in this issue.
