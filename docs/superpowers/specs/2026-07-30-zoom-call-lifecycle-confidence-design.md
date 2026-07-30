# Zoom Call Lifecycle Confidence Design

**Issue:** [#554](https://github.com/metagrover/pluto/issues/554)

## Outcome

Pluto shows the call-detected alert only after confirming active meeting audio and
preserves the existing conservative auto-end confidence boundary.

## Review Outcome

Pre-landing review narrowed this delivery to the proven false-alert fix. The
reported auto-end failure is not changed or claimed as fixed because current
evidence does not show why a live Zoom call failed to produce a high-confidence
observation. Proposed transition logging was removed because ordinary
speech/silence oscillation could create unbounded local rows without resolving
the underlying detector question.

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

### 3. Enforce confidence at the alert consumer

High confidence can show the alert. Medium confidence is retained as fallback
evidence for the existing auto-end state machine. Approved because it preserves
the detector contract and fixes the confirmed trust-boundary violation without
speculating about the unverified auto-end failure.

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

### Testing

- Pure alert-policy tests cover silent Zoom suppression and medium-to-high alert
  eligibility.
- Auto-end decision tests continue to cover high-confidence establishment,
  medium-confidence grace, and resumed-audio cancellation.
- Focused tests, the full test suite, Biome, changelog validation, and diff checks
  form the verification set.

## Durable Records

Add a changelog fragment for #554. No decision-log or ADR entry is needed because
the confidence hierarchy already exists; this change applies it consistently.
