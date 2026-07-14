import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MeetingActionCards } from '../../src/components/features/MeetingView';
import type { MeetingActionItemCard } from '../../src/components/features/meetingActionItems';

const makeItem = (
  overrides: Partial<MeetingActionItemCard> = {},
): MeetingActionItemCard => ({
  id: 'blocked-follow-up',
  title: 'Confirm launch plan',
  status: 'active',
  statusLabel: null,
  topicLabel: null,
  attentionKindLabel: 'Blocker',
  assignee: null,
  dueLabel: null,
  context: 'The team is waiting on legal before launch can proceed.',
  isBlocked: true,
  blockerReason: 'Legal approval is still blocking launch readiness.',
  actionable: true,
  toggleLabel: 'Resolve blocker',
  attentionItemId: 'attention-blocked',
  attentionStatus: 'active',
  dismissLabel: 'Dismiss blocker',
  snoozeLabel: 'Snooze blocker',
  ...overrides,
});

describe('MeetingActionCards', () => {
  it('renders blocker-specific completion wording for blocked follow-ups', () => {
    const markup = renderToStaticMarkup(
      <MeetingActionCards
        items={[makeItem()]}
        highlightEntities={(text) => text}
        meetingEntitiesLoading={false}
        pendingActionId={null}
        pendingAttentionId={null}
        onToggleAction={vi.fn()}
        onToggleDismissal={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Resolve blocker"');
    expect(markup).toContain('title="Resolve blocker"');
    expect(markup).toContain('Dismiss blocker');
    expect(markup).toContain('Snooze blocker');
  });
});
