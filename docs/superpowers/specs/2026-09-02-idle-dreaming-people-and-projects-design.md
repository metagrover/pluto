# Design Spec: Idle Memory Dreaming for People and Projects

**Issue:** [#586](https://github.com/metagrover/pluto/issues/586)  
**Date:** 2026-09-02  
**Status:** Approved design; ready for implementation planning  

---

## 1. Problem & Context

Pluto's knowledge engine synthesizes intelligence from individual meetings. However, consolidating this knowledge across meetings into rich **People** and **Project** dossiers is currently split between manual reconciliation and on-demand synthesis (e.g., `discoverProjectInitiative` running when a user opens the Projects tab).

Running LLM synthesis on page open introduces noticeable latency, spinners, and CPU/GPU contention. Conversely, running background consolidation aggressively risks interfering with active meetings, hogging laptop battery, producing fan noise, or corrupting state if interrupted mid-stream. Furthermore, feeding raw transcripts (`transcript_json`) into local Ollama models is computationally prohibitive (15,000–40,000+ tokens per meeting).

## 2. Goals & Product Principles

1. **Foreground Always Wins (Zero-Interruption Guarantee)**:
   Dreaming only runs when the system is verifiably idle on AC power. Any foreground activity (meeting recording, post-meeting note processing, Ask Pluto query, or user keyboard/mouse input) preempts dreaming instantly (<50ms) via `AbortController`.
2. **Notes-First, Never Raw Transcripts**:
   Dreaming reads structured, distilled meeting notes (`enhanced_notes` and `analysis_json`), cutting context from ~30k tokens down to ~1k–2k tokens. This reduces local Ollama inference time, memory footprint, and thermal generation by over 90%.
3. **Single-Entity Incremental Work Units**:
   Work is queued and processed one entity at a time (one Project or one Person). Between entities, eligibility is re-verified. Generous per-entity timeouts (up to 3 minutes) ensure local models on slower hardware are not prematurely killed.
4. **Frictionless Additive Enrichment**:
   New milestones, executive summaries, and attributed commitments are automatically added to Project and People dossiers ahead of time. Opening a page is instantaneous (0ms model latency).
5. **User-Driven Accuracy Control ("Remove / Report Inaccurate")**:
   Users have complete control without upfront approval friction. Any synthesized milestone or fact can be removed with a single click ("Remove from project" / "Report inaccurate"), which records an immutable negative constraint so dreaming never re-adds it.
6. **Non-Destructive Alias Suggestions**:
   Identity merges (e.g., "Robert is Bob") are surfaced as subtle inline suggestion pills on the dossier rather than forced auto-merges, allowing the user to `[Merge]` or `[Keep Separate]`.

---

## 3. Architecture & Lifecycle

```text
               +--------------------------------------------+
               |         Meeting Finalized Event            |
               | (Dirty tags applied to People & Projects)  |
               +--------------------------------------------+
                                     |
                                     v
                        [ Dirty Entity Queue ]
                                     |
                                     v
               +--------------------------------------------+
               |         Idle Coordinator Check             |
               | - System idle >= 5 mins                    |
               | - AC wall power (not on battery)           |
               | - Thermal state 'nominal' or 'fair'        |
               | - knowledgeSynthesisPause locks == 0       |
               +--------------------------------------------+
                        |                          |
                (If Ineligible)             (If Eligible)
                        |                          |
                   [ Sleep 60s ]                   v
                                    +------------------------------+
                                    | Dequeue Exactly ONE Entity   |
                                    +------------------------------+
                                                   |
                                                   v
                                    +------------------------------+
                                    | Extract Notes-First Package  |
                                    | (enhanced_notes + constraints)|
                                    +------------------------------+
                                                   |
    User Activity / Meeting Start                  v
  ================================> +------------------------------+
   (controller.abort() <50ms)       | Invoke Local Ollama Stream   |
                                    | (qwen3.5 / phi4-mini)        |
                                    +------------------------------+
                                                   |
                                                   v
                                    +------------------------------+
                                    | Deterministic Validation     |
                                    | - Citation & Evidence check  |
                                    | - Negative constraint check  |
                                    +------------------------------+
                                                   |
                                                   v
                                    +------------------------------+
                                    | Transactional SQLite Commit  |
                                    | - Update dossier & snapshots |
                                    | - Stage alias suggestions    |
                                    +------------------------------+
```

### 3.1 Eligibility & Guardrails

The `IdleDreamingCoordinator` in the Electron main process checks system conditions before dequeuing any work:
- **Idle Threshold**: `powerMonitor.getSystemIdleTime() >= 300` (5 minutes of system-wide inactivity) and no Pluto renderer activity for 5 minutes.
- **Power Source**: `!powerMonitor.isOnBatteryPower()`. Automatic dreaming will not drain laptop battery.
- **Thermal State**: `powerMonitor.getCurrentThermalState()` in `['nominal', 'fair']`.
- **Foreground Locks**: All pause reasons in [`knowledgeSynthesisPause`](file:///Users/metagrover/Desktop/pluto/electron/knowledgeSynthesisPause.ts) must be zero:
  - `capture` (meeting in progress)
  - `transcription` (live or post-meeting transcription)
  - `downstream` (note/action item generation)
  - `ask_pluto_session` (user chatting with Ask Pluto)
  - `llm_active` (foreground model generation)

### 3.2 Instant Preemption Protocol

To guarantee zero latency impact on user operations:
1. Every Ollama HTTP request is passed an `AbortSignal` from an active `AbortController`.
2. The coordinator listens for:
   - `powerMonitor.on('user-did-become-active')`
   - IPC message for window focus / mouse move / keystroke in the renderer
   - Acquisition of any lock in `knowledgeSynthesisPause`
3. On any event, `controller.abort()` fires immediately (<50ms).
4. The running entity task is aborted without writing any changes to SQLite.
5. The entity remains marked dirty so it can be resumed during the next idle period.
6. The Ollama session is released.

---

## 4. Notes-First Data Flow & Prompt Contract

### 4.1 Input Package Assembly

For a dirty entity (e.g. Project `proj_123` or Person `person_456`):
1. **Existing Baseline**:
   - Current display title, headline, and executive summary.
   - Known active milestones and commitments.
2. **Unconsolidated Meeting Notes**:
   - Gathers meetings referencing this entity that have occurred since the entity was last consolidated.
   - Extracts sections from `enhanced_notes`:
     - Meeting Title & Date
     - Executive Overview
     - Key Decisions
     - Action Items & Attributed Commitments
3. **Negative Constraints (Corrections)**:
   - Fetches any previously dismissed facts, milestones, or rejected aliases from `entity_corrections` for this entity.

Total prompt context is bounded between 800 and 2,000 tokens.

### 4.2 Structured Output Schemas

#### For Projects:
```typescript
interface ProjectDreamingOutput {
  status: 'updated' | 'no_change';
  dossier_summary?: string;
  milestones?: Array<{
    name: string;
    status: 'planned' | 'in_progress' | 'completed';
    source_meeting_id: string;
    evidence_snippet: string;
  }>;
  associated_commitments?: Array<{
    task: string;
    owner_name: string;
    source_meeting_id: string;
  }>;
  suggested_aliases?: string[];
}
```

#### For People:
```typescript
interface PersonDreamingOutput {
  status: 'updated' | 'no_change';
  headline?: string;
  current_focus?: string;
  recent_collaborators?: string[];
  suggested_aliases?: string[];
}
```

### 4.3 Deterministic Validation Gate

Before any proposal is persisted:
- **Source Verification**: All `source_meeting_id` references must resolve to IDs provided in the input bundle.
- **Negative Constraint Filter**: Any milestone, commitment, or alias matching an entry in `entity_corrections` is automatically pruned.
- **No Hallucinated Identifiers**: The model only suggests string labels; SQLite entity IDs are managed deterministically by Pluto.

---

## 5. People & Project Page Integration

### 5.1 Zero-Wait Page Loading
- Removes on-mount synthesis triggers (e.g. replacing eager `discoverProjectInitiative` in [`ProjectsOverview.tsx`](file:///Users/metagrover/Desktop/pluto/src/components/features/projects/ProjectsOverview.tsx)).
- Pages read compiled state directly from SQLite (`entities`, `entity_milestones`, `working_memory_snapshots`), rendering in <10ms.

### 5.2 Frictionless Additions
- **Project Dossier** (`ProjectDossier.tsx`):
  - Displays pre-computed executive summary.
  - Automatically lists new milestones under `ProjectMilestones.tsx` with a clickable meeting badge (`From "Sprint Kickoff" — Aug 24`).
- **People Tab** (`PeopleTab.tsx`):
  - Automatically updates the person headline and recent focus areas.

### 5.3 User Corrections ("Remove / Report Inaccurate")
- Each milestone, commitment, and insight row features a subtle hover menu with:
  - **"Remove from project"**
  - **"Report inaccurate"**
- Triggering this action:
  1. Instantly deletes the item from the dossier.
  2. Inserts a row into `entity_corrections`:
     ```sql
     CREATE TABLE IF NOT EXISTS entity_corrections (
       id TEXT PRIMARY KEY,
       entity_id TEXT NOT NULL,
       item_type TEXT NOT NULL, -- 'milestone', 'commitment', 'alias', 'summary'
       fingerprint TEXT NOT NULL,
       reason TEXT,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP
     );
     ```
  3. All future dream runs for this entity load these fingerprints into negative constraints, preventing resurrection.

### 5.4 Non-Destructive Alias Banners
- When dreaming detects alternate naming (e.g. "Robert" for "Bob", "Payment Gateway" for "Billing V2"):
  - Renders an unobtrusive card at the top of the dossier:
    > 💡 **Suggested Alias**: 2 meetings refer to *"Robert"* who may be Bob.  
    > `[Merge]` &nbsp;&nbsp; `[Keep Separate]`
  - `[Merge]` links the alias via Pluto's existing `person_aliases` / `project_aliases`.
  - `[Keep Separate]` writes to `entity_corrections` so it is never suggested again.

---

## 6. Error Handling & Resilience

- **Preemption Handling**: An `AbortError` is treated as a normal operational event. No error toast is shown, no partial data is written, and the entity is left dirty for the next idle cycle.
- **Model Timeout**: A 3-minute timeout per entity prevents infinite hangs. If reached, the entity is skipped with a recorded failure count and exponential backoff.
- **Model Unloading**: Following completion or preemption, the coordinator issues an Ollama unload signal to ensure 5–6 GB of unified memory is freed when idle finishes.

---

## 7. Test & Verification Plan

### Automated Tests
1. **Idle & Preemption Suite (`tests/unit/dreamingCoordinator.test.ts`)**:
   - Coordinator does not run when `onBattery` is true.
   - Coordinator does not run when `thermalState` is `serious` or `critical`.
   - Coordinator aborts in-flight Ollama request within 50ms upon `user-did-become-active` or `knowledgeSynthesisPause.acquire('capture')`.
   - Entity remains dirty following an abort.
2. **Notes-First Packaging & Validation Suite (`tests/unit/dreamingValidation.test.ts`)**:
   - Correctly extracts `enhanced_notes` and excludes raw `transcript_json`.
   - Rejects payloads referencing invalid `source_meeting_id`.
   - Prunes items present in `entity_corrections`.
3. **UI & Removal Suite (`tests/unit/ProjectDossier.test.tsx`, `tests/unit/PeopleTab.test.tsx`)**:
   - Synthesized milestones render with meeting provenance links.
   - Clicking "Remove from project" removes the milestone and saves a correction row.
   - Alias suggestions render `[Merge]` and `[Keep Separate]` buttons correctly.
