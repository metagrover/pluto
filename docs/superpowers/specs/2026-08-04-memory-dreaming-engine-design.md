# Design Spec: Pluto Asynchronous Memory Dreaming Engine

**Issue:** [#586](https://github.com/metagrover/pluto/issues/586)  
**Author:** Antigravity  
**Date:** 2026-08-04  
**Status:** Approved  

---

## 1. Overview & Objectives

Pluto is an intelligent meeting assistant and second brain. Historically, Pluto extracted entities and knowledge graph edges point-in-time immediately after a single meeting finalized. Over weeks of usage across dozens of meetings, this point-in-time model exhibits three key limitations:

1. **Fragmented Summaries:** Entity summaries are collections of per-meeting snippets rather than a cohesive narrative across meetings.
2. **Outdated Temporal Facts:** Chronological updates (e.g., *"Target launch is Aug 10"* in Meeting 1 vs *"Launch delayed to Aug 25"* in Meeting 4) remain as conflicting quotes without state resolution.
3. **Graph Clutter & Duplicates:** Near-duplicate entity nodes (e.g., `"Q3 Roadmap"` and `"Q3-Planning"`) accumulate over time.

Inspired by OpenAI's **Memory Dreaming** architecture, the **Pluto Dreaming Engine** introduces an offline, asynchronous consolidation process that periodically re-analyzes accumulated interaction data and subgraphs to:
- Deduplicate and merge entity nodes.
- Reconcile temporal status transitions across meetings.
- Re-synthesize narrative entity and project profiles.
- Record all background modifications in a user-inspectable **Dream Log**.

---

## 2. Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ELECTRON MAIN PROCESS                           │
│                                                                        │
│   ┌───────────────────┐               ┌───────────────────────────┐    │
│   │   Idle Detector   │               │ Knowledge Workspace DB    │    │
│   │ (Power/Activity)  │               │  - nodes / edges / docs   │    │
│   └─────────┬─────────┘               │  - dreaming_runs & logs   │    │
│             │ (Trigger: Idle/Manual)  └─────────────▲─────────────┘    │
│             ▼                                       │ (Atomic Commit)  │
│   ┌─────────────────────────────────────────────────┴─────────────┐    │
│   │              Dreaming Processing Coordinator                  │    │
│   │                                                               │    │
│   │ ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐ │    │
│   │ │ Cluster Extractor│──►│ Synthesis Engine│──►│  Reconciler    │ │    │
│   │ │ (Dirty Subgraphs)│  │ (LLM / Prompts) │  │(Graph & Diffs) │ │    │
│   │ └──────────────────┘  └─────────────────┘  └────────────────┘ │    │
│   └───────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────▲───────────────────────────────────┘
                                     │ IPC: START_DREAMING_RUN / GET_DREAM_LOGS
┌────────────────────────────────────┴───────────────────────────────────┐
│                           REACT FRONTEND                               │
│                                                                        │
│   ┌───────────────────────────────────────────────────────────────┐    │
│   │ Knowledge Workspace UI                                        │    │
│   │  - "Consolidate Knowledge" Button                             │    │
│   │  - Dream Log Drawer (View Diffs, Undo Merges, Review Updates) │    │
│   └───────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

### Flow Sequence
1. **Trigger:** Idle monitor (10m inactivity on AC power) or manual button click in UI.
2. **Extraction:** `ClusterExtractor` finds entities/docs marked `dirty = 1` and isolates subgraphs.
3. **LLM Synthesis:** `DreamingSynthesisEngine` prompts LLM for temporal normalization, entity deduplication, and narrative re-synthesis.
4. **Reconciliation:** `GraphReconciler` transactionally updates graph nodes/edges and logs a `KnowledgeDreamingRun`.
5. **UI Notification:** Main process sends IPC event to React frontend to show a subtle toast and update the Dream Log Drawer.

---

## 3. Data Schemas & Models

### 3.1 Database Schema Additions

```sql
-- Track dirty status on entity nodes and docs
ALTER TABLE knowledge_nodes ADD COLUMN dirty INTEGER DEFAULT 1;
ALTER TABLE knowledge_docs ADD COLUMN dirty INTEGER DEFAULT 1;

-- Table to store historical dreaming runs
CREATE TABLE IF NOT EXISTS knowledge_dreaming_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL, -- 'idle' | 'manual'
  status TEXT NOT NULL,       -- 'running' | 'completed' | 'failed'
  clusters_processed INTEGER NOT NULL DEFAULT 0,
  nodes_merged_count INTEGER NOT NULL DEFAULT 0,
  edges_updated_count INTEGER NOT NULL DEFAULT 0,
  summaries_rewritten_count INTEGER NOT NULL DEFAULT 0,
  diff_json TEXT NOT NULL,   -- Structured diff payload
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
```

### 3.2 TypeScript Interfaces

```typescript
export type DreamingTriggerType = 'idle' | 'manual';
export type DreamingRunStatus = 'running' | 'completed' | 'failed';

export interface DreamingNodeMergeDiff {
  winnerId: string;
  loserId: string;
  mergedLabel: string;
  reassignedEdgeIds: string[];
}

export interface DreamingEdgeStatusDiff {
  edgeId: string;
  oldState: string;
  newState: string;
  reason: string;
}

export interface DreamingSummaryDiff {
  entityId: string;
  entityLabel: string;
  previousSentenceCount: number;
  newSentenceCount: number;
  updatedAt: string;
}

export interface KnowledgeDreamingDiffPayload {
  mergedNodes: DreamingNodeMergeDiff[];
  updatedEdges: DreamingEdgeStatusDiff[];
  rewrittenSummaries: DreamingSummaryDiff[];
}

export interface KnowledgeDreamingRun {
  id: string;
  triggerType: DreamingTriggerType;
  status: DreamingRunStatus;
  clustersProcessed: number;
  nodesMergedCount: number;
  edgesUpdatedCount: number;
  summariesRewrittenCount: number;
  diff: KnowledgeDreamingDiffPayload;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}
```

---

## 4. Main Process Components

### 4.1 `IdleMonitor` (`electron/dreaming/idleMonitor.ts`)
- Listens to Electron's `powerMonitor` state and mouse/keyboard idle timers.
- Triggers a dreaming run when:
  - App has been idle for >= 10 minutes.
  - Device is connected to AC power (battery safeguard).
  - No active recording/diarization call is currently running.

### 4.2 `ClusterExtractor` (`electron/dreaming/clusterExtractor.ts`)
- Queries database for `dirty = 1` nodes.
- For each dirty node, gathers its 1-hop connected neighbors and associated meeting transcript quotes.
- Groups connected components into discrete `EntityCluster` payloads for parallel or batch processing.

### 4.3 `DreamingSynthesisEngine` (`electron/dreaming/synthesisEngine.ts`)
- Constructs structured prompts for the LLM containing the entity cluster + transcript snippets.
- Instructs the LLM to output JSON adhering to strict schemas:
  - Identifies duplicate node pairs `(winner, loser)` to merge.
  - Identifies state transitions on edges (e.g. `proposed` -> `active` or `deprecated`).
  - Rewrites entity summaries as consolidated bullet points with explicit meeting source IDs.

### 4.4 `GraphReconciler` (`electron/dreaming/graphReconciler.ts`)
- Executes SQLite transaction:
  1. Merges target nodes (reassigns edges, marks loser node deleted).
  2. Updates edge states and confidence levels.
  3. Replaces `entity_summaries` records.
  4. Resets `dirty = 0` on processed nodes/docs.
  5. Inserts `knowledge_dreaming_runs` record.

---

## 5. UI Components (React)

### 5.1 "Consolidate Knowledge" Header Action (`src/components/knowledge/ConsolidateKnowledgeButton.tsx`)
- Located in the Knowledge Workspace header.
- Displays dreaming state (Idle, Consolidating..., Last consolidated 2h ago).
- Clicking manually triggers `START_DREAMING_RUN`.

### 5.2 `DreamLogDrawer` (`src/components/knowledge/DreamLogDrawer.tsx`)
- Slide-over drawer opening from Knowledge Workspace.
- Lists past `KnowledgeDreamingRun` items with timestamps, trigger type, and metrics.
- Expandable cards showing exact node merges, status changes, and rewritten summaries.
- Includes a **Revert Run** button allowing users to undo a dreaming pass if desired.

---

## 6. IPC Channel Contracts

| Channel Name | Direction | Payload | Return Value |
| :--- | :--- | :--- | :--- |
| `START_DREAMING_RUN` | Renderer → Main | `{ triggerType: 'manual' \| 'idle' }` | `Promise<KnowledgeDreamingRun>` |
| `GET_DREAMING_RUNS` | Renderer → Main | `{ limit?: number }` | `Promise<KnowledgeDreamingRun[]>` |
| `REVERT_DREAMING_RUN` | Renderer → Main | `{ runId: string }` | `Promise<{ success: boolean }>` |
| `DREAMING_RUN_PROGRESS` | Main → Renderer | `{ stage: string, progress: number }` | Event Stream |
| `DREAMING_RUN_COMPLETED` | Main → Renderer | `KnowledgeDreamingRun` | Event Stream |

---

## 7. Error Handling & Safeguards

1. **Battery Protection:** Automatically cancels or delays idle dreaming runs if laptop disconnects from power.
2. **Transaction Atomicity:** SQLite transaction rollbacks ensure database stays pristine if LLM call or reconciliation fails mid-flight.
3. **Recording Priority:** Immediate cancellation of dreaming run if a user starts recording a meeting.
4. **Reversibility:** Every dreaming run records an explicit inverse diff allowing single-click rollback.

---

## 8. Verification & Testing Strategy

1. **Unit Tests (Vitest):**
   - `ClusterExtractor.test.ts`: Verify dirty node grouping and boundary isolation.
   - `GraphReconciler.test.ts`: Verify node merge edge reassignment and diff generation.
   - `DreamingSynthesisEngine.test.ts`: Test JSON output validation and fallback handling.
2. **IPC Integration Tests:**
   - Test `START_DREAMING_RUN` and `REVERT_DREAMING_RUN` IPC flows.
3. **UI Component Verification:**
   - Verify `DreamLogDrawer` renders diff cards accurately and responds to revert clicks.
