# Parakeet Shadow Receipt-Aligned Windowing Design

**Issue:** #662  
**Status:** Approved for implementation  
**Date:** 2026-08-24

## Problem

The guarded Parakeet shadow path is enabled for ordinary recordings, but its
window assembler requires a durable receipt to end at exactly 30.000 seconds.
Chromium `MediaRecorder` intervals are not exact: persisted sessions reach the
first target at 31.360, 31.004, and 30.862 seconds. The receipt that crosses the
synthetic boundary is rejected, the coordinator records `window_invalid`, and
zero Parakeet windows are submitted.

The existing unit fixtures all use exact five-second intervals, so they prove a
timing condition that production capture does not provide.

## Constraints

- A durable capture receipt is the atomic provenance unit. The assembler may
  group receipts but must not split, duplicate, drop, or rewrite one.
- Source identity, generation, sequence, and time must remain contiguous and
  fail closed when they are not.
- Shadow work remains provisional and invisible. MLX remains the visible live
  preview and the full Parakeet final pass remains canonical.
- The fix must not introduce audio decoding or private transcript content into
  the pure metadata assembler or its reports.

## Considered approaches

### 1. Seal at the first receipt end at or beyond the target (selected)

Accumulate validated contiguous receipts. Once the span from the first receipt
start to the newest receipt end is at least 30 seconds, seal the complete set at
that newest receipt end. The next window begins at the following receipt.

This produces receipt-aligned windows whose duration is the target plus at most
one normal capture interval of overshoot. It preserves complete coverage and
works for both exact fixtures and real recorder timing.

### 2. Seal every six receipts

This matches the current nominal five-second capture cadence, but it encodes a
receipt-count assumption rather than a duration contract. It would behave
poorly if capture cadence changes or a recovery receipt covers a different
duration.

### 3. Trim or split audio at exact 30-second boundaries

This could preserve exact-duration windows, but the assembler only owns receipt
metadata. Exact splitting belongs in an audio transformation layer and would
require new checksum/provenance semantics for partial receipts. It adds risk
without improving the provisional evaluation goal.

## Design

`ShadowWindowAssembler.add` will validate the incoming receipt, then validate
identity and source-local sequence/time continuity. It will append the receipt
and calculate the accumulated span from the first buffered receipt. When the
span is greater than or equal to the 30-second target, it seals at the latest
receipt end. `flush` continues to seal any shorter tail once and remains
idempotent.

The previous `shadow_crosses_window_boundary` condition is removed because
crossing the duration target is now the normal seal trigger. All true integrity
errors remain fail-closed:

- malformed or non-positive receipt: `shadow_receipt_invalid`
- meeting, generation, or source change: `shadow_identity_mismatch`
- duplicate or skipped sequence: `shadow_sequence_gap`
- time gap or overlap: `shadow_time_gap`

No coordinator protocol or report schema changes are required. The coordinator
already stitches and submits the assembler-provided start and end times.

## Verification

Regression tests will first reproduce the persisted timing sequence and fail on
the current boundary rejection. The completed suite will prove:

- realistic drifting receipts emit one window ending at the receipt boundary;
- the next window starts without a gap or duplicate receipt;
- exact five-second fixtures remain supported;
- identity, sequence, time, and receipt validation remain fail-closed;
- mic and System coordinator paths submit realistic windows and flush tails;
- a persisted-manifest timing replay reaches window submission instead of
  `window_invalid` without exposing private content.

Focused Vitest, Biome, TypeScript, changelog validation, and diff checks form
the implementation gate. A live or persisted-manifest replay is required as
runtime evidence; unit tests alone do not establish restored shadow operation.

## Deferred evidence work

Decoder hints, forced language, browser capture processing, and native capture
remain unchanged by this repair. Once the shadow lifecycle produces evidence,
same-audio comparisons can distinguish decoder configuration from capture and
cross-channel reconciliation effects before any further production change.
