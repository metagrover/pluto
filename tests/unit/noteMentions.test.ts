import { describe, expect, it } from 'vitest';
import {
  activeMentionQuery,
  findMentions,
  matchPeople,
} from '../../src/utils/noteMentions';

const sam = { id: 'sam', name: 'Sam' };
const samRivera = { id: 'sam-rivera', name: 'Sam Rivera' };
const priya = { id: 'priya', name: 'Priya Shah' };

describe('findMentions', () => {
  it('finds known people by "@Name", case-insensitively', () => {
    const text = '@sam rivera and @Priya Shah agreed';
    expect(
      findMentions(text, [samRivera, priya]).map((m) => [
        text.slice(m.start, m.end),
        m.person.id,
      ]),
    ).toEqual([
      ['@sam rivera', 'sam-rivera'],
      ['@Priya Shah', 'priya'],
    ]);
  });

  it('prefers the longest name when names overlap', () => {
    const mentions = findMentions('Ask @Sam Rivera, not @Sam.', [
      sam,
      samRivera,
    ]);
    expect(mentions.map((m) => m.person.id)).toEqual(['sam-rivera', 'sam']);
  });

  it('ignores email addresses, partial words and unknown names', () => {
    expect(findMentions('mail sam@rivera.com', [samRivera])).toEqual([]);
    expect(findMentions('@Samantha joined', [sam])).toEqual([]);
    expect(findMentions('@Alex said hi', [sam, priya])).toEqual([]);
  });
});

describe('activeMentionQuery', () => {
  it('reads the "@query" just before the caret', () => {
    const text = 'Ping @Sam Ri about it';
    expect(activeMentionQuery(text, 'Ping @Sam Ri'.length)).toEqual({
      start: 5,
      query: 'Sam Ri',
    });
    expect(activeMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('ignores emails and an "@" followed by a space', () => {
    expect(activeMentionQuery('me@exa', 6)).toBeNull();
    expect(activeMentionQuery('@ sam', 5)).toBeNull();
    expect(activeMentionQuery('no mention', 10)).toBeNull();
  });
});

describe('matchPeople', () => {
  it('ranks name starts, then word starts, then other matches', () => {
    const people = [
      { id: 'a', name: 'Lisa Samson' },
      { id: 'b', name: 'Rosamund Pike' },
      { id: 'c', name: 'Sam Rivera' },
    ];
    expect(matchPeople(people, 'sam').map((p) => p.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(matchPeople(people, '')).toHaveLength(3);
  });
});
