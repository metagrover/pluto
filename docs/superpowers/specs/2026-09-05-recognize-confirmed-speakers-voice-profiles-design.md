# Recognize Confirmed Speakers Across Meetings with Opt-In Local Voice Profiles Design

**Issue:** [#755](https://github.com/metagrover/pluto/issues/755)  
**Status:** Approved for implementation planning

## Outcome

After a user explicitly confirms an anonymous meeting speaker as a person, Pluto can optionally remember a local voice profile and suggest that person for matching speaker clusters in future meetings. A voice match serves strictly as evidence for a suggestion and never as automatic proof of identity.

## Architecture

### 1. Native Runtime Diarization Bridge & Clean-Chunk Evidence
- `FluidAudioOfflineDiarizer` runs against the meeting's System recording.
- `OfflineDiarizerConfig.exposeChunkEmbeddings` is enabled.
- `DiarizationResult.chunkEmbeddings` provides time-aligned 256-dimensional unit-normalized chunk embeddings:
  ```swift
  public struct SpeakerChunkEvidence: Codable, Equatable, Sendable {
      public let cluster: String
      public let startTime: Double
      public let endTime: Double
      public let embedding: [Float]
  }
  ```
- `SpeakerEvidenceOutput` exposes `chunkEmbeddings: [SpeakerChunkEvidence]` alongside `turns`, `energyWindows`, `provenance`, and `timings`.
- `SpeakerEvidenceProvenance` provides the complete immutable provenance tuple:
  - `modelIdentifier: String`
  - `modelRevision: String`
  - `artifactDigest: String`
  - `runtimeVersion: String`
- Validation checks ensure:
  - Wrong dimensions (!= 256), zero norm (`||v|| == 0`), and NaN/Infinity vectors are strictly rejected.
  - Digital silence or diarization failure returns empty turns and chunk embeddings without throwing or blocking transcription.

### 2. Single and Multi-Speaker Candidate Mapping
- `applyRemoteSpeakerClusters.ts` preserves issue #749's conservative canonical transcript rules:
  - If fewer than 2 established clusters exist on System audio, transcript turns remain `Them` with fallback reason `not_enough_speakers`.
  - If 2 or more established clusters exist, transcript turns receive deterministic labels `Remote Speaker 1`, `Remote Speaker 2`, etc.
- **Candidate Evidence Extraction**:
  - Independent of transcript label projection, if System audio contains valid speech, candidate clusters are derived for review and recognition:
    - In a 1-on-1 meeting with 1 remote speaker, candidate key is `'Them'`.
    - In a multi-speaker meeting, candidate keys are `'Remote Speaker 1'`, `'Remote Speaker 2'`, etc.
  - For each candidate speaker:
    - Select accepted, non-overlapping clean intervals (excluding Mic speech, cross-speaker overlap, and utterances < 1s).
    - Collect only the time-aligned chunk embeddings whose `[startTime, endTime]` fall strictly within those accepted clean intervals.
    - If clean speech $\ge 3.0$s across $\ge 2$ segments and clean chunks exist:
      - Compute the candidate centroid: average the clean chunk embeddings and re-normalize to unit length:
        $$\mathbf{v}_{\text{cand}} = \frac{\sum_i \mathbf{c}_i}{\|\sum_i \mathbf{c}_i\|}$$
      - Compute a deterministic `candidateDigest` (`sha256(embedding).slice(0, 16)`).
      - Mark candidate as `isEligibleForEnrollment = true`.
    - Otherwise, mark `isEligibleForEnrollment = false`.

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
    reference_start_sec REAL NOT NULL,
    reference_end_sec REAL NOT NULL,
    reference_excerpt TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (meeting_id, speaker, source_revision)
  );
  ```
- **Lifecycle & Deletion Policy**:
  - `ON DELETE CASCADE` ensures deleting a meeting permanently wipes all its candidate vectors.
  - Resetting the knowledge base (`resetKnowledgeBase`) truncates `meeting_speaker_candidates`.
  - Database exports / sync exclude `meeting_speaker_candidates` and `speaker_voice_enrollments`.
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
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- **Dynamic Canonical Aggregation**:
  - When matching or inspecting profiles, Pluto resolves each enrollment's owner via `canonicalPersonId = resolvePersonIdentityId(person_id)`.
  - If a canonical person has active enrollments:
    - Aggregate centroid: $\mathbf{v}_{\text{agg}} = \frac{\sum_k w_k \mathbf{v}_k}{\|\sum_k w_k \mathbf{v}_k\|}$ where $w_k = \text{clean\_duration\_sec}_k$.
    - Representative reference clip: selected from the enrollment with the longest clean duration.
  - **Person Merge (`mergePerson`)**: Adds alias in `person_aliases`. `resolvePersonIdentityId` points the source person to the destination. Destination dynamically combines all active enrollments.
  - **Person Merge Restore (`restorePersonMerge`)**: Deactivates alias. `resolvePersonIdentityId` immediately returns the original person ID. Both original persons immediately recover their exact, uncorrupted original profiles with zero precision loss.
  - **Disable / Delete**: A user can disable a person's voice recognition (sets `status = 'disabled'` on their enrollments) or delete their voice profile (deletes rows in `speaker_voice_enrollments` for `person_id`).

### 5. Deterministic Matcher & Global Acoustic Calibration
- For a candidate cluster $(\mathbf{v}_{\text{cand}}, \text{provenance}_{\text{cand}})$:
  1. Retrieve all active canonical profiles with matching provenance (`modelIdentifier`, `modelRevision`, `artifactDigest`). Any profile trained under a different model artifact is excluded from matching.
  2. Exclude any `person_id` that has a rejection recorded for `(meeting_id, speaker, source_revision)`.
  3. Compute cosine similarity $s_i = \mathbf{v}_{\text{cand}} \cdot \mathbf{v}_{\text{profile}_i}$ for all eligible profiles.
  4. Order all candidates strictly by acoustic score: $s_1 \ge s_2 \ge \dots$
  5. **Global Acoustic Threshold & Margin Rule**:
     - Top candidate must satisfy: $s_1 \ge 0.72$.
     - If a second profile exists, require margin: $s_1 - s_2 \ge 0.10$.
     - If $s_1 < 0.72$ or $s_1 - s_2 < 0.10$, return `null` (remains anonymous).
  6. **Calendar Context Isolation**:
     - Calendar context MUST NOT alter the acoustic score, threshold, runner-up margin, or winner.
     - If and only if candidate 1 independently satisfies the global acoustic threshold and margin, calendar attendance is passed as metadata (`isCalendarAttendee: true`) for UI annotation (`"Alex (on calendar)"`).

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
    PRIMARY KEY (meeting_id, speaker, person_id, source_revision)
  );
  ```
