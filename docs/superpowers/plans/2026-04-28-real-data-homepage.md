# Real Data Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage's hardcoded sample sections with real, evidence-backed dashboard data from existing Pluto IPC/data pipelines.

**Architecture:** Add a pure renderer-side dashboard model builder in `src/components/features/dashboardModel.ts`, then add a small async loader in `src/components/features/useDashboardHome.ts` that calls existing APIs and feeds the model into `Dashboard.tsx`. Keep JSX mostly presentational: no sample names, no fake dates, no fake meeting/calendar claims.

**Tech Stack:** React 18, TypeScript, Vitest, Electron IPC wrappers, existing `src/api/*` modules.

---

## File Structure

- Create `src/components/features/dashboardModel.ts`
  - Owns display types and pure functions for turning raw meetings, entities, knowledge docs, workspace/project data, and recording state into a `DashboardHomeModel`.
- Create `src/components/features/useDashboardHome.ts`
  - Owns async loading and partial failure handling for existing APIs.
- Modify `src/components/features/Dashboard.tsx`
  - Renders `DashboardHomeModel` instead of hardcoded arrays/literals.
- Modify `src/App.tsx`
  - Passes `safeMeetings`, `setAskPlutoVisible`, and real dashboard state into `Dashboard`.
- Create `tests/unit/dashboardModel.test.ts`
  - Covers hero priority, empty fallback, document mapping, spotlight omission, and sample literal prevention.
- Modify `src/utils/browserIpcFallback.ts`
  - Adds fallback responses for dashboard IPC calls used by browser preview.

## Task 1: Dashboard Model Types And Hero Priority

**Files:**
- Create: `src/components/features/dashboardModel.ts`
- Test: `tests/unit/dashboardModel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/dashboardModel.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import type { KnowledgeDoc } from '../../src/api/knowledgeDocs';
import type { Entity } from '../../src/api/knowledgeGraph';
import type {
  KnowledgeProjectHealthCard,
  KnowledgeWorkspacePayload,
} from '../../src/api/knowledgeWorkspace';
import type { Meeting } from '../../src/types';
import { buildDashboardHomeModel } from '../../src/components/features/dashboardModel';

const makeMeeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'meeting-1',
  title: 'Architecture Review',
  created_at: '2026-04-27T18:00:00.000Z',
  started_at: '2026-04-27T17:30:00.000Z',
  enhanced_notes: 'We reviewed indexing rollout risks.',
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview: 'Indexing rollout is close, with launch risk around review.',
  }),
  ...overrides,
});

const makeAction = (overrides: Partial<Entity> = {}): Entity => ({
  id: 'action-1',
  type: 'action_item',
  name: 'Review indexing rollout',
  normalized_name: 'review indexing rollout',
  status: 'active',
  due_date: '2026-04-26T12:00:00.000Z',
  assigned_to: null,
  metadata: null,
  saliency_score: 0.8,
  domain_tag: 'work',
  created_at: '2026-04-25T10:00:00.000Z',
  updated_at: '2026-04-25T10:00:00.000Z',
  ...overrides,
});

const makeDoc = (overrides: Partial<KnowledgeDoc> = {}): KnowledgeDoc => ({
  id: 'doc-1',
  scope_type: 'project',
  scope_key: 'project-1',
  title: 'Indexing Rollout',
  rendered_content: null,
  structured_json: JSON.stringify({
    current_read: {
      headline: 'Search indexing is converging around the rollout plan.',
      source_count: 4,
    },
  }),
  config: null,
  status: 'up_to_date',
  last_synthesized_at: '2026-04-27T16:00:00.000Z',
  last_source_cursor: null,
  updated_at: '2026-04-27T16:00:00.000Z',
  ...overrides,
});

const makeProjectCard = (
  overrides: Partial<KnowledgeProjectHealthCard> = {},
): KnowledgeProjectHealthCard => ({
  doc_id: 'doc-1',
  project_id: 'project-1',
  title: 'Indexing Rollout',
  open_blockers: 1,
  dependency_count: 2,
  recent_changes: 3,
  staleness_days: 0,
  ...overrides,
});

const makeWorkspace = (
  overrides: Partial<KnowledgeWorkspacePayload> = {},
): KnowledgeWorkspacePayload => ({
  docs: [makeDoc()],
  selected_doc: makeDoc(),
  notes: null,
  graph: { nodes: [], edges: [] },
  timeline: [],
  backlinks: [],
  project_cards: [makeProjectCard()],
  ...overrides,
});

describe('buildDashboardHomeModel', () => {
  it('prioritizes an overdue action over the latest meeting in the hero', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [makeAction({ name: 'Ship privacy review' })],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    expect(model.hero.kind).toBe('overdue_action');
    expect(model.hero.title).toBe('1 overdue item');
    expect(model.hero.detail).toContain('Ship privacy review');
    expect(model.hero.action?.target).toBe('projects');
  });

  it('uses a stale action when there are no overdue actions', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [makeAction({ name: 'Revisit launch blockers' })],
      activeActions: [],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    expect(model.hero.kind).toBe('stale_action');
    expect(model.hero.detail).toContain('Revisit launch blockers');
  });

  it('falls back cleanly when no real data exists', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: null,
      graphStats: null,
    });

    expect(model.hero.kind).toBe('default');
    expect(model.latestMeeting.state).toBe('empty');
    expect(model.actionInsights.state).toBe('empty');
    expect(model.knowledgeDocuments.state).toBe('empty');
    expect(model.spotlight).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest run tests/unit/dashboardModel.test.ts
```

