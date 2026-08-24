// @vitest-environment happy-dom

import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
