import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PeopleBriefing,
  type PersonBriefingRow,
} from '../../src/components/KnowledgeGraph/PeopleTab';

const rows: PersonBriefingRow[] = [
  {
    id: 'person-1',
    name: 'Avery Chen',
    role: 'Design lead',
    meetingCount: 4,
    mentionCount: 9,
    latestMeetingId: 'meeting-1',
    latestMeetingTitle: 'Product review',
    latestMeetingAt: '2026-07-12T12:00:00.000Z',
    context: 'Reviewed the rollout sequence and evidence requirements.',
  },
];

describe('PeopleBriefing', () => {
  it('presents people as relationship context rows', () => {
    const markup = renderToStaticMarkup(
      <PeopleBriefing rows={rows} onOpenMeeting={() => {}} />,
    );
    expect(markup).toContain('Relationship context');
    expect(markup).toContain('Recently in conversation');
    expect(markup).toContain('Product review');
    expect(markup).toContain('4 conversations');
    expect(markup).not.toContain('View Profile');
    expect(markup).not.toContain('>Person<');
  });

  it('teaches the surface when no relationship context exists', () => {
    const markup = renderToStaticMarkup(
      <PeopleBriefing rows={[]} onOpenMeeting={() => {}} />,
    );
    expect(markup).toContain(
      'People will appear as Pluto connects them to conversations.',
    );
  });
});