Expected: FAIL because `../../src/components/features/dashboardModel` does not exist.

- [ ] **Step 3: Implement the minimal dashboard model**

Create `src/components/features/dashboardModel.ts` with:

```ts
import type { KnowledgeDoc } from '../../api/knowledgeDocs';
import type {
  Entity,
  KnowledgeGraphStats,
} from '../../api/knowledgeGraph';
import type {
  KnowledgeProjectHealthCard,
  KnowledgeWorkspacePayload,
} from '../../api/knowledgeWorkspace';
import type { Meeting } from '../../types';

export type DashboardTarget = 'ask' | 'meeting' | 'projects' | 'wiki';

export interface DashboardAction {
  label: string;
  target: DashboardTarget;
  meetingId?: string | number;
}

export type DashboardHeroKind =
  | 'recording'
  | 'overdue_action'
  | 'stale_action'
  | 'latest_meeting'
  | 'stale_doc'
  | 'default';

export interface DashboardHero {
  kind: DashboardHeroKind;
  title: string;
  detail: string;
  severity: 'live' | 'urgent' | 'watch' | 'calm';
  action?: DashboardAction;
}

export interface DashboardMeetingBrief {
  state: 'populated' | 'empty';
  title: string;
  detail: string;
  meetingId?: string | number;
}

export interface DashboardActionInsight {
  id: string;
  title: string;
  dueLabel: string;
  status: 'overdue' | 'stale' | 'active';
  sourceLabel: string;
}

export interface DashboardActionInsightsSection {
  state: 'populated' | 'empty';
  items: DashboardActionInsight[];
}

export interface DashboardSpotlight {
  title: string;
  subtitle: string;
  detail: string;
  tags: string[];
  target: DashboardTarget;
}

export interface DashboardDocumentCard {
  id: string;
  title: string;
  description: string;
  countLabel: string;
  status: KnowledgeDoc['status'];
  scopeType: KnowledgeDoc['scope_type'];
}

export interface DashboardDocumentSection {
  state: 'populated' | 'empty';
  items: DashboardDocumentCard[];
}

export interface DashboardHomeModel {
  hero: DashboardHero;
  quickActions: DashboardAction[];
  latestMeeting: DashboardMeetingBrief;
  actionInsights: DashboardActionInsightsSection;
  spotlight: DashboardSpotlight | null;
  knowledgeDocuments: DashboardDocumentSection;
}

export interface BuildDashboardHomeModelInput {
  isRecording: boolean;
  meetings: Meeting[];
  overdueActions: Entity[];
  staleActions: Entity[];
  activeActions: Entity[];
  workspace: KnowledgeWorkspacePayload | null;
  graphStats: KnowledgeGraphStats | null;
}

const formatDate = (value: string | null | undefined): string => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const latestMeetingDate = (meeting: Meeting): string =>
  meeting.started_at || meeting.created_at;

const extractMeetingOverview = (meeting: Meeting): string => {
  if (meeting.analysis_json) {
    try {
      const parsed = JSON.parse(meeting.analysis_json) as { overview?: unknown };
      if (typeof parsed.overview === 'string' && parsed.overview.trim()) {
        return parsed.overview.trim();
      }
    } catch {
      // Fall back to notes below.
    }
  }
  return (
    meeting.enhanced_notes?.split('\n').find((line) => line.trim())?.trim() ||
    'Open the latest meeting to review captured context.'
  );
};

const actionDueLabel = (action: Entity): string => {
  if (!action.due_date) return 'No due date';
  return formatDate(action.due_date);
};

const buildHero = ({
  isRecording,
  meetings,
  overdueActions,
  staleActions,
  workspace,
}: BuildDashboardHomeModelInput): DashboardHero => {
  if (isRecording) {
    return {
      kind: 'recording',
      title: 'Capturing intelligence',
      detail: 'Pluto is listening and building meeting context now.',
      severity: 'live',
    };
  }

  if (overdueActions.length > 0) {
    const first = overdueActions[0];
    return {
      kind: 'overdue_action',
      title: `${overdueActions.length} overdue item${overdueActions.length === 1 ? '' : 's'}`,
      detail: first.name,
      severity: 'urgent',
      action: { label: 'Open projects', target: 'projects' },
    };
  }

  if (staleActions.length > 0) {
    const first = staleActions[0];
    return {
      kind: 'stale_action',
      title: `${staleActions.length} stale item${staleActions.length === 1 ? '' : 's'}`,
      detail: first.name,
      severity: 'watch',
      action: { label: 'Review actions', target: 'projects' },
    };
  }

  if (meetings.length > 0) {
    const latest = meetings[0];
    return {
      kind: 'latest_meeting',
      title: 'Latest meeting ready',
      detail: latest.title || 'Untitled meeting',
      severity: 'calm',
      action: {
        label: 'Review meeting',
        target: 'meeting',
        meetingId: latest.id,
      },
    };
  }

  const staleDoc = workspace?.docs.find((doc) => doc.status === 'stale');
  if (staleDoc) {
    return {
      kind: 'stale_doc',
      title: 'Knowledge needs refresh',
      detail: staleDoc.title,
      severity: 'watch',
      action: { label: 'Open knowledge', target: 'wiki' },
    };
  }

  return {
    kind: 'default',
    title: 'Good to go',
    detail: 'Record a meeting to start building your live second brain.',
    severity: 'calm',
  };
};

const buildLatestMeeting = (meetings: Meeting[]): DashboardMeetingBrief => {
  const latest = meetings[0];
  if (!latest) {
    return {
      state: 'empty',
      title: 'No meetings yet',
      detail: 'Record a session to populate the latest meeting brief.',
    };
  }
  return {
    state: 'populated',
    title: latest.title || 'Untitled meeting',
    detail: `${formatDate(latestMeetingDate(latest))} · ${extractMeetingOverview(latest)}`,
    meetingId: latest.id,
  };
};

const toActionInsight = (
  action: Entity,
  status: DashboardActionInsight['status'],
): DashboardActionInsight => ({
  id: action.id,
  title: action.name,
  dueLabel: actionDueLabel(action),
  status,
  sourceLabel: action.domain_tag || 'Knowledge graph',
});

const buildActionInsights = (
  overdueActions: Entity[],
  staleActions: Entity[],
  activeActions: Entity[],
): DashboardActionInsightsSection => {
  const seen = new Set<string>();
  const items = [
    ...overdueActions.map((action) => toActionInsight(action, 'overdue')),
    ...staleActions.map((action) => toActionInsight(action, 'stale')),
    ...activeActions.map((action) => toActionInsight(action, 'active')),
  ].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return items.length > 0
    ? { state: 'populated', items: items.slice(0, 5) }
    : { state: 'empty', items: [] };
};

const parseDocDescription = (doc: KnowledgeDoc): string => {
  if (doc.structured_json) {
    try {
      const parsed = JSON.parse(doc.structured_json) as {
        current_read?: { headline?: unknown; source_count?: unknown };
      };
      const headline = parsed.current_read?.headline;
      if (typeof headline === 'string' && headline.trim()) {
        return headline.trim();
      }
    } catch {
      // Fall through to rendered content.
    }
  }
  return (
    doc.rendered_content?.split('\n').find((line) => line.trim())?.trim() ||
    `Updated ${formatDate(doc.updated_at)}`
  );
};

const buildKnowledgeDocuments = (
  workspace: KnowledgeWorkspacePayload | null,
): DashboardDocumentSection => {
  const docs = workspace?.docs || [];
  const cards = docs.slice(0, 4).map((doc): DashboardDocumentCard => {
    const projectCard = workspace?.project_cards.find(
      (card) => card.doc_id === doc.id,
    );
    const countLabel = projectCard
      ? `${projectCard.open_blockers} blockers · ${projectCard.dependency_count} dependencies`
      : doc.last_synthesized_at
        ? `Synthesized ${formatDate(doc.last_synthesized_at)}`
        : `Updated ${formatDate(doc.updated_at)}`;
    return {
      id: doc.id,
      title: doc.title,
      description: parseDocDescription(doc),
      countLabel,
      status: doc.status,
      scopeType: doc.scope_type,
    };
  });

  return cards.length > 0
    ? { state: 'populated', items: cards }
    : { state: 'empty', items: [] };
};

const buildSpotlight = (
  workspace: KnowledgeWorkspacePayload | null,
): DashboardSpotlight | null => {
  const projectCard = workspace?.project_cards.find(
    (card) =>
      card.open_blockers > 0 ||
      card.dependency_count > 0 ||
      card.recent_changes > 0 ||
      card.staleness_days > 0,
  );
  if (!projectCard) return null;
  return {
    title: projectCard.title,
    subtitle: 'Project spotlight',
    detail: `${projectCard.open_blockers} blockers, ${projectCard.dependency_count} dependencies, ${projectCard.recent_changes} recent changes.`,
    tags: [
      `${projectCard.staleness_days}d since synthesis`,
      `${projectCard.dependency_count} dependencies`,
    ],
    target: 'wiki',
  };
};

const buildQuickActions = (
  meetings: Meeting[],
  actionInsights: DashboardActionInsightsSection,
  workspace: KnowledgeWorkspacePayload | null,
): DashboardAction[] => {
  const actions: DashboardAction[] = [{ label: 'Ask Pluto', target: 'ask' }];
  if (meetings[0]) {
    actions.push({
      label: 'Review latest',
      target: 'meeting',
      meetingId: meetings[0].id,
    });
  }
  if (actionInsights.items.length > 0 || workspace?.project_cards.length) {
    actions.push({ label: 'Open projects', target: 'projects' });
  }
  if ((workspace?.docs.length || 0) > 0) {
    actions.push({ label: 'Knowledge home', target: 'wiki' });
  }
  return actions.slice(0, 4);
};

export const buildDashboardHomeModel = (
  input: BuildDashboardHomeModelInput,
): DashboardHomeModel => {
  const latestMeeting = buildLatestMeeting(input.meetings);
  const actionInsights = buildActionInsights(
    input.overdueActions,
    input.staleActions,
    input.activeActions,
  );
  return {
    hero: buildHero(input),
    quickActions: buildQuickActions(
      input.meetings,
      actionInsights,
      input.workspace,
    ),
    latestMeeting,
    actionInsights,
    spotlight: buildSpotlight(input.workspace),
    knowledgeDocuments: buildKnowledgeDocuments(input.workspace),
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm vitest run tests/unit/dashboardModel.test.ts
```

