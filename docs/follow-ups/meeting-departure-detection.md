# Follow-up: detect departure while a meeting tab remains open

Status: planned, not implemented by PR #857.

Origin: [review feedback on PR #857](https://github.com/metagrover/pluto/pull/857#issuecomment-6079277228).

PR #857 removes silence-driven stopping and scopes closure checks to the locked browser or desktop app. It does not establish whether the user has left a meeting whose tab remains open. Its source identity is the browser application, not an individual tab: if another supported meeting tab remains in that browser, the state stays inconclusive. Do not treat the broader departure-detection work as complete when merging that PR.

## Required behavior

- Add optional, explicitly enabled Chrome Accessibility inspection of joined/left controls. Keep the existing browser Automation setting distinct from Accessibility consent. Missing permission, failed inspection, unsupported controls, and ambiguous state mean unknown; never equate them with departure or request permission during background polling.
- Bind joined/left evidence to the locked call source. Resolve individual tab/session identity where multiple meeting tabs coexist, without storing raw URLs, window text, or meeting content in diagnostics.
- Require two consecutive positive departure confirmations for Chrome or Zoom before ending. Resumed/joined evidence, unknown observations, and inspection failures reset the confirmation count. Confirmations must refer to the same recording and source; reset them on stop, restart, source changes, or disabling auto-end.
- When state remains unknown after about two quiet minutes, show one “Still in the meeting?” check-in per recording. Keep recording dismisses it without stopping; End meeting uses the shared stop/finalization path; no response continues recording. Silence alone must never stop recording, including beyond the scheduled calendar end.
- Persist the stop evidence in the end reason: distinguish confirmed Chrome departure, confirmed Zoom departure, and the user's explicit End meeting choice. Preserve captured audio, transcripts, journal sealing, and normal finalization.

## Acceptance coverage

1. Leave a Meet call with its tab still open; verify two joined/left observations end the correct recording. Verify muted calls and quiet breaks do not.
2. Exercise single false observations, joined/unknown interleaving, revoked Accessibility or Automation permission, unsupported control layouts, browser inspection errors, and Zoom helper restarts.
3. Exercise multiple browsers, multiple meeting tabs in the same browser, and idle or active unrelated Teams/Slack/Zoom apps. Other sources must neither cause nor suppress the locked call's departure decision.
4. Advance timers across the quiet threshold and calendar boundary. Verify exactly one check-in, each action, no response, resumed speech, recording changes, and cleanup on unmount. Verify disabling auto-end suppresses automatic stopping and its check-in.
5. Verify saved end reasons and the shared journal-sealing/finalization path for every stopping outcome.
6. Complete live macOS Chrome and Zoom acceptance with permissions enabled and denied, including a real break and leaving while the app/tab stays open. Mocked tests alone do not establish platform detection accuracy.
