import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Dashboard } from '../../src/components/features/Dashboard';
import type { DashboardHomeModel } from '../../src/components/features/dashboardModel';

const makeModel = (
  overrides: Partial<DashboardHomeModel> = {},
): DashboardHomeModel => ({
  hero: {
    kind: 'default',
    title: 'Start with a conversation',
    detail: 'Record a meeting to build memory.',
    severity: 'calm',
    action: { label: 'Ask Pluto', target: 'ask' },
  },
  briefingFocus: {
    kind: 'empty',
    title: 'Build your first briefing',
    detail: 'Record a conversation and Pluto will build memory.',
    action: { label: 'Ask Pluto', target: 'ask' },
  },
  latestMeeting: {
    state: 'empty',
    title: 'No meetings yet',
    detail: 'Record a meeting to populate Pluto.',
  },
  actionInsights: {
    state: 'empty',
    overdueCount: 0,
    staleCount: 0,
    activeCount: 0,
    items: [],
  },
  knowledgeDocuments: {
    state: 'empty',
    cards: [],
  },
  spotlight: {
    title: 'Indexing Rollout',
    subtitle: 'Blocked project',
    detail: '1 blocker | 2 dependencies | 3 recent changes',
    tags: ['1 blocker', '2 dependencies', '3 recent changes'],
    target: 'projects',
  },
  quickActions: [{ label: 'Ask Pluto', target: 'ask' }],
  graphStats: null,
  ...overrides,
});

describe('Dashboard', () => {
  it('renders the spotlight subtitle from the dashboard model', () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        model={makeModel()}
        loading={false}
        isRecording={false}
        setSelectedMeetingId={() => {}}
        setActiveTab={() => {}}
        setAskPlutoVisible={() => {}}
        updatingTaskIds={new Set()}
        actionError={null}
        handleCompleteTask={async () => {}}
      />,
    );

    expect(markup).toContain('Blocked project');
    expect(markup).not.toContain('Project signal');
  });
});