Expected: PASS for the three tests in `dashboardModel.test.ts`.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/features/dashboardModel.ts tests/unit/dashboardModel.test.ts
git commit -m "feat: add real data dashboard model"
```

If the pre-commit audit fails on existing dependency advisories, record the audit failure in the task notes before deciding whether to commit with `--no-verify`.

## Task 2: Document Mapping, Spotlight Omission, And Sample Literal Guard

**Files:**
- Modify: `tests/unit/dashboardModel.test.ts`
- Modify: `src/components/features/dashboardModel.ts`

- [ ] **Step 1: Add failing tests for document cards and sample literals**

Append these tests inside the existing `describe('buildDashboardHomeModel', () => { ... })` block in `tests/unit/dashboardModel.test.ts`:

```ts
  it('maps real knowledge docs and project health into document cards', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        docs: [
          makeDoc({
            id: 'doc-real',
            title: 'Search Launch Plan',
            structured_json: JSON.stringify({
              current_read: {
                headline: 'Launch readiness depends on search index signoff.',
              },
            }),
          }),
        ],
        project_cards: [
          makeProjectCard({
            doc_id: 'doc-real',
            open_blockers: 2,
            dependency_count: 4,
          }),
        ],
      }),
      graphStats: null,
    });

    expect(model.knowledgeDocuments.state).toBe('populated');
    expect(model.knowledgeDocuments.items[0]).toMatchObject({
      id: 'doc-real',
      title: 'Search Launch Plan',
      description: 'Launch readiness depends on search index signoff.',
      countLabel: '2 blockers · 4 dependencies',
    });
  });

  it('omits contextual spotlight when workspace has no real signal', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace({
        project_cards: [
          makeProjectCard({
            open_blockers: 0,
            dependency_count: 0,
            recent_changes: 0,
            staleness_days: 0,
          }),
        ],
      }),
      graphStats: null,
    });

    expect(model.spotlight).toBeNull();
  });

  it('does not emit the old hardcoded sample literals', () => {
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: makeWorkspace(),
      graphStats: null,
    });

    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain('Sarah Chen');
    expect(serialized).not.toContain('Product Alignment');
    expect(serialized).not.toContain('Finalize Schema');
    expect(serialized).not.toContain('API Migration Space');
  });
