import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FollowUpDrafts } from '../../src/components/features/FollowUpDrafts';
import type { Meeting } from '../../src/types';

const meeting: Meeting = {
  id: 'meeting-506',
  title: 'Launch Review',
  created_at: '2026-07-20T00:00:00.000Z',
  started_at: '2026-07-20T00:00:00.000Z',
};

const renderDrafts = (overrides: {
  overview?: string[];
  actionItems?: string[];
  decisions?: string[];
  entityContext?: string[];
  discussionPoints?: string[];
  participants?: string[];
  openQuestions?: string[];
  topicSummaries?: string[];
  saved?: string;
}) =>
  renderToStaticMarkup(
    <FollowUpDrafts
      meeting={{ ...meeting, follow_up_drafts_json: overrides.saved }}
      overview={overrides.overview || []}
      actionItems={overrides.actionItems || []}
      decisions={overrides.decisions || []}
      entityContext={overrides.entityContext || []}
      discussionPoints={overrides.discussionPoints || []}
      participants={overrides.participants || []}
      openQuestions={overrides.openQuestions || []}
      topicSummaries={overrides.topicSummaries || []}
      fetchMeetings={() => {}}
    />,
  );

describe('FollowUpDrafts', () => {
  it('renders one send-ready editor with format switches and a primary copy action', () => {
    const html = renderDrafts({
      overview: ['We aligned on a staged launch.'],
    });

    expect(html.match(/<textarea/g) || []).toHaveLength(1);
    expect(html).toContain('Ready to send');
    expect(html).toContain('Email');
    expect(html).toContain('Internal');
    expect(html).toContain('Slack');
    expect(html).toContain('Copy');
    expect(html).not.toContain('Save Drafts');
    expect(html).not.toContain('Client Recap Email');
  });

  it('uses useful overview evidence even without actions or decisions', () => {
    const html = renderDrafts({ overview: ['The rollout remains on track.'] });

    expect(html).toContain('The rollout remains on track.');
    expect(html).not.toContain('No follow-ups needed');
  });

  it('renders an honest compact weak-evidence state', () => {
    const html = renderDrafts({
      participants: ['Avery'],
      entityContext: ['Project: Apollo'],
    });

    expect(html).toContain('Not enough evidence yet');
    expect(html).toContain(
      'Pluto does not yet have enough meeting evidence to draft a useful follow-up.',
    );
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('No follow-ups needed');
  });

  it('loads a saved selected format without exposing three editors', () => {
    const html = renderDrafts({
      overview: ['Current meeting context.'],
      saved: JSON.stringify({
        schemaVersion: 2,
        selectedFormat: 'slack',
        evidenceFingerprint: 'saved-fingerprint',
        variants: {
          email: 'Saved email',
          internal: 'Saved internal',
          slack: 'Saved Slack update',
        },
        editedFormats: ['slack'],
      }),
    });

    expect(html.match(/<textarea/g) || []).toHaveLength(1);
    expect(html).toContain('Saved Slack update');
    expect(html).toContain('Meeting context changed');
  });
});
