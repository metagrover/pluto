import { describe, expect, it } from 'vitest';

import {
  buildMeetingCountAnswer,
  isOneOnOneTitle,
  isQuantifiedSubject,
  matchPeopleInQuestion,
  parseMeetingReference,
  selectMeetingsOnDays,
  selectPersonMeetings,
} from '../../electron/intelligence/askPlutoQuestionFrame';
import {
  resolveTemporalDayMentions,
  resolveTemporalQuery,
} from '../../electron/intelligence/temporalScope';

const people = [
  { id: 'p-ayush', name: 'Ayush' },
  { id: 'p-adam', name: 'Adam' },
  { id: 'p-raj', name: 'Raj' },
  { id: 'p-raj-singh', name: 'Raj Singh' },
  { id: 'p-will', name: 'Will Park' },
  { id: 'p-vrinda', name: 'Vrinda' },
];

const meetings = [
  {
    id: 'm1',
    title: 'IPO Launchpad Kickoff',
    started_at: '2026-09-29T15:32:00Z',
  },
  {
    id: 'm2',
    title: 'Ayush / Deepak - 1:1',
    started_at: '2026-09-22T23:27:00Z',
  },
  { id: 'm3', title: 'Adam: 1-1', started_at: '2026-09-22T20:00:00Z' },
  {
    id: 'm4',
    title: 'NCT Daily Check-in: 09/22',
    started_at: '2026-09-22T19:01:00Z',
  },
  { id: 'm5', title: '1-1: Ayush', started_at: '2026-09-16T18:32:00Z' },
  { id: 'm6', title: 'NCT Daily Check-in', started_at: '2026-09-16T19:01:00Z' },
  {
    id: 'm7',
    title: 'Vrinda / Adam - IPO Launchpad',
    started_at: '2026-09-21T14:33:00Z',
  },
  {
    id: 'm8',
    title: 'Ayush weekly planning',
    started_at: '2026-08-12T16:00:00Z',
  },
];

const linked = new Map<string, Set<string>>([
  // Ayush is also linked to Adam's 1:1, as a mis-attributed speaker would be.
  ['p-ayush', new Set(['m1', 'm3', 'm4'])],
  ['p-adam', new Set(['m1', 'm3'])],
]);

describe('matchPeopleInQuestion', () => {
  it('prefers full names and unique first names', () => {
    expect(
      matchPeopleInQuestion(
        'Who is Raj Singh and what do we work on?',
        people,
      ).map((person) => person.id),
    ).toEqual(['p-raj-singh']);
    expect(
      matchPeopleInQuestion("What did I commit to in Ayush's 1:1?", people).map(
        (person) => person.id,
      ),
    ).toEqual(['p-ayush']);
  });

  it('resolves a shared first name to its exact single-name record', () => {
    expect(
      matchPeopleInQuestion('What does raj own?', people).map((p) => p.id),
    ).toEqual(['p-raj']);
  });

  it('does not read common words as names', () => {
    expect(matchPeopleInQuestion('Will the pilot ship?', people)).toEqual([]);
    expect(
      matchPeopleInQuestion('What did Will Park decide?', people).map(
        (p) => p.id,
      ),
    ).toEqual(['p-will']);
  });
});

describe('meeting references', () => {
  it('reads last, first and all references to 1:1s and meetings', () => {
    expect(
      parseMeetingReference('What did I commit to in my last 1:1 with Ayush?'),
    ).toMatchObject({ position: 'last', oneOnOne: true });
    expect(
      parseMeetingReference(
        'How many 1:1s did I have with Ayush in September?',
      ),
    ).toMatchObject({ position: 'all', oneOnOne: true });
    expect(
      parseMeetingReference('Summarize my last meeting with Adam.'),
    ).toMatchObject({ position: 'last', oneOnOne: false });
    expect(
      parseMeetingReference('What did we decide about pricing?'),
    ).toBeNull();
  });

  it('recognizes 1:1 titles in common formats', () => {
    for (const title of [
      'Ayush / Deepak - 1:1',
      'Adam: 1-1',
      '1-1: Ayush',
      'One-on-one with Sam',
      'Anu / Deepak: Weekly sync',
    ])
      expect(isOneOnOneTitle(title)).toBe(true);
    for (const title of ['IPO Launchpad Kickoff', 'NCT Daily Check-in: 09/22'])
      expect(isOneOnOneTitle(title)).toBe(false);
  });

  it('selects the most recent 1:1 involving the person', () => {
    const selected = selectPersonMeetings({
      people: [people[0]],
      meetings,
      meetingIdsByPerson: linked,
      reference: { position: 'last', oneOnOne: true },
    });
    expect(selected.map((meeting) => meeting.id)).toEqual(['m2']);
  });

  it('counts 1:1s inside a month from records, with a cited list', () => {
    const now = new Date(2026, 10, 2, 21, 0);
    const range = resolveTemporalQuery('in September', now)!.range;
    const selected = selectPersonMeetings({
      people: [people[0]],
      meetings,
      meetingIdsByPerson: linked,
      reference: { position: 'all', oneOnOne: true },
      range,
    });
    expect(selected.map((meeting) => meeting.id)).toEqual(['m2', 'm5']);
    const answer = buildMeetingCountAnswer({
      meetings: selected,
      label: 'your 1:1s with Ayush (September)',
    });
    expect(answer).toContain('2 recorded meetings');
    expect(answer).toContain('Ayush / Deepak - 1:1');
    expect(buildMeetingCountAnswer({ meetings: [], label: 'x' })).toContain(
      "couldn't find",
    );
  });

  it('selects meetings on compared days, narrowed by title words', () => {
    const now = new Date(2026, 10, 2, 21, 0);
    const query =
      'Compare what the NCT daily check-ins covered on 9/16 versus 9/22.';
    const selected = selectMeetingsOnDays({
      query,
      meetings,
      days: resolveTemporalDayMentions(query, now),
    });
    expect(selected.map((meeting) => meeting.id)).toEqual(['m6', 'm4']);
  });
});

describe('isQuantifiedSubject', () => {
  it('treats quantifiers as everyone rather than a person', () => {
    for (const value of [
      'each person',
      'everyone',
      'each of them',
      'all of them',
      'the team',
    ])
      expect(isQuantifiedSubject(value)).toBe(true);
    expect(isQuantifiedSubject('Ayush')).toBe(false);
  });
});