```

- [ ] **Step 2: Run tests to verify failures if needed**

Run:

```bash
pnpm vitest run tests/unit/dashboardModel.test.ts
```

Expected: PASS if Task 1 already included this behavior, or FAIL with a specific mismatch in `knowledgeDocuments`, `spotlight`, or sample literal behavior. If tests pass immediately, keep them because they guard the intended behavior.

- [ ] **Step 3: Adjust implementation only if tests fail**

If the tests fail, make these exact updates in `src/components/features/dashboardModel.ts`:

```ts
const buildSpotlight = (
  workspace: KnowledgeWorkspacePayload | null,
): DashboardSpotlight | null => {
  const projectCard = workspace?.project_cards.find(
    (card) =>
      card.open_blockers > 0 ||
      card.dependency_count > 0 ||
      card.recent_changes > 0 ||
      card.staleness_days > 0,
  );
  if (!projectCard) return null;
  return {
    title: projectCard.title,
    subtitle: 'Project spotlight',
    detail: `${projectCard.open_blockers} blockers, ${projectCard.dependency_count} dependencies, ${projectCard.recent_changes} recent changes.`,
    tags: [
      `${projectCard.staleness_days}d since synthesis`,
      `${projectCard.dependency_count} dependencies`,
    ],
    target: 'wiki',
  };
};
```

Ensure `buildKnowledgeDocuments` uses `doc.title`, parsed `current_read.headline`, and matching `project_cards` rather than sample literals.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm vitest run tests/unit/dashboardModel.test.ts
```

