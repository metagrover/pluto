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
    openCommitmentCount: 2,
  },
];

describe('PeopleBriefing', () => {
  it('presents people as relationship context rows', () => {
    const markup = renderToStaticMarkup(
      <PeopleBriefing rows={rows} onOpenMeeting={() => {}} />,
    );
    expect(markup).toContain('Relationship context');
    expect(markup).toContain('Needs you now');
    expect(markup).toContain('Product review');
    expect(markup).toContain('2 open commitments');
    expect(markup).not.toContain('View Profile');
    expect(markup).not.toContain('>Person<');
  });

  it('keeps the first viewport focused and moves the directory behind disclosure', () => {
    const manyRows = Array.from({ length: 12 }, (_, index) => ({
      ...rows[0],
      id: `person-${index}`,
      name: `Person ${index}`,
      openCommitmentCount: index === 9 ? 3 : 0,
      latestMeetingAt: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    }));
    const markup = renderToStaticMarkup(
      <PeopleBriefing rows={manyRows} onOpenMeeting={() => {}} />,
    );

    expect(markup).toContain('Needs you now');
    expect(markup).toContain('3 open commitments');
    expect(markup).toContain('Browse all 12 people');
    expect(markup).not.toContain('undefined');
  });

  it('promotes the selected person into the visible priority rows', () => {
    const manyRows = Array.from({ length: 8 }, (_, index) => ({
      ...rows[0],
      id: `person-${index}`,
      name: `Person ${index}`,
      openCommitmentCount: 0,
      latestMeetingAt: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    }));
    const markup = renderToStaticMarkup(
      <PeopleBriefing
        rows={manyRows}
        selectedPersonId="person-7"
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain('data-person-id="person-7"');
    expect(markup).toContain('data-selected="true"');
    expect(markup.indexOf('data-person-id="person-7"')).toBeLessThan(
      markup.indexOf('Browse all 8 people'),
    );
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
