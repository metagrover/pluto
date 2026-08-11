# Background post-meeting processing design

Issue: #608

## Outcome

A validated meeting reaches a truthful terminal intelligence state even when the
Pluto window is hidden or occluded. Completed model output is persisted without
requiring the user to raise the window, and a stalled stage fails within a
bounded interval instead of presenting an active lease for thirty minutes.

## Root cause

The durable downstream lease is stored in SQLite, but the worker that advances
it runs in the renderer. Electron may throttle or suspend a background renderer.
In a content-free synthetic run, all Ollama requests completed while the meeting
remained in `processing`; raising the window let the renderer continuation save
the ready result immediately.

The existing provider timeout is request-local. It does not bound time spent
before a queued request starts, nor the complete multi-request stage. The lease
therefore looks healthy long after the useful deadline.

## Design

### Activity-scoped renderer execution

The renderer tells the main process when it starts and finishes a claimed
post-meeting run. The main process disables background throttling only while at
least one downstream run is active, then restores the default when the final run
ends. Reloading the renderer clears the activity set.

This keeps the current worker architecture narrowly intact while removing its
dependency on window visibility. It avoids permanently disabling throttling and
therefore preserves idle thermal behavior.

### Stage deadlines

Every downstream stage runs through a shared deadline helper. Analysis and
entity extraction receive short local-work budgets; knowledge synthesis receives
a larger but still finite budget. Deadline failures persist only a content-free
failure category and retain the source/run fencing already enforced by SQLite.

Late IPC results are ignored because the renderer has already moved the current
run to `failed`, and every later save still requires the same active run ID.

### Truthful meeting state

The meeting view parses `downstream_processing_json` separately from transcript
trust. A validated transcript can therefore show:

- analysis in progress, with the current stage;
- analysis stopped safely, with a retry action;
- analysis ready only when derived artifacts exist and the lease is complete.

The UI never labels transcript validation as analysis work and never labels a
meeting ready solely because it has a date or an ended recording.

## Verification

- Unit-test activity reference counting and deadline behavior.
- Unit-test downstream lifecycle parsing and copy.
- Exercise the real hidden-window flow with synthetic audio and content-free DB
  assertions.
- Run the full TypeScript suite, lint, changelog validation, dependency audit,
  and production builds.

## Privacy

Logs and persisted failure metadata contain stage, duration category, provider
metadata, and error category only. No transcript text, participant identity,
evidence quote, recording path, or meeting identifier is added to diagnostics.