- **Staleness & Concurrency Safeguards**:
  - Actions (`confirmSuggestion`, `rejectSuggestion`, `enrollVoiceProfile`) must supply:
    - `sourceRevision`: must match `hash(meeting.transcript_json)`.
    - `candidateDigest`: must match `meeting_speaker_candidates.candidate_digest`.
    - `expectedRevision`: must match `identity_workspace.revision`.
  - If a meeting's transcription is regenerated or the identity workspace is concurrently modified, stale writes fail with `identity_revision_stale` or `speaker_candidate_stale`.
  - Rejection suppresses "Not Alex" only for that exact transcription generation. If transcription is regenerated into a new acoustic partition, old rejections do not falsely suppress the new turn.

### 7. User Interface Surfaces

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
  - `Delete voice profile` button (permanently deletes all enrollment records for that person).

## Verification Plan

### Automated Unit & Integration Tests

1. **Native Clean-Interval Embedding**:
   - `tests/unit/speakerEvidence.test.ts`: verify `chunkEmbeddings` are populated, unit-normalized, have dimension 256, and zero/NaN vectors are rejected.
   - Non-overlapping clean interval filtering excludes short segments (< 1s) and overlap windows.
   - Non-collinear centroid calculation and re-normalization verified.

2. **Single and Multi-Speaker Candidate Mapping**:
   - `tests/unit/applyRemoteSpeakerClusters.test.ts`:
     - Single remote speaker meeting retains `Them` canonical transcript turn while producing candidate `Them`.
     - Multi-speaker meeting produces candidate `Remote Speaker 1`, `Remote Speaker 2`.

3. **Global Acoustic Threshold & Margin Matcher**:
   - `tests/unit/speakerVoiceMatcher.test.ts`:
     - Single stored profile matches when $\ge 0.72$.
     - Two profiles: matches top candidate when margin $\ge 0.10$; suppresses match when margin $< 0.10$ (ambiguous candidate).
     - Roster test: Calendar attendee cannot change the acoustic winner or override margin requirement.
     - Provenance test: Incompatible model revision or artifact digest is excluded from matching.

4. **Biometric Protection & Lifecycle Verification**:
   - `tests/unit/speakerVoiceStore.test.ts`:
     - Meeting deletion cascades and wipes candidate evidence.
     - Knowledge base reset wipes candidates and enrollments.
     - Raw embeddings never exist in `transcript_json` or meeting metadata.

5. **Lossless Person Merge & Restore**:
   - `tests/unit/speakerVoiceMergeRestore.test.ts`:
     - Enroll Person A and Person B.
     - Merge Person A $\rightarrow$ Person B: destination combines enrollments.
     - Restore merge: Person A and Person B recover exact original profiles and centroids.

6. **Revision-Bound Actions & Concurrency**:
   - `tests/unit/speakerVoiceRevision.test.ts`:
     - Rejection suppresses suggestion for matching `sourceRevision`.
     - Regenerating transcription changes `sourceRevision` and invalidates stale rejection/candidate bindings.
     - Stale `expectedRevision` throws `identity_revision_stale`.

7. **UI Component Tests**:
   - `tests/unit/SpeakerIdentificationModal.dom.test.tsx`:
     - Suggestion banner rendering (`Them may be Alex` / `Speaker 1 may be Alex`).
     - Reference sample and current sample play buttons.
     - `Confirm` and `Not Alex` button clicks.
     - Opt-in `Remember this voice for future meetings` checkbox.
   - `tests/unit/PeopleTab.dom.test.tsx`:
     - Voice profile card, toggle disable/enable, delete voice profile.
