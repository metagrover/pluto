# Zoom Call Lifecycle Confidence Design

**Issue:** [#554](https://github.com/metagrover/pluto/issues/554)

## Outcome

Pluto shows the call-detected alert only after confirming active meeting audio and
automatically ends a recording after that confirmed call becomes silent.

## Evidence

- The active-call detector intentionally returns medium confidence when Zoom is
  running and attached to audio processes but produces no non-zero audio.
- The alert hook currently treats every active detector result as alert-eligible,
  including medium-confidence fallback.
- The auto-end decision already requires high confidence before it tracks a call.
- The local auto-end event log contains no grace-start or completion events for
  the reported behavior, so the runtime did not establish and then lose a
  confirmed call.
- Current `master` includes the targeted meeting-process probe from #545.

## Considered Approaches

### 1. Treat medium confidence as an active call everywhere

This would make auto-end arm more often, but it would also preserve the false
alert and could automatically stop manually started recordings merely because
Zoom is open. Rejected because process attachment is presence evidence, not call
evidence.

### 2. Remove silent fallback from the detector

This would stop false alerts, but it would also remove the evidence auto-end uses
to distinguish an open silent call app from an exited call app and select the
existing grace period. Rejected because the detector evidence remains useful
when consumers apply the confidence policy correctly.

### 3. Enforce confidence at each consumer and log lifecycle transitions

High confidence establishes a call and can show the alert. Medium confidence is
retained only as fallback after establishment. Privacy-safe observation
transitions make runtime failures diagnosable without recording or persisting
audio. Approved because it preserves the existing detector contract and fixes
the trust-boundary violation at the consumer.

## Design

### Alert policy

Extract a pure alert decision from `useActiveCallMonitor.ts`. A result is
alert-eligible only when it is active, has an app name, and has high confidence.
Startup baseline suppression remains unchanged. A transition from medium to high
for the same app remains a fresh confirmed join and shows one alert. Medium
confidence and process-count changes at medium confidence never show an alert.

### Auto-end policy

Keep `autoEndDecision` unchanged:

- no tracked app plus high confidence locks the app;
- a tracked app falling to medium or low confidence starts grace;
- high confidence returning cancels grace;
- an app exit uses 60 seconds and silence/fallback uses 120 seconds.

Changing these rules without live evidence would weaken recording safety.

### Runtime diagnostics

Persist only detector state transitions observed by the auto-end monitor:

- `call_observation_high`
- `call_observation_medium`
- `call_observation_low`

Reuse `auto_end_log` with app name and no audio payload. Do not write repeated
rows while confidence, app, and reason are unchanged. These events identify
whether the detector failed to produce high confidence or the auto-end consumer
failed after receiving it.

### Testing

- Pure alert-policy tests cover silent Zoom suppression and medium-to-high alert
  eligibility.
- Auto-end decision tests continue to cover high-confidence establishment,
  medium-confidence grace, and resumed-audio cancellation.
- A transition helper test proves duplicate observations are not logged and
  confidence/app/reason changes are logged.
- Focused tests, the full test suite, Biome, changelog validation, and diff checks
  form the verification set.

## Durable Records

Add a changelog fragment for #554. No decision-log or ADR entry is needed because
the confidence hierarchy already exists; this change applies it consistently and
adds diagnostics.