Expected: PASS for all dashboard model tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/components/features/dashboardModel.ts tests/unit/dashboardModel.test.ts
git commit -m "test: cover dashboard document and spotlight mapping"
```

If Task 1 and Task 2 are implemented in one edit because Task 1 already included all behavior, combine this commit with Task 1 and note that Task 2 had no additional production diff.

## Task 3: Async Dashboard Loader

**Files:**
- Create: `src/components/features/useDashboardHome.ts`
- Modify: `src/utils/browserIpcFallback.ts`

- [ ] **Step 1: Create the loader hook**

Create `src/components/features/useDashboardHome.ts` with:

```ts
import { useEffect, useState } from 'react';

import {
  getActionItemsByStatus,
  getKnowledgeGraphStats,
  getOverdueActionItems,
  getStaleActionItems,
} from '../../api/knowledgeGraph';
import { getKnowledgeWorkspace } from '../../api/knowledgeWorkspace';
import type { Meeting } from '../../types';
import {
  buildDashboardHomeModel,
  type DashboardHomeModel,
} from './dashboardModel';

export interface DashboardHomeState {
  model: DashboardHomeModel;
  loading: boolean;
  error: string | null;
}

interface UseDashboardHomeParams {
  isRecording: boolean;
  meetings: Meeting[];
}

const loadOptional = async <T>(
  loader: () => Promise<T>,
  fallback: T,
  label: string,
): Promise<T> => {
  try {
    return await loader();
  } catch (error) {
    console.error(`[Dashboard] Failed to load ${label}`, error);
    return fallback;
  }
};

