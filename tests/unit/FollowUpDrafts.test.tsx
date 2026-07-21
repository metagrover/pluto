import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpDrafts } from '../../src/components/features/FollowUpDrafts';

const meeting = {
  id: 506,
  title: 'Launch review',
  created_at: '2026-07-20T00:00:00Z',
  started_at: '2026-07-20T00:00:00Z',
};

const renderDrafts = (overrides: Record<string, string[]> = {}) =>
  renderToStaticMarkup(
    <FollowUpDrafts
      meeting={meeting}
      overview={overrides.overview || ['Launch remains on track.']}
      actionItems={overrides.actionItems || ['Publish release notes']}
      decisions={overrides.decisions || ['Use a staged rollout']}
      entityContext={overrides.entityContext || []}
      discussionPoints={overrides.discussionPoints || []}
      participants={overrides.participants || []}
      openQuestions={overrides.openQuestions || []}
      topicSummaries={overrides.topicSummaries || []}
      fetchMeetings={vi.fn()}
    />,
  );

describe('FollowUpDrafts', () => {
  it('renders one send-ready editor with format switches and Copy primary', () => {
    const markup = renderDrafts();

    expect(markup).toContain('Ready to send');
    expect(markup.match(/<textarea/g)).toHaveLength(1);
    expect(markup).toContain('Email');
    expect(markup).toContain('Internal');
    expect(markup).toContain('Slack');
    expect(markup).toContain('>Copy<');
    expect(markup).not.toContain('Save Drafts');
    expect(markup).not.toContain('Client Recap Email');
    expect(markup).not.toContain('Slack Update');
  });

  it('uses honest weak-evidence wording without a disabled editor', () => {
    const markup = renderDrafts({
      overview: [],
      actionItems: [],
      decisions: [],
      openQuestions: [],
      topicSummaries: [],
      discussionPoints: [],
      participants: ['Maya'],
      entityContext: ['Project: Atlas'],
    });

    expect(markup).toContain('Not enough evidence yet');
    expect(markup).toContain('enough meeting evidence');
    expect(markup).not.toContain('No follow-ups needed');
    expect(markup).not.toContain('<textarea');
  });
});
