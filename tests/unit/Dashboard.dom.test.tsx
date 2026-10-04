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
  it('lets remaining suggestions show full details, open their source, and persist dismissal', async () => {
    const fullDescription =
      'Share the complete launch checklist with the review group once the final approval is recorded, including every dependency and the agreed delivery conditions';
    const sourceEvidence =
      'I will share the checklist after approval, with dependencies and conditions included.';
    let actions = [
      ...['first', 'second', 'third'].map((id) =>
        makeAction({
          id,
          name: id,
          metadata: JSON.stringify({ commitment_state: 'confirmed' }),
        }),
      ),
      makeAction({
        id: 'remaining',
        name: fullDescription.slice(0, 100),
        metadata: JSON.stringify({
          commitment_state: 'possible',
          full_description: fullDescription,
          source_meeting_id: 'meeting-1',
          source_evidence: sourceEvidence,
        }),
      }),
    ];
    const buildModel = () =>
      buildDashboardHomeModel({
        isRecording: false,
        meetings: [makeMeeting()],
        overdueActions: [],
        staleActions: [],
        activeActions: actions,
        attentionAlerts: [],
        workspace: null,
        graphStats: null,
      });
    const setSelectedMeetingId = vi.fn();
    const handleReviewCommitment = vi.fn(
      async (id: string, state: 'confirmed' | 'rejected') => {
        actions = actions.map((action) =>
          action.id === id
            ? {
                ...action,
                metadata: JSON.stringify({
                  ...JSON.parse(action.metadata ?? '{}'),
                  commitment_state: state,
                }),
              }
            : action,
        );
        root.render(
          <Dashboard
            model={buildModel()}
            loading={false}
            isRecording={false}
            setSelectedMeetingId={setSelectedMeetingId}
            setActiveTab={vi.fn()}
            updatingTaskIds={new Set()}
            actionError={null}
            handleCompleteTask={vi.fn(async () => {})}
            handleReviewCommitment={handleReviewCommitment}
          />,
        );
      },
    );
    const { container, root } = renderDashboard({
      model: buildModel(),
      setSelectedMeetingId,
      handleReviewCommitment,
    });
    const row = container.querySelector(
      '[data-testid="dashboard-backlog-row"]',
    );
    expect(row?.textContent).toContain(fullDescription);
    expect(row?.querySelector('span.truncate')).toBeNull();
    expect(row?.textContent).not.toContain('Prioritize');
    expect(row?.textContent).toContain('Add to commitments');
    await act(async () =>
      row?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click(),
    );
    expect(row?.textContent).toContain(sourceEvidence);
    expect(row?.textContent).toContain('Owner not confirmed');
    await act(async () =>
      row
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label^="Open source meeting"]',
        )
        ?.click(),
    );
    expect(setSelectedMeetingId).toHaveBeenCalledWith('meeting-1');
    await act(async () =>
      row
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label^="Dismiss suggestion"]',
        )
        ?.click(),
    );
    expect(handleReviewCommitment).toHaveBeenCalledWith(
      'remaining',
      'rejected',
    );
    expect(
      container.querySelector('[data-testid="dashboard-backlog-row"]'),
    ).toBeNull();
    expect(buildModel().commitments.backlog).toEqual([]);
    act(() => root.unmount());
  });

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
    expect(container.textContent).toContain(
      'Launch readiness depends on privacy review.',
    );
    expect(
      container.querySelector(
        'button[aria-label="Open source meeting for Assign the customer recap"]',
      ),
    ).toBeNull();
    expect(synthesis?.textContent).toContain('Open full meeting');

    expect(synthesis?.className).not.toContain('line-clamp-1');
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

  it.each(['escape', 'cancel'] as const)(
    'closes creation with %s, returns focus, and preserves an unsaved draft',
    (method) => {
      const handleCreateCommitment = vi.fn(async () => undefined);
      const { container, root } = renderDashboard({ handleCreateCommitment });
      const addButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Add a commitment"]',
      )!;
      act(() => addButton.click());
      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label="Commitment"]',
      )!;
      expect(document.activeElement).toBe(input);
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, 'Unsaved draft');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      act(() => {
        if (method === 'escape')
          input.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              cancelable: true,
            }),
          );
        else
          Array.from(input.closest('form')!.querySelectorAll('button'))
            .find((button) => button.textContent === 'Cancel')!
            .click();
      });
      expect(
        container.querySelector('input[aria-label="Commitment"]'),
      ).toBeNull();
      expect(document.activeElement).toBe(addButton);
      expect(handleCreateCommitment).not.toHaveBeenCalled();
      act(() => addButton.click());
      expect(
        container.querySelector<HTMLInputElement>(
          'input[aria-label="Commitment"]',
        )?.value,
      ).toBe('Unsaved draft');
      act(() => root.unmount());
    },
  );

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

  it.each([false, true])(
    'reorders by drag in both directions and restores failed saves (%s)',
    async (fail) => {
      const handleSetDailyCommitments = vi.fn(
        async (_ids: string[], _previous: string[], _date: string) => {
          if (fail) throw new Error('save failed');
        },
      );
      const model = buildDashboardHomeModel({
        isRecording: false,
        meetings: [],
        overdueActions: [],
        staleActions: [],
        activeActions: ['first', 'second'].map((id) =>
          makeAction({
            id,
            name: id,
            metadata: JSON.stringify({ commitment_state: 'confirmed' }),
          }),
        ),
        attentionAlerts: [],
        workspace: null,
        graphStats: null,
      });
      const { container, root } = renderDashboard({
        model,
        handleSetDailyCommitments,
      });
      const drag = async (from: number, to: number) => {
        const rows = container.querySelectorAll(
          '[data-testid="dashboard-commitment-row"]',
        );
        const dataTransfer = {
          effectAllowed: '',
          dropEffect: '',
          setData: vi.fn(),
          getData: () => '',
        };
        const event = (type: string) =>
          Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
            dataTransfer,
          });
        act(() => {
          rows[from].dispatchEvent(event('dragstart'));
        });
        await act(async () => {
          rows[to].dispatchEvent(event('drop'));
        });
      };
      await drag(0, 1);
      expect(handleSetDailyCommitments.mock.calls[0]?.[0]).toEqual([
        'second',
        'first',
      ]);
      expect(
        container.querySelector('[data-testid="dashboard-commitment-row"]')
          ?.textContent,
      ).toContain(fail ? 'First' : 'Second');
      if (!fail) {
        await drag(1, 0);
        expect(handleSetDailyCommitments.mock.calls[1]?.[0]).toEqual([
          'first',
          'second',
        ]);
      }
      act(() => root.unmount());
    },
  );

  it('edits commitment text, retains failed drafts, and cancels without saving', async () => {
    const handleEditCommitment = vi.fn(async () => {
      throw new Error('save failed');
    });
    const model = buildDashboardHomeModel({
      isRecording: false,
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [
        makeAction({
          metadata: JSON.stringify({ commitment_state: 'confirmed' }),
        }),
      ],
      attentionAlerts: [],
      workspace: null,
      graphStats: null,
    });
    const { container, root } = renderDashboard({
      model,
      handleEditCommitment,
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Edit Send the launch recap"]',
        )
        ?.click(),
    );
    const editor = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit commitment"]',
    )!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setter.call(editor, 'Updated commitment');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      editor
        .closest('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    expect(handleEditCommitment).toHaveBeenCalledWith(
      'action-1',
      'Updated commitment',
      null,
    );
    expect(editor.value).toBe('Updated commitment');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not save',
    );
    handleEditCommitment.mockResolvedValueOnce(undefined);
    await act(async () => {
      editor
        .closest('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    expect(container.querySelector('textarea')).toBeNull();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Edit Send the launch recap"]',
        )
        ?.click(),
    );
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Cancel')
        ?.click(),
    );
    expect(handleEditCommitment).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  it('edits a prioritized unconfirmed commitment and changes or removes its date', async () => {
    const handleEditCommitment = vi.fn(
      async (_id: string, _text: string, _date: string | null) => {},
    );
    const model = buildDashboardHomeModel({
      isRecording: false,
      dateKey: '2026-09-27',
      meetings: [],
      overdueActions: [],
      staleActions: [],
      activeActions: [
        makeAction({
          due_date: '2026-09-28',
          metadata: JSON.stringify({
            commitment_state: 'possible',
            dashboard_daily_priority: { date: '2026-09-27', rank: 0 },
          }),
        }),
      ],
      attentionAlerts: [],
      workspace: null,
      graphStats: null,
    });
    const { container, root } = renderDashboard({
      model,
      handleEditCommitment,
    });
    const open = () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Edit Send the launch recap"]',
        )!
        .click();
    act(open);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Commitment due date"]',
    )!;
    expect(input.value).toBe('2026-09-28');
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, '2026-10-01');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () =>
      input
        .closest('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    expect(handleEditCommitment).toHaveBeenLastCalledWith(
      'action-1',
      'Send the launch recap',
      '2026-10-01',
    );
    act(open);
    act(() =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Remove date')!
        .click(),
    );
    const form = container.querySelector('textarea')!.closest('form')!;
    await act(async () =>
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    expect(handleEditCommitment).toHaveBeenLastCalledWith(
      'action-1',
      'Send the launch recap',
      null,
    );
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

  it('shows three weekly wins before expanding the full list', async () => {
    const meetings = [
      makeMeeting({
        id: 'older',
        created_at: '2026-04-20T10:00:00.000Z',
        started_at: '2026-04-20T10:00:00.000Z',
        analysis_json: null,
      }),
      ...Array.from({ length: 4 }, (_, index) =>
        makeMeeting({
          id: `win-${index + 1}`,
          title: `Win ${index + 1}`,
          created_at: `2026-04-${27 + index}T10:00:00.000Z`,
          started_at: `2026-04-${27 + index}T10:00:00.000Z`,
          analysis_json: JSON.stringify({
            recent_win: {
              win: `Win ${index + 1}`,
              why_it_counts: `Impact ${index + 1}`,
              evidence: `We closed sale ${index + 1}.`,
              ownership: 'shared',
            },
          }),
        }),
      ),
    ];
    const model = buildDashboardHomeModel({
      isRecording: false,
      dateKey: '2026-04-30',
      meetings,
      overdueActions: [],
      staleActions: [],
      activeActions: [],
      attentionAlerts: [],
      workspace: null,
      graphStats: null,
    });
    const { container, root } = renderDashboard({ model });

    expect(
      container.querySelectorAll('[data-testid="dashboard-recent-win-item"]'),
    ).toHaveLength(3);
    expect(container.textContent).toContain('View all');
    expect(
      Array.from(container.querySelectorAll('button')).filter((button) =>
        button.textContent?.includes('Celebrate this week'),
      ),
    ).toHaveLength(1);

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('View all'))
        ?.click();
    });

    expect(
      container.querySelectorAll('[data-testid="dashboard-recent-win-item"]'),
    ).toHaveLength(4);
    expect(container.textContent).toContain('Show less');

    act(() => root.unmount());
  });

  it('uses a quiet celebration acknowledgment when reduced motion is preferred', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const { container, root } = renderDashboard();

    const celebrate = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Celebrate with confetti"]',
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

  it('launches screen-wide confetti from the empty-state party popper', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    const { container, root } = renderDashboard();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Celebrate with confetti"]',
        )
        ?.click();
    });

    expect(
      container.querySelector('[data-testid="dashboard-confetti"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="dashboard-reduced-celebration"]'),
    ).toBeNull();

    const firstVariant = container
      .querySelector('[data-testid="dashboard-confetti"]')
      ?.getAttribute('data-variant');
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Celebrate with confetti"]',
        )
        ?.click();
    });
    const secondVariant = container
      .querySelector('[data-testid="dashboard-confetti"]')
      ?.getAttribute('data-variant');
    expect(secondVariant).not.toBe(firstVariant);

    act(() => root.unmount());
  });
});
