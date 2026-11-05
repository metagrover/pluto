import { expect, it } from 'vitest';
import {
  lineOwnedBy,
  ownerLabelsFor,
  ownerOfLine,
  splitOwnerPrefix,
} from '../../src/utils/noteOwner';

const people = [
  { id: 'p', name: 'Priya Shah' },
  { id: 's1', name: 'Sam Rivera' },
  { id: 's2', name: 'Sam Lee' },
];

it('reads a name before a colon', () => {
  expect(splitOwnerPrefix('Priya: send deck')).toEqual({
    label: 'priya',
    rest: 'send deck',
  });
  expect(splitOwnerPrefix('@Priya Shah:  confirm budget')).toEqual({
    label: 'priya shah',
    rest: 'confirm budget',
  });
  expect(splitOwnerPrefix('Send deck')).toBeNull();
  expect(splitOwnerPrefix('Time: 10:30')).toEqual({
    label: 'time',
    rest: '10:30',
  });
  expect(splitOwnerPrefix('https://x.y')).toBeNull();
});

it('accepts a first name only when nobody else has it', () => {
  expect(ownerLabelsFor(people[0], people)).toEqual(['priya shah', 'priya']);
  expect(ownerLabelsFor(people[1], people)).toEqual(['sam rivera']);
});

it('finds the one person a line belongs to', () => {
  expect(ownerOfLine('Priya: send deck', people)?.id).toBe('p');
  expect(ownerOfLine('Sam: share notes', people)).toBeNull();
  expect(ownerOfLine('Sam Lee: draft', people)?.id).toBe('s2');
  expect(ownerOfLine('Time: 10:30', people)).toBeNull();
  expect(lineOwnedBy('priya: Send deck', ['priya'])).toBe('Send deck');
});
