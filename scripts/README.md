# Internal maintenance scripts

These tools are for development and recovery, not user-facing settings. Routine
processing and future data migrations should run automatically in Pluto.

## Voice candidate backfill

`backfill_voice_candidates.mjs` requests a one-time scan of existing meetings for
missing `single-pass-v2` voice candidates. Keep it available for troubleshooting
older profiles and verifying migrations; it is not a normal setup step.

Run from the repository root:

```bash
node scripts/backfill_voice_candidates.mjs --start
node scripts/backfill_voice_candidates.mjs --status
```

The default profile is `~/Library/Application Support/pluto`. Set
`PLUTO_USER_DATA_DIR` to target another profile. Pluto must be running a build
that includes `voiceCandidateBackfill`, using that same profile. `--start` only
writes the request; it does not mean processing has completed.

The app scans meetings with recorded audio paths and sends eligible work through
its existing voice queue. Work respects power, thermal, memory, and foreground
processing limits. The request survives restarts; saved candidates and extraction
attempts determine what still needs processing. Repeating `--start` requests a
fresh scan, without forcing another extraction of current candidates or retrying
terminal abstentions for the same source revision.

Status is written inside the profile to `voice-candidate-backfill-report.json`:

- `current`: the usable speaker sources have current extraction data; inspect
  individual speaker results for sources that could not be used.
- `pending`: at least one speaker still needs processing or a retry.
- `evidence_unavailable`: extraction abstained for at least one speaker.
- `no_usable_source`: no usable remote-speaker source was available.

`complete` means the scan has no pending candidates, not that every meeting
produced a valid voice sample or every speaker was recognized. Partial scans and
per-meeting results can lag behind extraction while the scan advances.

The script does not directly rewrite the database. The app's existing handlers
save derived candidates and reconcile explicitly confirmed enrollments, retaining
their source checks and opt-out rules. Recordings and transcripts are preserved.
Keep request files, reports, and private meeting data out of Git.
