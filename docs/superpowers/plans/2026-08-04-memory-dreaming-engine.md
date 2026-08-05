# Memory Dreaming Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an asynchronous background Memory Dreaming Engine that extracts dirty entity subgraphs, reconciles temporal state updates, deduplicates nodes, re-synthesizes narrative profiles across meetings, and exposes diffs in a React UI Dream Log Drawer.

**Architecture:** Electron main process coordinator coupled with SQLite schema updates (`dirty` flags, `knowledge_dreaming_runs`), LLM cluster synthesis, and React IPC channel bindings with single-click revert support.

**Tech Stack:** TypeScript, Electron, SQLite (knex/better-sqlite3), React, Vitest.

---

### Task 1: Database Migration and Type Definitions

**Files:**
- Modify: `src/api/knowledgeWorkspace.ts`
- Create: `electron/dreaming/types.ts`
- Test: `electron/dreaming/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test for Dreaming Types and Interfaces**

Create `electron/dreaming/__tests__/types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { KnowledgeDreamingRun, KnowledgeDreamingDiffPayload } from '../types';

describe('KnowledgeDreamingRun Type Structure', () => {
  it('instantiates valid dreaming run payload', () => {
    const diff: KnowledgeDreamingDiffPayload = {
      mergedNodes: [{ winnerId: 'n1', loserId: 'n2', mergedLabel: 'Project Titan', reassignedEdgeIds: ['e1'] }],
      updatedEdges: [{ edgeId: 'e1', oldState: 'proposed', newState: 'active', reason: 'Verified in meeting 2' }],
      rewrittenSummaries: [{ entityId: 'n1', entityLabel: 'Project Titan', previousSentenceCount: 1, newSentenceCount: 3, updatedAt: '2026-08-04T22:00:00Z' }],
    };

    const run: KnowledgeDreamingRun = {
      id: 'run-123',
      triggerType: 'idle',
      status: 'completed',
      clustersProcessed: 1,
      nodesMergedCount: 1,
      edgesUpdatedCount: 1,
      summariesRewrittenCount: 1,
      diff,
      startedAt: '2026-08-04T22:00:00Z',
      completedAt: '2026-08-04T22:01:00Z',
    };

    expect(run.status).toBe('completed');
    expect(run.diff.mergedNodes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test electron/dreaming/__tests__/types.test.ts`
Expected: FAIL with "Cannot find module '../types'"

- [ ] **Step 3: Create `electron/dreaming/types.ts`**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test electron/dreaming/__tests__/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/dreaming/types.ts electron/dreaming/__tests__/types.test.ts
git commit -m "feat(dreaming): add core dreaming types and schemas"
```

---

### Task 2: Dirty Cluster Extractor

**Files:**
- Create: `electron/dreaming/clusterExtractor.ts`
- Test: `electron/dreaming/__tests__/clusterExtractor.test.ts`

- [ ] **Step 1: Write failing test for `ClusterExtractor`**

Create `electron/dreaming/__tests__/clusterExtractor.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { groupDirtyNodesIntoClusters, EntityClusterInput } from '../clusterExtractor';

describe('ClusterExtractor', () => {
  it('groups connected dirty nodes into single cluster', () => {
    const nodes: EntityClusterInput['nodes'] = [
      { id: 'n1', label: 'Project Alpha', dirty: 1 },
      { id: 'n2', label: 'Alpha Launch', dirty: 1 },
      { id: 'n3', label: 'Unrelated Entity', dirty: 0 },
    ];
    const edges: EntityClusterInput['edges'] = [
      { id: 'e1', source_entity_id: 'n1', target_entity_id: 'n2' },
    ];

    const clusters = groupDirtyNodesIntoClusters(nodes, edges);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].nodes.map(n => n.id)).toEqual(['n1', 'n2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test electron/dreaming/__tests__/clusterExtractor.test.ts`
Expected: FAIL with "Cannot find module '../clusterExtractor'"

- [ ] **Step 3: Implement `electron/dreaming/clusterExtractor.ts`**

```typescript
export interface NodeMinimal {
  id: string;
  label: string;
  dirty: number;
}

export interface EdgeMinimal {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
}

export interface EntityClusterInput {
  nodes: NodeMinimal[];
  edges: EdgeMinimal[];
}

export interface EntityCluster {
  id: string;
  nodes: NodeMinimal[];
  edges: EdgeMinimal[];
}

export function groupDirtyNodesIntoClusters(
  nodes: NodeMinimal[],
  edges: EdgeMinimal[]
): EntityCluster[] {
  const dirtyNodes = nodes.filter(n => n.dirty === 1);
  if (dirtyNodes.length === 0) return [];

  const dirtyIds = new Set(dirtyNodes.map(n => n.id));
  const visited = new Set<string>();
  const clusters: EntityCluster[] = [];

  // Build adjacency list
  const adj = new Map<string, Set<string>>();
  for (const node of nodes) {
    adj.set(node.id, new Set());
  }
  for (const edge of edges) {
    adj.get(edge.source_entity_id)?.add(edge.target_entity_id);
    adj.get(edge.target_entity_id)?.add(edge.source_entity_id);
  }

  let clusterIdx = 1;
  for (const dirtyNode of dirtyNodes) {
    if (visited.has(dirtyNode.id)) continue;

    const clusterNodes: NodeMinimal[] = [];
    const queue = [dirtyNode.id];
    visited.add(dirtyNode.id);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const nodeObj = nodes.find(n => n.id === currentId);
      if (nodeObj) clusterNodes.push(nodeObj);

      const neighbors = adj.get(currentId) || new Set();
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId) && dirtyIds.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }

    const clusterNodeIds = new Set(clusterNodes.map(n => n.id));
    const clusterEdges = edges.filter(
      e => clusterNodeIds.has(e.source_entity_id) && clusterNodeIds.has(e.target_entity_id)
    );

    clusters.push({
      id: `cluster-${clusterIdx++}`,
      nodes: clusterNodes,
      edges: clusterEdges,
    });
  }

  return clusters;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test electron/dreaming/__tests__/clusterExtractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/dreaming/clusterExtractor.ts electron/dreaming/__tests__/clusterExtractor.test.ts
git commit -m "feat(dreaming): implement cluster extractor for dirty nodes"
```

---

### Task 3: Graph Reconciler and Rollback Engine

**Files:**
- Create: `electron/dreaming/graphReconciler.ts`
- Test: `electron/dreaming/__tests__/graphReconciler.test.ts`

- [ ] **Step 1: Write failing test for `GraphReconciler`**

Create `electron/dreaming/__tests__/graphReconciler.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { reconcileNodeMerge, ReconcileMergeInput } from '../graphReconciler';

describe('GraphReconciler', () => {
  it('calculates node merge diff correctly', () => {
    const input: ReconcileMergeInput = {
      winnerId: 'node-1',
      loserId: 'node-2',
      mergedLabel: 'Project Alpha',
      edges: [
        { id: 'e1', source_entity_id: 'node-2', target_entity_id: 'node-3' },
      ],
    };

    const diff = reconcileNodeMerge(input);
    expect(diff.winnerId).toBe('node-1');
    expect(diff.loserId).toBe('node-2');
    expect(diff.reassignedEdgeIds).toContain('e1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test electron/dreaming/__tests__/graphReconciler.test.ts`
Expected: FAIL with "Cannot find module '../graphReconciler'"

- [ ] **Step 3: Implement `electron/dreaming/graphReconciler.ts`**

```typescript
import type { DreamingNodeMergeDiff } from './types';

export interface ReconcileMergeInput {
  winnerId: string;
  loserId: string;
  mergedLabel: string;
  edges: Array<{ id: string; source_entity_id: string; target_entity_id: string }>;
}

export function reconcileNodeMerge(input: ReconcileMergeInput): DreamingNodeMergeDiff {
  const reassignedEdgeIds = input.edges
    .filter(e => e.source_entity_id === input.loserId || e.target_entity_id === input.loserId)
    .map(e => e.id);

  return {
    winnerId: input.winnerId,
    loserId: input.loserId,
    mergedLabel: input.mergedLabel,
    reassignedEdgeIds,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test electron/dreaming/__tests__/graphReconciler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/dreaming/graphReconciler.ts electron/dreaming/__tests__/graphReconciler.test.ts
git commit -m "feat(dreaming): implement graph reconciler logic"
```

---

### Task 4: React Dream Log Drawer UI Component

**Files:**
- Create: `src/components/knowledge/DreamLogDrawer.tsx`
- Test: `src/components/knowledge/__tests__/DreamLogDrawer.test.tsx`

- [ ] **Step 1: Write failing test for `DreamLogDrawer`**

Create `src/components/knowledge/__tests__/DreamLogDrawer.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DreamLogDrawer } from '../DreamLogDrawer';
import type { KnowledgeDreamingRun } from '../../../../electron/dreaming/types';

describe('DreamLogDrawer Component', () => {
  it('renders dreaming run list and metrics', () => {
    const mockRuns: KnowledgeDreamingRun[] = [
      {
        id: 'run-1',
        triggerType: 'idle',
        status: 'completed',
        clustersProcessed: 2,
        nodesMergedCount: 1,
        edgesUpdatedCount: 3,
        summariesRewrittenCount: 2,
        diff: { mergedNodes: [], updatedEdges: [], rewrittenSummaries: [] },
        startedAt: '2026-08-04T22:00:00Z',
      },
    ];

    render(<DreamLogDrawer isOpen={true} onClose={() => {}} runs={mockRuns} />);
    expect(screen.getByText(/Knowledge Consolidation History/i)).toBeInTheDocument();
    expect(screen.getByText(/Idle Consolidation/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test src/components/knowledge/__tests__/DreamLogDrawer.test.tsx`
Expected: FAIL with "Cannot find module '../DreamLogDrawer'"

- [ ] **Step 3: Implement `src/components/knowledge/DreamLogDrawer.tsx`**

```tsx
import React from 'react';
import type { KnowledgeDreamingRun } from '../../../electron/dreaming/types';

interface DreamLogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  runs: KnowledgeDreamingRun[];
  onRevertRun?: (runId: string) => void;
}

export const DreamLogDrawer: React.FC<DreamLogDrawerProps> = ({
  isOpen,
  onClose,
  runs,
  onRevertRun,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-zinc-900 border-l border-zinc-800 shadow-xl z-50 flex flex-col p-4 text-zinc-100">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <h2 className="text-lg font-semibold">Knowledge Consolidation History</h2>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-white px-2 py-1 rounded"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {runs.length === 0 ? (
          <p className="text-sm text-zinc-500">No dreaming consolidation runs recorded yet.</p>
        ) : (
          runs.map(run => (
            <div key={run.id} className="p-3 bg-zinc-800/60 rounded-lg border border-zinc-700/50 space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="capitalize px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                  {run.triggerType} Consolidation
                </span>
                <span className="text-zinc-400">
                  {new Date(run.startedAt).toLocaleTimeString()}
                </span>
              </div>

              <div className="text-xs text-zinc-300 grid grid-cols-2 gap-2 pt-1">
                <div>Nodes Merged: <span className="font-semibold text-white">{run.nodesMergedCount}</span></div>
                <div>Edges Updated: <span className="font-semibold text-white">{run.edgesUpdatedCount}</span></div>
                <div>Summaries: <span className="font-semibold text-white">{run.summariesRewrittenCount}</span></div>
                <div>Clusters: <span className="font-semibold text-white">{run.clustersProcessed}</span></div>
              </div>

              {onRevertRun && (
                <button
                  onClick={() => onRevertRun(run.id)}
                  className="w-full text-xs py-1 mt-2 text-red-400 hover:bg-red-950/40 rounded border border-red-800/40 transition-colors"
                >
                  Revert Consolidation Pass
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test src/components/knowledge/__tests__/DreamLogDrawer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/knowledge/DreamLogDrawer.tsx src/components/knowledge/__tests__/DreamLogDrawer.test.tsx
git commit -m "feat(ui): add DreamLogDrawer component for viewing consolidation diffs"
```

---

### Task 5: Memory Decay & Correction Feedback Integrator

**Files:**
- Create: `electron/dreaming/memoryDecay.ts`
- Test: `electron/dreaming/__tests__/memoryDecay.test.ts`

- [ ] **Step 1: Write failing test for `memoryDecay`**

Create `electron/dreaming/__tests__/memoryDecay.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calculateNodeDecay } from '../memoryDecay';

describe('Memory Decay Calculator', () => {
  it('decays saliency score based on unreferenced days', () => {
    const initialSaliency = 1.0;
    const daysUnreferenced = 10;
    const decayed = calculateNodeDecay(initialSaliency, daysUnreferenced);

    // 1.0 * (0.95 ^ 10) ≈ 0.5987
    expect(decayed.newSaliency).toBeCloseTo(0.5987, 3);
    expect(decayed.isArchived).toBe(false);
  });

  it('marks node as archived when saliency drops below threshold', () => {
    const initialSaliency = 0.15;
    const daysUnreferenced = 30;
    const decayed = calculateNodeDecay(initialSaliency, daysUnreferenced);

    expect(decayed.isArchived).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test electron/dreaming/__tests__/memoryDecay.test.ts`
Expected: FAIL with "Cannot find module '../memoryDecay'"

- [ ] **Step 3: Implement `electron/dreaming/memoryDecay.ts`**

```typescript
export interface DecayResult {
  newSaliency: number;
  isArchived: boolean;
}

export function calculateNodeDecay(
  currentSaliency: number,
  daysUnreferenced: number,
  archiveThreshold = 0.1
): DecayResult {
  const decayFactor = Math.pow(0.95, daysUnreferenced);
  const newSaliency = currentSaliency * decayFactor;
  return {
    newSaliency,
    isArchived: newSaliency < archiveThreshold,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test electron/dreaming/__tests__/memoryDecay.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/dreaming/memoryDecay.ts electron/dreaming/__tests__/memoryDecay.test.ts
git commit -m "feat(dreaming): implement memory decay calculation and archival logic"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-04-memory-dreaming-engine.md`.

