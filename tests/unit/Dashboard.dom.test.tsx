// @vitest-environment happy-dom

import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    expect(container.textContent).toContain('My commitments');
    expect(container.textContent).toContain('Send the launch recap');
    expect(container.textContent).toContain('Added');
    expect(
      container.querySelector('[data-testid="dashboard-suggestion-review"]'),
    ).toBeNull();

    act(() => root.unmount());
  });

  it('keeps one compact suggestion open and makes its synthesis the source link', async () => {
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

    await act(async () => secondReview?.click());
    expect(firstReview?.getAttribute('aria-expanded')).toBe('false');
    expect(secondReview?.getAttribute('aria-expanded')).toBe('true');
    expect(
      container.querySelector(
        'button[aria-label="Open source meeting for Send the launch recap"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="Open source meeting for Assign the customer recap"]',
      )?.textContent,
    ).toContain('The customer recap needs a final owner.');

    const addCommitment = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add Assign the customer recap to commitments"]',
    );
    await act(async () => addCommitment?.click());
    expect(handleReviewCommitment).toHaveBeenCalledWith(
      'action-2',
      'confirmed',
    );
    expect(secondReview?.getAttribute('aria-expanded')).toBe('false');

    act(() => root.unmount());
  });

  it('submits a user-authored commitment from the inline dashboard capture', async () => {
    const handleCreateCommitment = vi.fn(async () => {});
    const { container, root } = renderDashboard({ handleCreateCommitment });

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Add commitment'),
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
