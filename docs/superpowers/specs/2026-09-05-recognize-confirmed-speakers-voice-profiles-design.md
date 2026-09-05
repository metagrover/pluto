# Recognize Confirmed Speakers Across Meetings with Opt-In Local Voice Profiles Design

**Issue:** [#755](https://github.com/metagrover/pluto/issues/755)  
**Status:** Approved for implementation planning

## Outcome

After a user explicitly confirms an anonymous meeting speaker as a person, Pluto can optionally remember a local voice profile and suggest that person for matching speaker clusters in future meetings. A voice match serves strictly as evidence for a suggestion and never as automatic proof of identity.

## Data Flow and Trust Boundary

```text
System audio + Mic/System energy
              |
              v
   FluidAudio raw chunk embeddings
       [native process only]
              |
       clean/purity aggregation
              |
              v
 bounded clusterEvidence + turns + energy
              |
       existing attribution gates
              |
      canonical label projection
              |
     atomic canonical DB commit
              |
              +--> meeting_speaker_candidates [raw vector stays in main process]
              |
              v
 calibrated matcher over compatible profiles
              |
       descriptor-only renderer IPC
              |
              v
 suggestion -> user Confirm / Not Alex
              |
      explicit opt-in checkbox
              |
              v
 immutable speaker_voice_enrollments

At no point does a match rewrite canonical `Them` / `Remote Speaker N` evidence.
```

## Architecture

### 1. Native Runtime Diarization Bridge & Bounded Clean Evidence
- `FluidAudioOfflineDiarizer` continues to run against the meeting's System recording.
- `OfflineDiarizerConfig.exposeChunkEmbeddings` is enabled only inside the native process. Raw per-chunk arrays never cross the JSON-line boundary.
- The native coordinator uses the diarization result, time-aligned chunk embeddings, and Mic/System energy windows to build bounded per-cluster evidence:
  ```swift
  public struct SpeakerClusterEvidence: Codable, Equatable, Sendable {
      public let cluster: String
      public let embedding: [Float]
      public let cleanChunkCount: Int
      public let cleanSegmentCount: Int
      public let cleanDurationSeconds: Double
      public let minimumChunkSimilarity: Double
      public let meanChunkSimilarity: Double
  }
  ```
- For each native cluster, the coordinator:
  1. Rejects chunks with the wrong dimension (`!= 256`), zero norm, or NaN/Infinity values from voice-profile evidence without discarding valid diarization turns or energy windows.
  2. Excludes intervals containing Mic speech, cross-speaker overlap, or less than one second of continuous supported System speech.
  3. Averages only accepted unit-normalized chunks, re-normalizes the result, and calculates within-cluster minimum and mean cosine similarity.
  4. Emits at most one 256-dimensional aggregate per native cluster.
- `SpeakerEvidenceOutput` exposes `clusterEvidence: [SpeakerClusterEvidence]` alongside `turns`, `energyWindows`, `provenance`, and `timings`. Response validation places a fixed maximum on cluster count and encoded response bytes so multi-hour meetings remain below `nativeJsonLineProcess.ts`'s 16 MiB limit.
- `SpeakerEvidenceProvenance` provides the immutable provenance tuple:
  - `modelIdentifier: String`
  - `modelRevision: String`
  - `artifactDigest: String`
  - `runtimeVersion: String`
  - `profileAlgorithmVersion: String`
- **Failure boundary**:
  - Expected digital silence retains the existing empty-turn behavior.
  - Core diarization, energy-analysis, model-integrity, and cancellation failures retain the existing final-transcription failure behavior. Voice recognition must never reinterpret those failures as silence.
  - Failure to produce valid `clusterEvidence` returns no voice suggestion or enrollment opportunity, but valid `turns` and `energyWindows` continue through the existing attribution pipeline.

### 2. Single and Multi-Speaker Candidate Mapping
- `applyRemoteSpeakerClusters.ts` preserves issue #749's conservative canonical transcript rules:
  - If fewer than 2 established clusters exist on System audio, transcript turns remain `Them` with fallback reason `not_enough_speakers`.
  - If 2 or more established clusters exist, transcript turns receive deterministic labels `Remote Speaker 1`, `Remote Speaker 2`, etc.
- The existing issue #761 review path remains authoritative for choosing reviewable anonymous labels: numbered remote speakers win; otherwise one aggregate `Them` choice is reviewable. `selectReviewableAnonymousSpeakers` and `selectSpeakerSampleIntervals` are reused rather than duplicated.
- **Candidate Evidence Extraction**:
  - Independent of transcript label projection, if System audio contains valid speech, candidate clusters are derived for review and recognition:
    - When exactly one supported native cluster exists and numbered labels were not published, candidate key is `'Them'`.
    - In a multi-speaker meeting, candidate keys are `'Remote Speaker 1'`, `'Remote Speaker 2'`, etc.
  - For each candidate speaker:
    - Map the bounded native `clusterEvidence` to the same canonical candidate key used by the review surface.
    - Require clean speech $\ge 3.0$s across $\ge 2$ distinct clean segments and at least two accepted chunks.
    - Apply the calibrated within-cluster purity policy from section 7. Aggregate `Them` is not assumed to represent one person merely because only one cluster survived; insufficient cohesion or competing supported evidence suppresses enrollment.
    - Compute a deterministic full `candidateDigest` as SHA-256 over the canonical little-endian Float32 bytes of the normalized embedding plus its complete provenance tuple. JSON number formatting is never part of the digest input.
    - Mark the candidate `isEligibleForEnrollment = true` only when structural, duration, vector, provenance, and calibrated purity gates all pass. Otherwise, the user may still make a meeting-scoped identity binding, but the enrollment checkbox is hidden.

### 3. Biometric Data Protection & Meeting Candidate Evidence Table
- **No Unconsented Voiceprints in Transcripts:** Candidate embeddings are NEVER written into `transcript_json`, `meetings.metadata`, client-facing logs, or renderer IPC transcripts.
- Dedicated local evidence table in SQLite (`electron/db.ts`):
  ```sql
  CREATE TABLE IF NOT EXISTS meeting_speaker_candidates (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    candidate_digest TEXT NOT NULL,
    embedding_json TEXT NOT NULL,
    clean_duration_sec REAL NOT NULL,
    clean_segment_count INTEGER NOT NULL,
    clean_chunk_count INTEGER NOT NULL,
    minimum_chunk_similarity REAL NOT NULL,
    mean_chunk_similarity REAL NOT NULL,
    reference_start_sec REAL NOT NULL,
    reference_end_sec REAL NOT NULL,
    reference_excerpt TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (meeting_id, speaker, source_revision)
  );
  ```
- **Lifecycle & Deletion Policy**:
  - `commitCanonical` accepts candidate evidence and writes the canonical transcript plus the current generation's candidate rows in one SQLite transaction. A failed or superseded canonical commit writes neither. The transaction deletes older candidate generations for that meeting only after the new canonical write succeeds.
  - `ON DELETE CASCADE` ensures deleting a meeting permanently wipes all its candidate vectors.
  - Resetting the knowledge base (`resetKnowledgeBase`) truncates candidate, enrollment, profile-setting, and rejection tables.
  - Database exports and any current or future sync payloads exclude `meeting_speaker_candidates`, `speaker_voice_enrollments`, `speaker_voice_profile_settings`, and `speaker_voice_rejections`.
  - Person deletion cascades that person's enrollments, settings, and rejection rows. Meeting deletion cascades candidate, enrollment-source, and rejection rows.
  - **Renderer Boundary**: The renderer receives only high-level suggestion descriptors (`{ speaker, suggestion: { personId, personName, confidence, isCalendarAttendee } | null, candidateDigest, sourceRevision, isEligibleForEnrollment }`). Raw embedding arrays are never sent across the IPC bridge to the renderer.

### 4. Lossless Person-Merge and Restoration (Immutable Enrollments)
- Rather than maintaining a single mutable centroid per person that cannot be unmerged, Pluto stores immutable per-enrollment samples:
  ```sql
  CREATE TABLE IF NOT EXISTS speaker_voice_enrollments (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    source_meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    source_revision TEXT NOT NULL,
    speaker TEXT NOT NULL,
    embedding_json TEXT NOT NULL,
    chunk_count INTEGER NOT NULL,
    clean_duration_sec REAL NOT NULL,
    reference_start_sec REAL NOT NULL,
    reference_end_sec REAL NOT NULL,
    reference_excerpt TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS speaker_voice_profile_settings (
    person_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- **Dynamic Canonical Aggregation**:
  - When matching or inspecting profiles, Pluto resolves each enrollment's owner via `canonicalPersonId = resolvePersonIdentityId(person_id)`.
  - If a canonical person has retained enrollments:
    - Aggregate centroid: $\mathbf{v}_{\text{agg}} = \frac{\sum_k w_k \mathbf{v}_k}{\|\sum_k w_k \mathbf{v}_k\|}$ where $w_k = \text{clean\_duration\_sec}_k$.
    - Representative reference clip: selected from the enrollment with the longest clean duration.
    - Matching is enabled only when the canonical person's `speaker_voice_profile_settings.status` is `active`; absence of a settings row means `active`.
  - **Person Merge (`mergePerson`)**: Adds alias in `person_aliases`. `resolvePersonIdentityId` points the source person to the destination. Destination dynamically combines all retained enrollments.
  - **Person Merge Restore (`restorePersonMerge`)**: Deactivates alias. `resolvePersonIdentityId` immediately returns the original person ID. Both original persons immediately recover their exact, uncorrupted original profiles with zero precision loss.
  - **Disable / Enable**: Changes only the canonical person's settings row. While a merge is active, disabling the destination suppresses the combined profile without mutating any source enrollment or source person's saved setting. Restoring the merge therefore restores each source profile's prior enabled state; the destination retains any setting the user explicitly changed.
  - **Permanent Delete**: Deletes enrollments owned by the selected immutable `person_id`, not every enrollment currently resolving to the same canonical family. To avoid a button that appears to delete a combined profile but leaves aliased enrollments active, permanent delete is unavailable on a merged family until the user restores/splits the merge. The UI explains this requirement. Disabling remains available while merged.
  - **Meeting Deletion**: Cascades deletion of candidate evidence and enrollments sourced from that meeting, then recomputes affected aggregate profiles from any remaining enrollments. A missing recording file for a meeting that still exists leaves its enrollment usable for matching but makes reference playback unavailable.

### 5. Deterministic Matcher & Global Acoustic Calibration
- For a candidate cluster $(\mathbf{v}_{\text{cand}}, \text{provenance}_{\text{cand}})$:
  1. Load the enabled, versioned calibration policy for the candidate's complete compatibility key: `modelIdentifier`, `modelRevision`, `artifactDigest`, `runtimeVersion`, and `profileAlgorithmVersion`. If no enabled policy exists, return `null`.
  2. Retrieve all active canonical profiles with that exact compatibility key. Any enrollment with incompatible or incomplete provenance is excluded from matching.
  3. Exclude any `person_id` that has a rejection recorded for the exact `(meeting_id, speaker, source_revision, candidate_digest)` candidate.
  4. Compute cosine similarity $s_i = \mathbf{v}_{\text{cand}} \cdot \mathbf{v}_{\text{profile}_i}$ for all eligible profiles.
  5. Order all candidates strictly by acoustic score: $s_1 \ge s_2 \ge \dots$.
  6. **Global Acoustic Threshold & Margin Rule**:
     - Top candidate must satisfy the calibrated absolute threshold.
     - If a second profile exists, the difference $s_1 - s_2$ must satisfy the calibrated global margin. With one compatible profile, the absolute threshold and candidate-purity gates still apply.
     - A failed absolute, margin, purity, or compatibility gate returns `null` and keeps the speaker anonymous.
  7. **Calendar Context Isolation**:
     - Calendar context MUST NOT alter the acoustic score, threshold, runner-up margin, or winner.
     - If and only if candidate 1 independently satisfies the global acoustic threshold and margin, calendar attendance is passed as metadata (`isCalendarAttendee: true`) for UI annotation (`"Alex (on calendar)"`).
- Matching records only content-free diagnostics: calibration policy version, compatible profile count, outcome category (`suggested`, `below_threshold`, `ambiguous`, `impure`, `incompatible`, or `rejected_for_candidate`), and bucketed score/margin ranges. Names, IDs, raw scores, embeddings, transcript text, excerpts, meeting IDs, audio paths, and candidate digests never enter logs or analytics.

### 6. Revision-Bound Rejections and Concurrency Protection
- Rejections table:
  ```sql
  CREATE TABLE IF NOT EXISTS speaker_voice_rejections (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker TEXT NOT NULL,
    person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    source_revision TEXT NOT NULL,
    candidate_digest TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (meeting_id, speaker, person_id, source_revision, candidate_digest)
  );
  ```
- **Staleness & Concurrency Safeguards**:
  - Actions (`confirmSuggestion`, `rejectSuggestion`, `enrollVoiceProfile`) must supply:
    - `sourceRevision`: must match `hash(meeting.transcript_json)`.
    - `candidateDigest`: must match `meeting_speaker_candidates.candidate_digest`.
    - `expectedRevision`: must match `identity_workspace.revision`.
  - If a meeting's transcription is regenerated or the identity workspace is concurrently modified, stale writes fail with `identity_revision_stale` or `speaker_candidate_stale`.
  - Rejection suppresses "Not Alex" only for that exact transcription generation and candidate digest. Recomputing candidate evidence under the same transcript or regenerating the transcript cannot make an old rejection suppress a different acoustic vector.

### 7. Calibration, Enablement, and Rollback
- Voice-profile enrollment and management may ship independently, but automatic match suggestions remain behind `voice_profile_suggestions_v1`, default `false`.
- A versioned `VoiceProfileCalibrationPolicy` owns the absolute similarity threshold, runner-up margin, maximum within-cluster dispersion, minimum chunk similarity, and compatible provenance key. The values are not copied into UI or call sites.
- Before enabling suggestions by default, run a consented private benchmark with:
  - At least 5 enrolled speakers across at least 3 real conference applications.
  - At least 3 separate meetings per enrolled speaker, including different microphones or call conditions where available.
  - Repeat-speaker positives, unseen-speaker negatives, acoustically similar-speaker negatives, single-profile matching, aggregate-`Them` cases, and multi-speaker meetings.
  - Predeclared candidate policies and evaluation cases before inspecting results.
- The benchmark reports only aggregate, content-free counts and rates: eligible candidates, true suggestions, false suggestions, missed matches, ambiguous suppressions, purity suppressions, incompatible-profile suppressions, application class, and latency percentiles. No identities, meeting IDs, raw scores, embeddings, excerpts, transcript text, audio, or local paths enter committed artifacts or GitHub evidence.
- Default enablement requires zero observed false suggestions in the benchmark. Missed-match and ambiguity rates are reported as usability limits, not relaxed by weakening the false-suggestion gate. Thresholds and the resulting policy version are recorded in `docs/decisions.md` before changing the default.
- Rollback sets `voice_profile_suggestions_v1` to `false`. Existing local enrollments remain inspectable, disableable, and deletable; canonical transcripts and meeting-scoped bindings are unchanged.

### 8. User Interface Surfaces

#### Speaker Review Modal (`SpeakerIdentificationModal.tsx`)
- **Voice Match Suggestion**:
  - Displays banner: `Speaker 1 may be Alex` (or `Them may be Alex`).
  - Badges: `Strong match` (and `On calendar` if applicable).
  - Audio playback:
    - `Play current sample`: Slices and streams candidate turn from current meeting.
    - `Play reference sample`: Slices and streams confirmed reference clip from the enrollment source meeting. If the source meeting recording was deleted, button shows `Reference recording unavailable` without error.
  - Actions:
    - `Confirm Alex`: Creates meeting-scoped identity binding for Alex and auto-advances.
    - `Not Alex`: Transactionally records rejection in `speaker_voice_rejections`, clears suggestion, and returns to standard person search combobox.
- **Opt-In Enrollment Choice**:
  - Whenever an anonymous speaker is confirmed to a person:
    - If the turn satisfies enrollment gates (`isEligibleForEnrollment: true`):
      - Shows checkbox: `[ ] Remember this voice for future meetings` (default unchecked).
      - If checked, creates enrollment record under that `person_id`.

#### Person Dossier (`PeopleTab.tsx`)
- Displays "Voice Profile" card under Person details:
  - Status: `Remembered voice (Active)` or `Disabled`.
  - Evidence: enrollment count, total clean speech duration.
  - `Play reference sample` button.
  - `Disable voice recognition` / `Enable voice recognition` toggle.
  - `Delete voice profile` permanently deletes enrollments owned by that immutable person ID when the person is not part of an active merge.
  - For a merged family, permanent delete is disabled with `Restore this person merge before permanently deleting voice samples.` Disabling the combined profile remains available.

## Verification Plan

### Automated Unit & Integration Tests

1. **Native Clean-Interval Embedding**:
   - `native/parakeet-runtime/Tests/ParakeetRuntimeCoreTests/ProtocolTests.swift` verifies bounded `clusterEvidence` encoding and decoding, the complete provenance tuple, and absence of raw chunk embeddings from the public response.
   - `native/parakeet-runtime/Tests/ParakeetRuntimeEngineTests/FluidAudioSpeakerEvidenceTests.swift` verifies clean interval filtering, wrong-dimension/zero/NaN/Infinity rejection, non-collinear centroid normalization, purity statistics, and retention of valid turns and energy windows when optional cluster evidence is unusable.
   - Core diarization, model-integrity, energy-analysis, and cancellation failures retain their existing failure result; only expected silence produces empty turns.
   - `tests/unit/nativeJsonLineProcess.test.ts` accepts the largest supported bounded response, rejects a response over 16 MiB, and proves a synthetic multi-hour meeting remains below the bound.

2. **Single and Multi-Speaker Candidate Mapping**:
   - `tests/unit/applyRemoteSpeakerClusters.test.ts`:
     - Single supported native cluster retains `Them` canonical transcript turns while producing candidate `Them`.
     - Multi-speaker meeting produces candidate `Remote Speaker 1`, `Remote Speaker 2`.
     - Aggregate `Them` with insufficient cohesion or competing supported evidence remains reviewable for a meeting-scoped binding but is ineligible for enrollment.
     - Existing `selectReviewableAnonymousSpeakers` and `selectSpeakerSampleIntervals` behavior from issue #761 remains authoritative.

3. **Global Acoustic Threshold & Margin Matcher**:
   - `tests/unit/speakerVoiceMatcher.test.ts`:
     - No enabled compatible calibration policy always returns `null`.
     - One stored profile matches only when the calibrated absolute and purity thresholds pass.
     - Two profiles match only when the calibrated absolute threshold and global runner-up margin pass; close candidates remain anonymous.
     - Roster test: Calendar attendee cannot change the acoustic winner or override margin requirement.
     - Any incompatible model identifier, model revision, artifact digest, runtime version, or profile algorithm version is excluded from matching.
     - Content-free diagnostics contain only the allowed policy, count, outcome, bucket, and latency fields.

4. **Biometric Protection & Lifecycle Verification**:
   - `tests/unit/speakerVoiceStore.test.ts`:
     - Canonical transcript and candidate evidence commit atomically; a superseded commit writes neither and does not delete the prior accepted generation.
     - Meeting deletion cascades and wipes candidate evidence.
     - Meeting deletion removes only enrollments sourced from that meeting and recomputes profiles from remaining enrollment rows.
     - Knowledge base reset wipes candidates and enrollments.
     - Raw embeddings never exist in `transcript_json`, meeting metadata, renderer payloads, logs, analytics, export fixtures, or sync payloads.
     - Missing reference audio leaves matching available and returns the explicit unavailable playback state.

5. **Lossless Person Merge & Restore**:
   - `tests/unit/speakerVoiceMergeRestore.test.ts`:
     - Enroll Person A and Person B.
     - Merge Person A $\rightarrow$ Person B: destination combines enrollments.
     - Restore merge: Person A and Person B recover exact original profiles and centroids.
     - Disable the merged destination: combined matching stops without changing A's enrollment or saved setting; restore returns A to its exact prior state.
     - Permanent delete is rejected while a merged family contributes enrollments; after restore, deleting A does not delete B.
     - Rename and person deletion preserve or cascade profile data by immutable entity ID.

6. **Revision-Bound Actions & Concurrency**:
   - `tests/unit/speakerVoiceRevision.test.ts`:
     - Rejection suppresses only the exact `sourceRevision` plus `candidateDigest` tuple.
     - Recomputing candidate evidence under the same transcript does not reuse a rejection for a different digest.
     - Regenerating transcription changes `sourceRevision` and invalidates stale rejection, confirmation, and enrollment actions.
     - Stale `expectedRevision` throws `identity_revision_stale`.
     - Double confirmation, concurrent profile disable/delete, and candidate replacement resolve transactionally without duplicate enrollment or partial binding state.

7. **UI Component Tests**:
   - `tests/unit/SpeakerIdentificationModal.dom.test.tsx`:
     - Suggestion banner rendering (`Them may be Alex` / `Speaker 1 may be Alex`).
     - Reference sample and current sample play buttons.
     - `Confirm` and `Not Alex` button clicks.
     - Opt-in `Remember this voice for future meetings` checkbox.
   - `tests/unit/PeopleTab.dom.test.tsx`:
     - Voice profile card, toggle disable/enable, delete voice profile, and the merged-family restore-before-delete state.

8. **Private Calibration Benchmark**:
   - A local-only benchmark manifest fixes the enrolled-speaker count, application count, case taxonomy, policy candidates, and metric schema before inference.
   - Tests reject reports containing identities, raw scores, candidate digests, meeting IDs, transcript text, excerpts, audio, embeddings, or paths.
   - Suggestions remain default-off until the consented benchmark completes with zero observed false suggestions and the selected policy is recorded in `docs/decisions.md`.

### Verification Commands

- Run focused Vitest suites for candidate mapping, storage, matching, revisions, merge/restore, native transport, and UI behavior.
- Run `swift test --package-path native/parakeet-runtime` for native protocol, aggregation, and failure-boundary coverage.
- Run `pnpm run test`, `pnpm exec tsc --noEmit`, `pnpm run lint`, `pnpm run changelog:check`, and the applicable privacy-guard tests before delivery.
- Run `pnpm run ensure:sqlite-abi` after Node/Vitest database tests and before Electron or packaging verification.

## Production Failure Modes

| Failure | Handling | User-visible result | Required coverage |
|---|---|---|---|
| Optional cluster evidence contains an invalid vector or fails purity gates | Drop that candidate only; retain valid turns and energy evidence | Meeting transcription behaves normally; no voice suggestion or enrollment checkbox | Native engine and candidate-mapping tests |
| Core diarization, energy analysis, model integrity, or cancellation fails | Preserve the existing final-transcription failure contract | Existing recovery or needs-attention state; never apparent silence | Existing attribution regressions plus native failure tests |
| Native response would exceed the transport bound | Bounded aggregation prevents emission; response validator rejects any contract violation | Existing speaker-evidence failure state, with no partial candidate persistence | Multi-hour size and over-limit transport tests |
| Canonical commit is superseded or SQLite write fails | Roll back transcript/candidate transaction together | Existing meeting remains authoritative; no stale suggestion appears | Atomic commit integration tests |
| Suggestion action uses a stale transcript, candidate digest, or identity revision | Reject without writing binding, rejection, or enrollment; reload identity state | Clear `Meeting changed; review the speaker again.` message | Revision and concurrency tests |
| No compatible enabled calibration policy exists | Matcher returns `null` | Speaker remains anonymous; manual identification still works | Matcher policy tests |
| Reference recording is missing | Keep enrollment for matching; sample endpoint returns unavailable | `Reference recording unavailable`; confirmation remains possible from current evidence | Store and UI tests |
| Meeting, person, profile, or knowledge base is deleted | Apply the explicit cascades and recompute remaining aggregates | Deleted evidence disappears immediately and cannot be suggested | Lifecycle and merge/restore tests |

## NOT in Scope

- Automatic naming without confirmation, voice authentication, impersonation detection, cloud matching, cross-device sync, and organization-wide voice directories remain excluded by issue #755.
- Changing issue #749's canonical anonymous transcript rules is excluded; recognition remains a reversible suggestion and display projection.
- Rebuilding issue #761's aggregate-`Them` review and sample-selection UI is excluded; this design consumes those existing helpers.
- Enabling suggestions by default before the consented calibration gate passes is excluded.

## Implementation Sequence

1. Rebase onto `origin/master` and reuse the shipped issue #761 aggregate-`Them` review path.
2. Add bounded native cluster evidence and Swift protocol/engine tests without changing existing attribution failures.
3. Add pure candidate mapping, digest, purity, compatibility, and matcher modules with TDD.
4. Add candidate, enrollment, settings, rejection, and atomic canonical-commit persistence with lifecycle tests.
5. Add revision-bound IPC handlers and connect suggestions/enrollment to the existing identity-binding transaction.
6. Add the modal and Person dossier states, including merged-family deletion disclosure.
7. Add the private benchmark, privacy guard, and default-off calibration policy; enable by default only in a later decision after the gate passes.