export const useDashboardHome = ({
  isRecording,
  meetings,
}: UseDashboardHomeParams): DashboardHomeState => {
  const [state, setState] = useState<DashboardHomeState>(() => ({
    model: buildDashboardHomeModel({
      isRecording,
      meetings,
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      workspace: null,
      graphStats: null,
    }),
    loading: true,
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState((prev) => ({
        ...prev,
        model: buildDashboardHomeModel({
          isRecording,
          meetings,
          overdueActions: [],
          staleActions: [],
          activeActions: [],
          workspace: null,
          graphStats: null,
        }),
        loading: true,
        error: null,
      }));

      const [overdueActions, staleActions, activeActions, workspace, graphStats] =
        await Promise.all([
          loadOptional(getOverdueActionItems, [], 'overdue actions'),
          loadOptional(() => getStaleActionItems(7), [], 'stale actions'),
          loadOptional(
            () => getActionItemsByStatus('active'),
            [],
            'active actions',
          ),
          loadOptional(getKnowledgeWorkspace, null, 'knowledge workspace'),
          loadOptional(getKnowledgeGraphStats, null, 'graph stats'),
        ]);

      if (cancelled) return;

      setState({
        model: buildDashboardHomeModel({
          isRecording,
          meetings,
          overdueActions,
          staleActions,
          activeActions,
          workspace,
          graphStats,
        }),
        loading: false,
        error: null,
      });
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [isRecording, meetings]);

  return state;
};
```

- [ ] **Step 2: Add browser preview fallbacks**

In `src/utils/browserIpcFallback.ts`, add cases to the `switch (channel)` block:

```ts
    case 'GET_OVERDUE_ACTION_ITEMS':
    case 'GET_STALE_ACTION_ITEMS':
    case 'GET_ACTION_ITEMS_BY_STATUS':
      result = [];
      break;
    case 'GET_KNOWLEDGE_GRAPH_STATS':
      result = {
        total_entities: 0,
        by_type: {
          person: 0,
          topic: 0,
          action_item: 0,
          decision: 0,
          project: 0,
        },
        total_links: 0,
        total_meeting_connections: 0,
      };
      break;
```

Place the action item cases near `GET_MEETINGS`, and place `GET_KNOWLEDGE_GRAPH_STATS` near other knowledge cases.

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: PASS. If it fails because of existing unrelated worktree changes, record the first unrelated error and still fix any errors introduced by `useDashboardHome.ts`.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/components/features/useDashboardHome.ts src/utils/browserIpcFallback.ts
git commit -m "feat: load dashboard data from real pipelines"
```

## Task 4: Wire Dashboard UI To The Model

**Files:**
- Modify: `src/components/features/Dashboard.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update Dashboard props and imports**

At the top of `src/components/features/Dashboard.tsx`, import model types and hook:

```ts
import type {
  DashboardAction,
  DashboardHomeModel,
  DashboardTarget,
} from './dashboardModel';
```

Replace `DashboardProps` with:

```ts
interface DashboardProps {
  model: DashboardHomeModel;
  loading: boolean;
  isRecording: boolean;
  setSelectedMeetingId: (id: string | number | null) => void;
  setActiveTab: (tab: 'hub' | 'people' | 'projects' | 'wiki') => void;
  setAskPlutoVisible: (visible: boolean) => void;
  completedTasks: Set<string>;
  handleCompleteTask: (id: string) => void;
}
```

Add this helper inside the component before `return`:

```ts
  const runAction = (action: DashboardAction) => {
    if (action.target === 'ask') {
      setAskPlutoVisible(true);
      return;
    }
    if (action.target === 'meeting') {
      setSelectedMeetingId(action.meetingId || null);
      return;
    }
    setActiveTab(action.target);
  };
```

- [ ] **Step 2: Replace hero literals**

In `Dashboard.tsx`, replace all `intelligence.*` reads with `model.hero.*`.

Use:

```tsx
<h1 className="text-4xl font-black heading-premium tracking-tight text-pro-text-main leading-tight">
  {model.hero.title}
</h1>
<p className="text-xl text-pro-text-muted font-medium leading-relaxed">
  {model.hero.detail}
</p>
{model.hero.action && (
  <div className="pt-4 flex items-center gap-4">
    <button
      type="button"
      onClick={() => runAction(model.hero.action!)}
      className="px-8 py-3.5 rounded-full bg-white dark:bg-pro-surface text-pro-text-main dark:text-pro-text-main font-black text-[11px] uppercase tracking-[.15em] shadow-premium hover:bg-white/90 dark:hover:bg-pro-surface/80 hover:scale-[1.02] transition-all active-push border border-pro-border/40 dark:border-pro-border/50"
    >
      {model.hero.action.label}
    </button>
  </div>
)}
```

Remove the "Ignore for now" button because it has no real action.

- [ ] **Step 3: Replace quick action chips**

Replace the hardcoded quick action array with:

```tsx
{model.quickActions.map((action) => (
  <button
    type="button"
    key={`${action.target}-${action.label}`}
    onClick={() => runAction(action)}
    className="px-5 py-2.5 rounded-full bg-pro-surface border border-pro-border shadow-sm hover:border-pro-accent/40 hover:scale-[1.02] transition-all active-push flex items-center gap-2 group"
  >
    <span className="text-[10px] font-black uppercase tracking-widest text-pro-text-main opacity-60 group-hover:opacity-100">
      {action.label}
    </span>
  </button>
))}
```

- [ ] **Step 4: Replace Coming Up Next with Latest Meeting Brief**

In the first large card, change the badge to `Latest Meeting Brief`, use `model.latestMeeting.title`, `model.latestMeeting.detail`, and wire the button to open the meeting when `model.latestMeeting.meetingId` exists:

```tsx
<span className="text-[10px] font-black text-pro-accent uppercase tracking-[0.2em] bg-pro-accent/5 px-3 py-1.5 rounded-full">
  Latest Meeting Brief
</span>
...
<h3 className="text-2xl md:text-3xl font-black tracking-tight leading-tight">
  {model.latestMeeting.title}
</h3>
<p className="text-[12px] text-pro-text-muted font-bold opacity-40 mt-1 uppercase tracking-widest">
  {model.latestMeeting.state === 'populated' ? 'Real meeting context' : 'No meeting context yet'}
</p>
...
<p className="text-[14px] font-bold text-pro-text-main leading-relaxed italic line-height-extra">
  {model.latestMeeting.detail}
</p>
...
<button
  type="button"
  disabled={!model.latestMeeting.meetingId}
  onClick={() => setSelectedMeetingId(model.latestMeeting.meetingId || null)}
  className="flex-1 py-4 rounded-xl bg-[#1E1F24] text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl hover:bg-pro-accent transition-all active-push disabled:opacity-40 disabled:cursor-default"
>
  Review Meeting
</button>
```

- [ ] **Step 5: Replace Action Insights hardcoded array**

Replace the inline action list with `model.actionInsights.items`. If the section is empty, render:

```tsx
<div className="h-full min-h-[220px] flex items-center justify-center text-center px-6">
  <p className="text-[11px] font-bold text-pro-text-muted/40 uppercase tracking-widest leading-relaxed">
    No overdue or stale actions in the knowledge graph.
  </p>
</div>
```

For populated items, map each item:

```tsx
{model.actionInsights.items.map((item) => {
  const isDone = completedTasks.has(item.id);
  return (
    <div
      key={item.id}
      onClick={(e) => {
        e.stopPropagation();
        handleCompleteTask(item.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          handleCompleteTask(item.id);
        }
      }}
      className={`group/item p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-4 ${isDone ? 'bg-pro-success/5 border-pro-success/20 opacity-60 scale-[0.98] success-ring' : 'hover:border-pro-border/20 hover:bg-pro-surface border-transparent'}`}
    >
      <div className={`w-6 h-6 rounded-lg border-2 mt-0.5 flex items-center justify-center transition-all ${isDone ? 'bg-pro-success border-pro-success' : 'border-pro-border group-hover/item:border-pro-accent'}`}>
        {isDone && <span className="text-white text-[10px]">✓</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start gap-2 mb-1">
          <span className={`text-[13px] font-bold leading-tight truncate transition-all ${isDone ? 'line-through text-pro-text-muted' : 'text-pro-text-main'}`}>
            {item.title}
          </span>
          {!isDone && (
            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 shadow-sm ${item.status === 'overdue' ? 'bg-pro-urgent pulse-urgent' : item.status === 'stale' ? 'bg-pro-warning' : 'bg-pro-accent/20'}`} />
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold text-pro-text-muted/30 uppercase tracking-widest">
            {item.dueLabel}
          </span>
          <span className="text-[9px] font-bold text-pro-accent/40 uppercase tracking-widest">
            {item.sourceLabel}
          </span>
        </div>
      </div>
    </div>
  );
})}
```

- [ ] **Step 6: Conditionally render Contextual Spotlight**

Wrap the contextual spotlight block with:

```tsx
{model.spotlight && (
  <div className="col-span-12 bg-pro-bg border border-pro-border rounded-[2.5rem] p-10 relative overflow-hidden group hover:border-pro-accent/40 card-hover-effect">
    ...
  </div>
)}
```

Replace all Sarah-specific text with:

```tsx
{model.spotlight.title}
{model.spotlight.subtitle}
{model.spotlight.detail}
{model.spotlight.tags.map((tag) => (
  <span key={tag} className="px-3 py-1.5 bg-pro-surface border border-pro-border rounded-lg text-[9px] font-black text-pro-text-main/60 uppercase tracking-tight">
    {tag}
  </span>
))}
```

Set the primary spotlight action to `onClick={() => setActiveTab(model.spotlight!.target)}`.

- [ ] **Step 7: Replace Live Intelligence Documents**

Replace the hardcoded four-card array with `model.knowledgeDocuments.items`. If empty, render one full-width empty state:

```tsx
<div className="md:col-span-2 xl:col-span-4 glass-card border border-pro-border rounded-[2rem] p-8 text-center">
  <p className="text-[11px] text-pro-text-muted font-bold uppercase tracking-widest">
    Recorded meetings will populate live intelligence documents here.
  </p>
</div>
```

For populated cards:

```tsx
{model.knowledgeDocuments.items.map((item) => (
  <button
    type="button"
    key={item.id}
    onClick={() => setActiveTab('wiki')}
    className="text-left glass-card border border-pro-border rounded-[2rem] p-8 space-y-6 hover:border-pro-accent/40 transition-all group card-hover-effect"
  >
    <div className="w-12 h-12 rounded-2xl bg-pro-surface border border-pro-border flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-soft">
      {item.scopeType === 'person_context' ? '👤' : item.scopeType === 'project' ? '📁' : '🧠'}
    </div>
    <div className="space-y-2">
      <h4 className="text-[14px] font-black tracking-tight leading-loose uppercase">
        {item.title}
      </h4>
      <p className="text-[11px] text-pro-text-muted font-bold leading-relaxed opacity-60 line-clamp-2">
        {item.description}
      </p>
    </div>
    <div className="pt-4 border-t border-pro-border/10 flex items-center justify-between">
      <span className="text-[9px] font-black text-pro-accent uppercase tracking-widest">
        {item.countLabel}
      </span>
      <span className="text-pro-text-muted/40 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
        →
      </span>
    </div>
  </button>
))}
```

- [ ] **Step 8: Wire App to the hook**

In `src/App.tsx`, import:

```ts
import { useDashboardHome } from './components/features/useDashboardHome';
```

After `const intelligence = getProactiveIntelligence();`, remove the unused `intelligence` code path by deleting `getProactiveIntelligence` and `const intelligence = getProactiveIntelligence();`. Then add:

```ts
  const dashboardHome = useDashboardHome({
    isRecording,
    meetings: safeMeetings,
  });
```

Update the `Dashboard` render:

```tsx
<Dashboard
  model={dashboardHome.model}
  loading={dashboardHome.loading}
  isRecording={isRecording}
  setSelectedMeetingId={setSelectedMeetingId}
  setActiveTab={setActiveTab}
  setAskPlutoVisible={setAskPlutoVisible}
  completedTasks={completedTasks}
  handleCompleteTask={handleCompleteTask}
/>
```

- [ ] **Step 9: Search for old sample literals**

Run:

```bash
rg -n "Sarah Chen|Product Alignment|Finalize Schema|API Migration Space|Prepare standup|Coming Up Next|Sprint 1 Target" src/components/features/Dashboard.tsx src/App.tsx src/components/features/dashboardModel.ts
```

Expected: no matches.

- [ ] **Step 10: Run focused tests and TypeScript check**

Run:

```bash
pnpm vitest run tests/unit/dashboardModel.test.ts
pnpm exec tsc --noEmit
```

Expected: dashboard tests PASS; TypeScript PASS or only unrelated pre-existing errors outside files touched in this plan.

- [ ] **Step 11: Commit**

Run:

```bash
git add src/App.tsx src/components/features/Dashboard.tsx
git commit -m "feat: render homepage from dashboard model"
```

## Task 5: Final Verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run tests/unit/dashboardModel.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm run lint
```

Expected: PASS, or report exact lint failures. Fix only failures introduced by this plan.

- [ ] **Step 3: Run full tests if practical**

Run:

```bash
pnpm run test -- --run
```

Expected: PASS, or report exact unrelated failures. Fix only failures introduced by this plan.

- [ ] **Step 4: Verify no sample literals remain in dashboard implementation**

Run:

```bash
rg -n "Sarah Chen|Product Alignment|Finalize Schema|API Migration Space|Prepare standup|Coming Up Next|Sprint 1 Target" src/components/features/Dashboard.tsx src/App.tsx src/components/features/dashboardModel.ts
```

Expected: no matches.

- [ ] **Step 5: Check git diff**

Run:

```bash
git diff --stat
git status --short
```

Expected: only planned files changed by this implementation, plus any pre-existing unrelated dirty files that were present before work began.

## Self-Review

- Spec coverage: the plan removes hardcoded sample homepage content, uses existing IPC APIs, keeps unsupported spotlight conditional, replaces upcoming framing with latest meeting framing, preserves no-removal discipline, and adds TDD around model behavior.
- Placeholder scan: no task uses unresolved marker language or unconstrained "add error handling" instructions.
- Type consistency: `DashboardHomeModel`, `DashboardAction`, `DashboardTarget`, and section property names are introduced in Task 1 and reused consistently in later tasks.
