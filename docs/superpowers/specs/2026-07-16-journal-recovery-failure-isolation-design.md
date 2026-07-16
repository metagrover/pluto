# Capture Journal Recovery Failure Isolation Design

## Issue

[#499](https://github.com/metagrover/pluto/issues/499), split from [#438](https://github.com/metagrover/pluto/issues/438).

## Problem

Launch recovery scans interrupted capture journals in meeting-id order. Manifest problems are already isolated, but a rejected stitch operation or synchronous meeting-save failure escapes the loop and aborts the whole scan. A single damaged journal can therefore strand unrelated healthy recordings until the next launch.

## Design

Treat each unsealed, not-yet-saved journal as an independent recovery transaction. Keep manifest validation and existing skip counters unchanged. Wrap segment validation, stitching, meeting construction, and persistence in a per-journal boundary. On failure, increment a content-free `failedRecoveryCount` and continue to the next journal.

The launch summary will be emitted when that counter is non-zero. The result does not include meeting content, local paths, or exception text. Failed journal manifests and chunks remain untouched so a later launch can retry them.

## Scope

- Isolate stitch and save failures per journal.
- Recover healthy journals that follow a failed journal.
- Expose and log the aggregate failed-journal count.
- Add focused fault-injection coverage.

## Non-goals

- Automatic retry within one launch.
- Recovery UI or notification changes.
- Artifact retention or cleanup.
- Transcript finalization after recovery.
- Changes to chunk checksum, gap, or provenance semantics.

## Verification

- RED/GREEN focused recovery tests.
- Changelog validation, lint, full unit suite, and diff checks.
