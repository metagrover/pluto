# Project Starlight: Pluto Offline Intelligence & Knowledge Engine
**Product Requirements Document & Technical Specification**  
*Version 2.4 · Q3/Q4 Architecture Brief · Confidential / Internal*

---

## 1. Executive Summary & Objective

Project Starlight delivers Pluto's next-generation offline meeting assistant capabilities. The objective is to provide an executive-level second brain that captures, transcribes, and synthesizes conversations with zero cloud leakage, operating entirely on-device with sub-3-second note synthesis on Apple Silicon hardware.

In this phase, Pluto introduces **Reference Document Ingestion**, enabling users to attach project briefs, technical specs, and meeting agendas directly to specific meetings to ground and enrich LLM notes generation with exact domain context.

---

## 2. Team & Key Stakeholders

| Name | Role | Core Responsibilities |
| :--- | :--- | :--- |
| **Maya Lin** | Staff Platform Architect | SQLite persistence, junction schema design, vector indexing, and revision hashing. |
| **Alex Chen** | Lead Product Designer | Editorial meeting notes UX, zero-footprint attachment bar, and document inspector. |
| **David Rossi** | Native Audio Lead | CoreAudio ring-buffer synchronization, device switching resilience, and echo cancellation. |
| **Priya Sharma** | Machine Learning Lead | Whisper.cpp CoreML optimization, speaker diarization, and voiceprint clustering. |

---

## 3. Architecture & Technical Constraints

### 3.1 Local Artifacts Junction Pipeline
- **Database Schema**: Reference documents are linked to meetings via the `meeting_local_artifacts` junction table (`meeting_id` ↔ `artifact_id`) with cascading deletes on meeting or document removal.
- **Cache Invalidation & Revision Hashes**: Attaching or detaching an artifact computes a SHA-256 hash across both user notes and attached document text (`userNotesHash`). Any modification invalidates outdated cached synthesis runs, prompting the user to regenerate notes.
- **Context Window Budget**: To prevent prompt saturation on 8k/16k context local models, extracted text injected into the LLM synthesis prompt is capped at 48KB per meeting, prioritised by relevance and recency.

### 3.2 Supported File Formats & Extraction
- **Microsoft Word (`.docx`)**: Unzipped XML stream parser via JSZip extracting body paragraphs and tables.
- **Apple Pages (`.pages`)**: Native zip extraction inspecting protobuf index data and quick-look previews.
- **Portable Document Format (`.pdf`)**: Extracted via `unpdf` with page boundary normalisation and whitespace cleanup.
- **Plaintext & Markdown (`.md`, `.txt`)**: UTF-8 normalized stream ingestion.

### 3.3 Privacy & Grounding Guarantees
- Raw audio, transcripts, and attached document text must never leave the user's machine without explicit export actions.
- Notes synthesis must explicitly cite and ground claims in evidence: statements from attached documents are distinguished from spoken dialogue using `[Attached Document: <Title>]` markers.

---

## 4. Q3 Sprint Milestones & Deliverables

### Milestone 1: Document Ingestion & Impeccable Notes UI
- **Target Completion**: October 3, 2026
- **Owners**: Alex Chen & Maya Lin
- **Success Criteria**:
  - Zero-footprint empty state when no documents are attached.
  - Document attachment accessible via dropdown (`...` menu) and instant drag-and-drop on the notes surface.
  - Quiet inline badge row (`📎 Reference docs: [Word · PRD ✕] + Add`) with full-text inspection modal.

### Milestone 2: Audio Pipeline Hardware Resilience
- **Target Completion**: October 10, 2026
- **Owner**: David Rossi
- **Success Criteria**:
  - Seamless audio recovery during Bluetooth headphone disconnects without crashing recording streams.
  - Drift compensation under 15ms between system loopback and microphone input streams.

### Milestone 3: Speaker Diarization & Voice Matching
- **Target Completion**: October 17, 2026
- **Owner**: Priya Sharma
- **Success Criteria**:
  - CoreML Whisper.cpp inference time under 0.25x real-time on M2 Max / M3 Pro.
  - One-click speaker voice suggestion matching against historical voiceprint embeddings.

### Milestone 4: Production Packaging & Stress Testing
- **Target Completion**: October 24, 2026
- **Owners**: Full Engineering Team
- **Success Criteria**:
  - Memory consumption below 280MB during active 60-minute meeting recording.
  - SQLite ABI rebuild verification verified across Electron updates.

---

## 5. Key Decisions & Trade-Offs

1. **Inline Pill Row vs. Persistent Upload Card**:
   - *Decision*: Removed the persistent upload card in favor of a zero-footprint state that renders nothing until documents are attached, nesting the primary attachment action inside the `...` menu and supporting drag-and-drop.
   - *Rationale*: Meeting notes should feel like a calm executive brief; empty dropzones add unnecessary cognitive clutter to everyday meetings.

2. **Per-Meeting Attachments vs. Global Library**:
   - *Decision*: Adopted a junction model allowing documents to belong directly to specific meetings, while maintaining an overview in the Local Sources tab.
   - *Rationale*: Different meetings require distinct context (e.g., Sprint PRD vs. Legal Contract) without polluting the global LLM prompt.

---

## 6. Open Action Items & Risks

- [ ] **Risk 1 (High)**: Scanned or image-only PDFs will produce empty text extractions without OCR.
  - *Mitigation*: Fallback to Apple Vision framework text recognition planned for Q4.
- [ ] **Action Item (Maya)**: Benchmark SQLite junction query latency with > 500 attached artifacts.
- [ ] **Action Item (Priya)**: Quantize Whisper medium model to Q4_0 for 8GB RAM MacBook Air support.
- [ ] **Action Item (David)**: Implement auto-retry on audio ring buffer overflow events.
