# Recognize Confirmed Speakers Across Meetings with Opt-In Local Voice Profiles Design

**Issue:** [#755](https://github.com/metagrover/pluto/issues/755)  
**Status:** Approved for implementation planning

## Outcome

After a user explicitly confirms an anonymous meeting speaker as a person, Pluto can optionally remember a local voice profile and suggest that person for matching speaker clusters in future meetings. A voice match serves strictly as evidence for a suggestion and never as automatic proof of identity.

## Architecture

### 1. Native Runtime Diarization Bridge
- `FluidAudioOfflineDiarizer` runs against the meeting's System recording.
- The underlying `OfflineDiarizerManager` extracts 256-dimensional unit-normalized speaker embeddings per segment and calculates cluster centroids in `DiarizationResult.speakerDatabase` (`[String: [Float]]`).
- `SpeakerEvidenceOutput` in `native/parakeet-runtime` is extended to expose `clusterEmbeddings: [String: [Float]]`. Each cluster vector is guaranteed to be L2-normalized (`||v|| = 1.0`).
- Digital silence, single speaker, or failure gracefully returns empty embeddings without blocking transcription or downstream pipelines.

### 2. Final Transcription Pipeline Integration
- `parakeetFinalClient.ts` deserializes `clusterEmbeddings`.
- `applyRemoteSpeakerClusters.ts` maps native clusters (`S1`, `S2`) to canonical labels (`Remote Speaker 1`, `Remote Speaker 2`). It associates each established cluster's 256-d embedding vector with its canonical speaker label and returns `speakerClusterEmbeddings: Record<string, number[]>`.
- `runFinalTranscription.ts` preserves `speakerClusterEmbeddings` in final meeting transcription metadata (`metadata.speakerAttribution.remoteDiarization.speakerClusterEmbeddings`) for suggestion matching.

### 3. Voice Profile Storage & Rejection Memory
- Database schema additions in `electron/db.ts` / `identityStore.ts`:
  - **`speaker_voice_profiles`**:
    - `person_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE`
    - `status TEXT NOT NULL DEFAULT 'active'` (`'active' | 'disabled'`)
    - `embedding_json TEXT NOT NULL` (JSON array of 256 floats, L2-normalized)
    - `sample_count INTEGER NOT NULL DEFAULT 1`
    - `total_duration_sec REAL NOT NULL DEFAULT 0`
    - `reference_meeting_id TEXT`
    - `reference_start_sec REAL`
    - `reference_end_sec REAL`
    - `reference_excerpt TEXT`
    - `model_version TEXT NOT NULL` (e.g. `'fluid-audio-cam++-v1'`)
    - `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
    - `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`
  - **`speaker_voice_rejections`**:
    - `meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE`
    - `speaker TEXT NOT NULL` (e.g. `'Remote Speaker 1'`)
    - `person_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE`
    - `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
    - `PRIMARY KEY (meeting_id, speaker, person_id)`
    - Used so selecting "Not Alex" suppresses re-suggesting Alex for that turn in that meeting without corrupting Alex's persistent profile.

### 4. Enrollment Quality Gates
- Enrollment is strictly opt-in via an explicit user choice (`Remember this voice for future meetings`).
- Audio samples must come exclusively from non-overlapping System-audio intervals corresponding to the confirmed turn.
- The turn must meet quality thresholds: at least 2 distinct clean segments and >= 3.0 seconds of cumulative speech.
- Updating an existing profile calculates a weighted average of normalized embeddings and re-normalizes to unit length:
  $$\mathbf{v}_{\text{new}} = \frac{n_1 \mathbf{v}_1 + n_2 \mathbf{v}_2}{\|n_1 \mathbf{v}_1 + n_2 \mathbf{v}_2\|}$$

### 5. Matcher & Calibration Contract
- For a candidate cluster embedding $\mathbf{v}_{\text{cand}}$:
  1. Filter active voice profiles with matching `model_version`, excluding any `person_id` in `speaker_voice_rejections` for `(meetingId, speaker)`.
  2. Compute cosine similarity $s_i = \mathbf{v}_{\text{cand}} \cdot \mathbf{v}_i$.
  3. **Absolute Threshold:** Top candidate must have $s_{\text{top}} \ge 0.72$.
  4. **Margin Requirement:** Margin over the runner-up must satisfy $s_{\text{top}} - s_{\text{second}} \ge 0.10$. If the runner-up is within $0.10$, the match is flagged as ambiguous and suppressed.
  5. **Calendar Roster Prioritization:** If an enrolled person matches the meeting's calendar invitees, they are ranked higher among close scores, but must still independently satisfy $s \ge 0.72$ and margin $\ge 0.10$.
  6. Returns suggestion `{ personId, personName, confidence: s_top, referenceMeetingId, referenceStartSec, referenceEndSec, referenceExcerpt }` or `null`.

### 6. User Interface & Interaction Surfaces
- **Speaker Review Modal (`SpeakerIdentificationModal.tsx`)**:
  - Displays match suggestion banner: `Speaker 1 may be Alex` (`High match`).
  - Audio playback controls:
    - `Play current sample`: Slices and streams candidate turn from current meeting.
    - `Play reference sample`: Streams confirmed reference excerpt from Alex's profile source meeting.
  - Action buttons:
    - `Confirm Alex`: Creates meeting-scoped identity binding for Alex, updates People evidence, and auto-advances.
    - `Not Alex`: Records rejection in `speaker_voice_rejections`, clears suggestion, and returns to standard person search combobox.
  - Opt-in checkbox on confirmation:
    - `[ ] Remember this voice for future meetings` (shown when speaker meets enrollment quality gates).
- **Person Dossier (`PeopleTab.tsx`)**:
  - Voice profile section under Person details:
    - Displays status (`Remembered voice (Active)` or `Disabled`), sample count, and speech duration.
    - Listen to reference sample.
    - `Disable matching` / `Enable matching` toggle.
    - `Delete voice profile` button to permanently delete the stored embedding.
- **Settings (`IdentitySettings.tsx`)**:
  - Voice profiles management section: lists all enrolled people with active/disabled toggles, delete action, and local privacy explanation.

### 7. Lifecycle & Reversibility Rules
- **Person Rename:** Profile preserved via immutable entity ID.
- **Person Merge:** Destination person inherits the voice profile. If both have profiles, centroids are combined with running weight averages.
- **Person Deletion (`deleteEntity`):** Cascades deletion of `speaker_voice_profiles` and `speaker_voice_rejections`.
- **Meeting Deletion:** Mathematical embedding remains intact; reference audio playback displays "Reference recording unavailable".
- **Knowledge Base Reset (`resetKnowledgeBase`):** Truncates `speaker_voice_profiles` and `speaker_voice_rejections`.

## Verification

- **Offline / Unit Tests:**
  - Protocol tests for `SpeakerEvidenceOutput` cluster embeddings.
  - Diarization pipeline tests verifying `speakerClusterEmbeddings` association with `Remote Speaker N`.
  - Quality gate tests rejecting short utterances (< 3s), overlapping turns, and single-segment artifacts.
  - Calibration and matcher tests: repeat-speaker matches, unseen speakers, near-miss speakers with margin checks, calendar candidate prioritization, and rejection suppression.
  - Reversibility and lifecycle tests: person rename, merge, delete, meeting delete, and knowledge base reset.
- **UI Tests:**
  - `SpeakerIdentificationModal` rendering of suggestions, sample playback triggers, `Confirm`, `Not Alex`, and `Remember voice` checkbox.
  - `PeopleTab` dossier voice profile inspection, disable/enable, and delete actions.
