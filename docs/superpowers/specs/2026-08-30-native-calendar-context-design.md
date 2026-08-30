# Native macOS Calendar context

Issue: [#617](https://github.com/metagrover/pluto/issues/617)

Status: Approved for implementation, including the dashboard shape confirmed on 2026-08-30.

## Outcome

Pluto can use one calendar already configured on the Mac to identify the meeting in progress and supply clearly attributed title, participant, and project context. Connecting is a native macOS permission flow. Pluto does not require a Google OAuth client, hosted callback, provider token, project domain, or calendar service.

The first release is macOS-only and read-only by product contract. It supports iCloud, Google/CalDAV, Exchange, local, and subscribed calendars exposed through EventKit. Direct Google OAuth, multiple selected calendars, calendar editing, scheduling, invitations, reminders, and generated pre-meeting briefs are outside this release.

## Product boundary

Dashboard is the primary day-to-day surface. Its existing right rail begins with
an `Upcoming meetings` section that shows exactly two timed events with compact
time, title, and duration rows. A text-only `See more` disclosure reveals the
remaining events for the day inline. The next event receives one quiet accent
marker; it does not become a feature card. `Recent win` moves beneath the agenda,
and the redundant `Continue where you left off` section is removed. The agenda
uses spacing and dividers instead of nested cards, attendee stacks, timelines, or
a new calendar destination.

The same bounded rail footprint handles first-run, loading, denied, empty, and
degraded states. First-run offers `Connect calendar`; denied access offers a
specific System Settings recovery action; empty days say the day is clear; and
stale data names when it was last read. Calendar failures never displace Today's
focus or block recording.

Settings contains one `Calendar context` section with these states:

- **Not connected:** Explain that Pluto reads a calendar already configured on this Mac. `Connect calendar` requests native access.
- **Permission denied or restricted:** Explain that recording still works and provide `Open System Settings` and `Try again` actions without repeatedly triggering the system prompt.
- **Permission granted, no usable calendars:** Explain that Pluto found no event calendar and provide an `Open Internet Accounts` action.
- **Calendar selection:** List event-capable calendars with calendar title and account/source title. The user chooses exactly one. Pluto does not silently select every calendar or imply that a CalDAV source is necessarily Google.
- **Active:** Show the selected calendar, `Last read from this Mac` time, current cache window, `Refresh`, `Change calendar`, and `Disconnect`.
- **Degraded:** Preserve the last successful local snapshot, show the finite reason, and offer the relevant recovery action. Recording remains available.

Apple exposes no read-only authorization level for reading events. The permission copy must therefore say that macOS grants full Calendar access while Pluto's integration only reads events and exposes no event mutation behavior. The native bridge contains no save, update, delete, invitation, or response command.

`Last read from this Mac` is intentionally not `Last synced with Google`. EventKit exposes the Mac's local event store; provider authentication, network state, and remote synchronization belong to macOS Calendar and are not facts Pluto can prove.

## Native architecture

Create a small Swift EventKit bridge as an embedded, background-only helper bundle. This follows Pluto's existing native-sidecar pattern without tying the integration to Electron's Node ABI.

The helper:

- is built from a focused Swift package with no third-party dependencies;
- carries its own stable Pluto calendar-helper bundle identifier, Calendar usage descriptions, and required signing/entitlement configuration;
- communicates with Electron main over a versioned JSON-lines protocol;
- retains one `EKEventStore` while it is running;
- emits a change notification when `EKEventStoreChanged` fires;
- returns only normalized, bounded data; and
- never writes to EventKit.

The allowlisted protocol has four request methods:

1. `authorization_status`
2. `request_access`
3. `list_calendars`
4. `list_events`

`list_events` requires one selected calendar identifier plus an ISO start and end. The helper rejects unbounded windows, invalid dates, excessive spans, unknown calendars, and unknown protocol methods. EventKit objects never cross the process boundary.

On macOS versions that support the newer API, the helper uses `requestFullAccessToEvents`. Where Pluto still supports an older macOS release, it uses the compatible legacy event-access request and matching usage-description key. Unsupported platforms and unavailable native runtimes return explicit capability states rather than pretending the integration is disconnected.

Electron main owns helper process lifecycle, validation, debouncing, persistence, and IPC authorization. The renderer cannot provide executable paths, arbitrary EventKit predicates, or native method names.

## Data minimization and persistence

Pluto reads a rolling window from 14 days before the current local time through 30 days after it. It stores only fields required for meeting context:

- selected calendar identifier, title, source title, and source type;
- a local event occurrence key derived from selected calendar, EventKit identifier, and occurrence start;
- event title;
- start and end;
- all-day and cancellation/availability state when EventKit exposes it;
- organizer display name and email when present;
- attendee display names and emails when present; and
- EventKit last-modified time when present.

Pluto does not read or persist event notes, descriptions, locations, URLs, attachments, alarms, conference links, recurrence rules, or provider credentials.

Use three focused SQLite records rather than adding calendar columns to `meetings`:

- a singleton integration record for permission-independent selection, enabled state, cache revision, last attempt, last successful read, and finite error code;
- bounded calendar-event occurrence rows for the selected calendar; and
- meeting-to-event context links containing match origin, match evidence, the calendar cache revision, and the minimal calendar snapshot shown for that meeting.

Each refresh is a transactional replacement of the selected calendar's bounded window. This naturally removes cancelled/deleted events that EventKit no longer returns and prevents stale recurrence instances. Event occurrence keys and a unique constraint make repeated refreshes idempotent. Selecting a different calendar clears the old event cache before publishing the new selection.

Refresh occurs after selection, at app startup when enabled, after a debounced native event-store change, on explicit user request, and periodically as a fallback while Pluto is running. Only one refresh may run at a time; a newer selection or disconnect invalidates an older in-flight result before it can publish.

Disconnect stops the helper, clears the selected-calendar state, cached occurrences, and meeting calendar-context links. A title the user explicitly accepted remains ordinary user-authored meeting data; Pluto retains no attendee or event snapshot after disconnect.

## Meeting association and trust

Calendar context never becomes transcript evidence. Every surfaced value carries `sourceKind: macos_calendar`, the selected calendar, the occurrence key, and the cache revision that produced it.

The deterministic matcher considers timed, non-cancelled events near a recording's start and end. It ranks candidates using actual time overlap, distance from event start, and duration compatibility. All-day events cannot auto-match. A unique candidate above the fixed threshold may be associated automatically. A tie, overlapping events, missing time, or a weak score remains unresolved and offers a small event chooser.

Association runs from the persisted local cache, never by blocking meeting save on EventKit or network state. It applies consistently to normal, recovery-required, and fallback meeting saves. User selection or removal of an event association is authoritative and is not overwritten by later refreshes.

Calendar context may:

- label the active recording with the matched event title;
- offer that title as a one-click meeting-name suggestion;
- show calendar participants as context; and
- suggest an existing project only when the event title contains one exact normalized canonical project name or confirmed alias.

It may not:

- overwrite a user-entered meeting title;
- create or merge person entities from attendee names or email addresses;
- treat calendar attendance as proof that someone spoke or made a commitment;
- create a project or project link from fuzzy wording;
- enter transcript citations or transcript-integrity records; or
- be sent to a model in this release.

Accepting a suggested title uses the existing user title update path and records that the user accepted a calendar suggestion. Participant and project suggestions remain visibly calendar-derived unless the user confirms them through their existing authoritative controls.

## Failure and recovery model

The integration has finite, user-facing states:

- `unsupported_platform`
- `runtime_missing`
- `not_determined`
- `denied`
- `restricted`
- `no_calendars`
- `selected_calendar_missing`
- `read_failed`
- `ready`

Permission denial never retries in a loop. A removed calendar preserves no false active status and asks the user to choose again. Malformed or oversized native responses fail closed and do not replace a good cache. Helper exit, timeout, or protocol failure records a retryable local read failure. Refresh errors preserve the last successful bounded snapshot with its timestamp; the UI never calls stale data current.

Offline provider state is not inferred from EventKit. If macOS returns cached events successfully, Pluto records a successful local read. If the event store fails, Pluto reports a local read failure without inventing a Google or iCloud diagnosis.

## Security and privacy

- Calendar access is requested only after the user presses `Connect calendar`.
- The purpose string states that Pluto reads meeting titles, times, and participants to identify recordings.
- The native helper is signed and bundled with Pluto; Electron resolves only its known packaged/development path.
- Renderer IPC accepts no native executable path or raw EventKit query.
- Native stdout is schema-validated and size-bounded before persistence.
- Logs contain status/error codes and counts, never event titles, attendee data, email addresses, or raw native payloads.
- Calendar content remains in Pluto's local SQLite database and is not included in model prompts, telemetry, or outbound requests in this release.
- Disconnect purges all retained event and attendee context.

## Implementation boundaries

Keep the bridge protocol and EventKit mapping in the native calendar package. Keep native-process supervision and validated types in focused Electron calendar modules. Keep cache and link persistence in focused database helpers while retaining schema migration ownership in `electron/db.ts`. Put deterministic matching and exact project-name suggestion logic in pure TypeScript modules. Put renderer calls behind a small typed calendar API rather than scattering raw IPC strings through Settings and meeting components.

The visible scope is limited to the compact Dashboard agenda described above,
the Settings calendar section, a compact active-recording calendar label/chooser,
and a calendar-context block in Meeting View. It does not otherwise redesign
Settings, recording, Meeting View, Dashboard, or Projects.

## Test and acceptance plan

All non-UI behavior follows test-first development.

### Native tests

- authorization states map to the versioned response contract;
- only event-capable calendars are returned;
- one selected calendar and bounded dates are required;
- normalized events omit forbidden fields;
- recurring occurrences receive stable distinct keys;
- malformed requests and every mutation-like method are rejected; and
- EventKit change notifications produce one normalized bridge event.

EventKit itself is wrapped behind a protocol so Swift unit tests use neutral synthetic calendar/event values and never access the developer's real calendar.

### Electron and persistence tests

- native protocol parsing rejects malformed, oversized, stale, and unexpected responses;
- selection, transactional refresh, duplicate upsert, replacement deletion, calendar removal, disconnect purge, and stale-run rejection are covered against isolated databases;
- refresh single-flight and debounce behavior are deterministic;
- matcher coverage includes exact overlap, start grace, duration mismatch, all-day exclusion, cancellations, recurring occurrences, ambiguity, user override, and no match;
- exact normalized project suggestions do not create or link entities automatically;
- normal, recovery, and fallback meeting persistence receive the same association behavior; and
- no calendar field is admitted into transcript evidence or model prompts.

### Renderer tests

- every permission/capability state has truthful copy and recovery actions;
- the user can connect, choose one calendar, refresh, change, and disconnect;
- active recording and Meeting View label calendar-derived context explicitly;
- accepting a title suggestion never replaces an existing user title; and
- denial or degraded Calendar state never blocks recording.

### Packaging and rendered acceptance

- native build verification proves the helper bundle, Info.plist usage descriptions, executable, and required entitlements are present;
- TypeScript build, focused Biome, changelog validation, Swift tests, focused Vitest, full Vitest, and packaged-runtime verification pass;
- on a clean temporary Pluto profile, manually verify the macOS allow and deny flows, selected-calendar persistence, refresh, app restart, event update/removal visibility, association chooser, accepted title, disconnect purge, and System Settings recovery;
- use an event the user created outside Pluto or an already existing event; Pluto's acceptance run must not create, edit, respond to, or delete a real calendar event; and
- report separately whether rendered Electron/TCC acceptance was performed. Unit, build, or DOM evidence alone does not establish native permission behavior.

## Durable records and shipping

The approved design records the native EventKit boundary in `docs/decisions.md`. Implementation adds a uniquely named `#617` changelog fragment explaining why Pluto uses the Mac's calendar store instead of provider OAuth. The pull request links #617 and calls out that Apple grants full Calendar access even though Pluto exposes a read-only contract.

Completion requires working product flow through native permission, selected calendar, bounded local refresh, meeting association, visible provenance, and disconnect purge. A Swift mapper, mock bridge, or Settings card without real packaged EventKit access is not complete.
