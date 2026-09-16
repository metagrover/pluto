// @vitest-environment happy-dom

import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AttentionItem } from '../../electron/intelligence/intelligenceTypes';
import type { Entity } from '../../src/api/knowledgeGraph';
import { Dashboard } from '../../src/components/features/Dashboard';
import { buildDashboardHomeModel } from '../../src/components/features/dashboardModel';
import type { Meeting } from '../../src/types';

const makeMeeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'meeting-1',
  title: 'Launch Review',
  created_at: '2026-04-27T18:00:00.000Z',
  started_at: '2026-04-27T17:30:00.000Z',
  enhanced_notes: 'We reviewed launch readiness.',
  analysis_json: JSON.stringify({
    recent_win: {
      win: 'The launch blocker was resolved in the room.',
      why_it_counts:
        'The notes record the decision and the owner accepted the next step.',
      evidence:
        'The launch blocker was resolved in the room and the owner accepted the next step.',
      source: 'Launch Review',
    },
  }),
  ...overrides,
});

const makeAction = (overrides: Partial<Entity> = {}): Entity => ({
  id: 'action-1',
  type: 'action_item',
  name: 'Send the launch recap',
  normalized_name: 'send the launch recap',
  status: 'active',
  due_date: null,
  assigned_to: null,
  metadata: JSON.stringify({
    commitment_state: 'possible',
    source_meeting_id: 'meeting-1',
  }),
  saliency_score: 0.8,
  domain_tag: 'work',
  created_at: '2026-04-25T10:00:00.000Z',
  updated_at: '2026-04-25T10:00:00.000Z',
  ...overrides,
});

const makeAttentionItem = (
  overrides: Partial<AttentionItem> = {},
): AttentionItem => ({
  id: 'attention-1',
  dedupe_key: 'action_tracker:blocker:action-1',
  kind: 'blocker',
  severity: 'watch',
  score: 0.8,
  status: 'active',
  title: 'Send the launch recap',
  reason: 'Waiting on launch approval.',
  source: 'action_tracker',
  score_breakdown: null,
  evidence: [],
  related_entity_ids: ['action-1'],
  related_stream_ids: [],
  related_meeting_ids: [],
  created_at: '2026-04-25T10:00:00.000Z',
  updated_at: '2026-04-25T10:00:00.000Z',
  last_seen_at: '2026-04-25T10:00:00.000Z',
  resolved_at: null,
  ...overrides,
});

