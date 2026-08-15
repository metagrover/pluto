# Live background transcript validation design

**Issue:** [#616](https://github.com/metagrover/pluto/issues/616)  
**Status:** Approved direction

## Outcome

Pluto keeps the base MLX model on the live first-paint path and opportunistically validates sealed five-second capture chunks with the medium model. A successful validation revises the durable checkpoint for the same audio evidence and corrects the visible draft in place. Recording capture and live transcription always have priority.

## Evidence boundary

- Repair audio remains immutable and is identified by the capture-journal source, sequence, and checksum.
- A base checkpoint is a preview. A medium checkpoint is a validated revision only when it was produced from the same repair-audio checksum and persisted through the journal replacement contract.
- Live acceptance frames remain immutable. Finalization detects frames linked to superseded checkpoint checksums and rebuilds them while the journal is stopping.
- A validation result never changes speaker ownership. Source-channel attribution stays `mic -> Me` and `system -> Them`.

## Scheduling

- The existing live queue owns first-paint work.
- Background validation starts only after the live queue is idle and only one validation job may run at a time.
- Starts are separated by at least 20 seconds. Pending work is bounded and later work may be skipped rather than building a recording-time backlog.
- Background work is not admitted on battery power or when macOS reports serious or critical thermal pressure.
- Meeting generation and cancellation fences discard late results. Stop closes the queue; unresolved tuples remain for authoritative finalization.
- MLX model, device, and compute type travel in the `/transcribe` request itself so concurrent configuration changes cannot select the wrong model.

## Correction merge

- Segment IDs are deterministic for source, sequence, and preview position.
- Medium segments are aligned monotonically to preview segments by time overlap. An aligned correction keeps the preview ID; unmatched medium segments receive deterministic validated IDs.
- Results with invalid times, out-of-chunk bounds, speaker changes, or no meaningful temporal alignment are not published live. The durable checkpoint replacement is likewise withheld.
- The live header quietly reports whether all visible chunks are validated; individual words do not gain badges or animation.

## Finalization reuse

The existing finalization planner already reuses checkpoints whose configuration matches the final medium policy. A validated revision therefore avoids equivalent stop-time work. Preview checkpoints and failed/skipped validations remain eligible for the existing final repair path.

## Failure behavior

- Model, persistence, thermal-policy, and cancellation failures leave the base preview and audio evidence untouched.
- There is one background replacement attempt per tuple. No global fuzzy word substitution or rolling full-meeting retranscription is allowed.
- Diagnostics contain only source, sequence, state, duration, model policy, and error category.

## Verification

- Unit tests cover cadence, bounded admission, idle gating, thermal/battery denial, cancellation, stable-ID merging, and rejection of unsafe alignment.
- Journal tests prove replacement remains bound to the same audio receipt and finalization rebuilds stale acceptance evidence.
- Python tests prove per-request model selection.
- A synthetic recording replay proves base first paint, later in-place correction, stop cancellation, and medium-checkpoint reuse without private transcript content.