const renderDashboard = (
  props: Partial<ComponentProps<typeof Dashboard>> = {},
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const model =
    props.model ??
    buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [],
      workspace: null,
      graphStats: null,
    });

  act(() =>
    root.render(
      <Dashboard
        model={model}
        loading={false}
        isRecording={false}
        setSelectedMeetingId={vi.fn()}
        setActiveTab={vi.fn()}
        updatingTaskIds={new Set()}
        actionError={null}
        handleCompleteTask={vi.fn(async () => {})}
        {...props}
      />,
    ),
  );

  return { container, root };
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Dashboard interactions', () => {
  it('keeps secondary commitment actions in a keyboard-accessible menu', async () => {
    const handleUpdateAttentionStatus = vi.fn(async () => {});
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [makeMeeting()],
      overdueActions: [
        makeAction({
          due_date: '2026-04-24T10:00:00.000Z',
          metadata: JSON.stringify({ commitment_state: 'confirmed' }),
        }),
      ],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [makeAttentionItem()],
      workspace: null,
      graphStats: null,
    });
    const { container, root } = renderDashboard({
      model,
      handleUpdateAttentionStatus,
    });

    const moreActions = container.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions for Send the launch recap"]',
    );
    expect(moreActions?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await act(async () => moreActions?.click());
    expect(moreActions?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[role="menu"]')).toBeTruthy();

    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      )
        .find((button) => button.textContent === 'Snooze blocker')
        ?.click();
    });
    expect(handleUpdateAttentionStatus).toHaveBeenCalledWith(
      'attention-1',
      'snoozed',
    );
    expect(container.querySelector('[role="menu"]')).toBeNull();

    act(() => root.unmount());
  });

  it('moves an accepted suggestion into commitments and acknowledges the transition', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const possibleAction = makeAction();
    const buildModel = (action: Entity) =>
      buildDashboardHomeModel({
        isRecording: false,
        meetings: [makeMeeting()],
        overdueActions: [],
        staleActions: [],
        activeActions: [action],
        attentionAlerts: [],
        workspace: null,
        graphStats: null,
      });
    let model = buildModel(possibleAction);
    const handleReviewCommitment = vi.fn(async () => {
      model = buildModel({
        ...possibleAction,
        metadata: JSON.stringify({
          commitment_state: 'confirmed',
          source_meeting_id: 'meeting-1',
          reviewed_at: '2026-08-24T18:39:34.000Z',
        }),
        updated_at: '2026-08-24T18:39:34.000Z',
      });
      root.render(
        <Dashboard
          model={model}
          loading={false}
          isRecording={false}
          setSelectedMeetingId={vi.fn()}
          setActiveTab={vi.fn()}
          updatingTaskIds={new Set()}
          actionError={null}
          handleCompleteTask={vi.fn(async () => {})}
          handleReviewCommitment={handleReviewCommitment}
        />,
      );
    });

    act(() =>
      root.render(
        <Dashboard
          model={model}
          loading={false}
          isRecording={false}
          setSelectedMeetingId={vi.fn()}
          setActiveTab={vi.fn()}
          updatingTaskIds={new Set()}
          actionError={null}
          handleCompleteTask={vi.fn(async () => {})}
          handleReviewCommitment={handleReviewCommitment}
        />,
      ),
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Review suggestion: Send the launch recap"]',
        )
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Add Send the launch recap to commitments"]',
        )
        ?.click();
    });

    expect(handleReviewCommitment).toHaveBeenCalledWith(
      'action-1',
      'confirmed',
    );
    expect(container.textContent).toContain("Today's focus");
    expect(container.textContent).toContain('Send the launch recap');
    expect(container.textContent).toContain('Added');
    expect(
      container.querySelector('[data-testid="dashboard-suggestion-review"]'),
    ).toBeNull();

    act(() => root.unmount());
  });

  it('shows compact review controls for each focused possible item', async () => {
    const setSelectedMeetingId = vi.fn();
    const handleReviewCommitment = vi.fn(async () => {});
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [
        makeMeeting({
          id: 'meeting-1',
          title: 'Launch Review',
          analysis_json: JSON.stringify({
            overview: 'Launch readiness depends on privacy review.',
          }),
        }),
        makeMeeting({
          id: 'meeting-2',
          title: 'Customer Review',
          analysis_json: JSON.stringify({
            overview: 'The customer recap needs a final owner.',
          }),
        }),
      ],
      overdueActions: [],
      staleActions: [],
      activeActions: [
        makeAction(),
        makeAction({
          id: 'action-2',
          name: 'Assign the customer recap',
          metadata: JSON.stringify({
            commitment_state: 'possible',
            source_meeting_id: 'meeting-2',
          }),
        }),
      ],
      attentionAlerts: [],
      workspace: null,
      graphStats: null,
    });
    const { container, root } = renderDashboard({
      model,
      setSelectedMeetingId,
      handleReviewCommitment,
    });

    const firstReview = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Review suggestion: Send the launch recap"]',
    );
    const secondReview = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Review suggestion: Assign the customer recap"]',
    );
    expect(firstReview?.getAttribute('aria-expanded')).toBe('false');
    expect(secondReview?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Fresh suggestion');
    expect(
      container.querySelector(
        'button[aria-label="Open source meeting for Send the launch recap"]',
      ),
    ).toBeNull();

    await act(async () => firstReview?.click());
    expect(firstReview?.getAttribute('aria-expanded')).toBe('true');
    const synthesis = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open source meeting for Send the launch recap"]',
    );
    expect(synthesis?.textContent).toContain(
      'Launch readiness depends on privacy review.',
    );
    expect(
      container.querySelector(
        'button[aria-label="Open source meeting for Assign the customer recap"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain('Open full meeting');

    expect(synthesis?.className).toContain('line-clamp-1');
    await act(async () => synthesis?.click());
    expect(setSelectedMeetingId).toHaveBeenCalledWith('meeting-1');

    const addCommitment = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add Send the launch recap to commitments"]',
    );
    await act(async () => addCommitment?.click());
    expect(handleReviewCommitment).toHaveBeenCalledWith(
      'action-1',
      'confirmed',
    );
    expect(firstReview?.getAttribute('aria-expanded')).toBe('false');

    act(() => root.unmount());
  });

  it('removes dismissed possible items from the focused list', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let activeActions = [
      makeAction({ id: 'action-1', name: 'Send the launch recap' }),
      makeAction({ id: 'action-2', name: 'Assign the customer recap' }),
      makeAction({ id: 'action-3', name: 'Draft the launch checklist' }),
    ];
    const buildModel = () =>
      buildDashboardHomeModel({
        isRecording: false,
        meetings: [makeMeeting()],
        overdueActions: [],
        staleActions: [],
        activeActions,
        attentionAlerts: [],
        workspace: null,
        graphStats: null,
      });
    const handleReviewCommitment = vi.fn(async (taskId: string) => {
      activeActions = activeActions.filter((action) => action.id !== taskId);
      root.render(
        <Dashboard
          model={buildModel()}
          loading={false}
          isRecording={false}
          setSelectedMeetingId={vi.fn()}
          setActiveTab={vi.fn()}
          updatingTaskIds={new Set()}
          actionError={null}
          handleCompleteTask={vi.fn(async () => {})}
          handleReviewCommitment={handleReviewCommitment}
        />,
      );
    });

    act(() =>
      root.render(
        <Dashboard
          model={buildModel()}
          loading={false}
          isRecording={false}
          setSelectedMeetingId={vi.fn()}
          setActiveTab={vi.fn()}
          updatingTaskIds={new Set()}
          actionError={null}
          handleCompleteTask={vi.fn(async () => {})}
          handleReviewCommitment={handleReviewCommitment}
        />,
      ),
    );

    const dismissCurrentSuggestion = async () => {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Review suggestion:"]',
          )
          ?.click();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label^="Dismiss suggestion:"]',
          )
          ?.click();
      });
    };

    expect(
      container.querySelectorAll('button[aria-label^="Review suggestion:"]'),
    ).toHaveLength(3);
    await dismissCurrentSuggestion();
    expect(
      container.querySelectorAll('button[aria-label^="Review suggestion:"]'),
    ).toHaveLength(2);
    await dismissCurrentSuggestion();
    expect(
      container.querySelectorAll('button[aria-label^="Review suggestion:"]'),
    ).toHaveLength(1);

    act(() => root.unmount());
  });

  it('submits a user-authored commitment from the inline dashboard capture', async () => {
    const handleCreateCommitment = vi.fn(async () => ({ id: 'new-action' }));
    const handleSetDailyCommitments = vi.fn(async () => {});
    const { container, root } = renderDashboard({
      date: new Date('2026-08-25T12:00:00'),
      handleCreateCommitment,
      handleSetDailyCommitments,
    });

    const addButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add a commitment"]',
    );
    await act(async () => addButton?.click());

    const text = container.querySelector<HTMLInputElement>(
      'input[aria-label="Commitment"]',
    );
    const due = container.querySelector<HTMLInputElement>(
      'input[aria-label="Optional due date"]',
    );
    expect(text).toBeTruthy();
    expect(due).toBeTruthy();

    const setInputValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setInputValue?.call(text, 'Send launch recap');
      text!.dispatchEvent(new Event('input', { bubbles: true }));
      setInputValue?.call(due, '2026-04-30');
      due!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));
    });

    expect(handleCreateCommitment).toHaveBeenCalledWith(
      'Send launch recap',
      '2026-04-30',
    );
    expect(handleSetDailyCommitments).toHaveBeenCalledWith(
      ['new-action'],
      [],
      '2026-08-25',
    );

    act(() => root.unmount());
  });

  it('clears a created commitment before a secondary priority-order failure', async () => {
    const handleCreateCommitment = vi.fn(async () => ({ id: 'new-action' }));
    const handleSetDailyCommitments = vi.fn(async () => {
      throw new Error('priority write failed');
    });
    const { container, root } = renderDashboard({
      date: new Date('2026-08-25T12:00:00'),
      handleCreateCommitment,
      handleSetDailyCommitments,
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Add a commitment"]',
        )
        ?.click();
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Commitment"]',
    );
    const setInputValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setInputValue?.call(input, 'Send launch recap');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(new SubmitEvent('submit', { bubbles: true }));
    });

    expect(handleCreateCommitment).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('input[aria-label="Commitment"]'),
    ).toBeNull();

    act(() => root.unmount());
  });

  it('anchors the briefing on the date and exposes an ordered daily three without Ask Pluto', async () => {
    const handleSetDailyCommitments = vi.fn(async () => {});
    const model = buildDashboardHomeModel({
      isRecording: false,
      dateKey: '2026-08-25',
      meetings: [makeMeeting()],
      overdueActions: [],
      staleActions: [],
      activeActions: [
        makeAction({
          id: 'first',
          name: 'First priority',
          metadata: JSON.stringify({ commitment_state: 'confirmed' }),
        }),
        makeAction({
          id: 'second',
          name: 'Second priority',
          metadata: JSON.stringify({ commitment_state: 'confirmed' }),
        }),
      ],
      attentionAlerts: [],
      workspace: null,
      graphStats: null,
    });
    const { container, root } = renderDashboard({
      model,
      date: new Date('2026-08-25T12:00:00'),
      handleSetDailyCommitments,
    });

    expect(container.querySelector('h1')?.textContent).toBe(
      'Tuesday, August 25',
    );
    expect(container.textContent).toContain("Today's focus");
    expect(container.textContent).not.toContain('Ask Pluto');
    expect(
      container
        .querySelector('[data-testid="dashboard-commitment-row"]')
        ?.getAttribute('draggable'),
    ).toBe('true');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Move Second priority up"]',
        )
        ?.click();
    });

    expect(handleSetDailyCommitments).toHaveBeenCalledWith(
      ['second', 'first'],
      ['first', 'second'],
      '2026-08-25',
    );
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="dashboard-commitment-row"]'),
      ).map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining('Second priority'),
      expect.stringContaining('First priority'),
    ]);

    act(() => root.unmount());
  });

  it("puts the relaxed caught-up treatment inside Today's focus when it is empty", () => {
    const { container, root } = renderDashboard();
    const section = container.querySelector('#todays-focus');

    expect(section?.textContent).toContain('Nothing needs your attention');
    expect(
      section?.querySelector('[data-testid="daily-three-empty"]'),
    ).toBeTruthy();
    const illustration = section?.querySelector<HTMLImageElement>(
      '[data-testid="daily-three-empty-illustration"]',
    );
    expect(illustration?.getAttribute('alt')).toBe('');
    expect(illustration?.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).not.toContain('Nothing urgent');

    act(() => root.unmount());
  });

  it('uses a quiet celebration acknowledgment when reduced motion is preferred', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const { container, root } = renderDashboard();

    const celebrate = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Celebrate'),
    );
    await act(async () => celebrate?.click());

    expect(
      container.querySelector('[data-testid="dashboard-reduced-celebration"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="dashboard-confetti"]'),
    ).toBeNull();

    act(() => root.unmount());
  });
});
