import { describe, expect, it } from 'vitest';
import {
  BlockHistory,
  firstChangedBlockIndex,
  singleTextEditIndex,
} from '../../src/components/features/notes/editor/blockHistory';

type B = { id: string; type: string; text: string; checked?: boolean };
const make = (...texts: string[]): B[] =>
  texts.map((text, i) => ({ id: `b${i}`, type: 'paragraph', text }));
const withText = (blocks: B[], index: number, text: string): B[] =>
  blocks.map((b, i) => (i === index ? { ...b, text } : b));
const texts = (blocks: B[] | undefined) => blocks?.map((b) => b.text);

describe('edit classification', () => {
  it('spots a plain text edit in one block', () => {
    const a = make('One', 'Two');
    expect(singleTextEditIndex(a, withText(a, 1, 'Two!'))).toBe(1);
    expect(singleTextEditIndex(a, [...a, ...make('x')])).toBe(-1);
    expect(singleTextEditIndex(a, [{ ...a[0], type: 'h1' }, a[1]])).toBe(-1);
    expect(firstChangedBlockIndex(a, a.slice(0, 1))).toBe(1);
    expect(firstChangedBlockIndex(a, [...a])).toBe(-1);
  });
});

describe('BlockHistory', () => {
  it('groups continuous typing in one block into a single step', () => {
    const history = new BlockHistory<B>();
    const v0 = make('Hi');
    const v1 = withText(v0, 0, 'Hi t');
    const v2 = withText(v0, 0, 'Hi th');
    const v3 = withText(v0, 0, 'Hi there');
    history.record(v0, v1, { index: 0, start: 2, end: 2 }, 1_000);
    history.record(v1, v2, { index: 0, start: 4, end: 4 }, 1_300);
    history.record(v2, v3, { index: 0, start: 5, end: 5 }, 1_600);

    const undone = history.undo(v3, null);
    expect(texts(undone?.blocks)).toEqual(['Hi']);
    expect(undone?.caret).toEqual({ index: 0, start: 2, end: 2 });
    expect(history.canUndo).toBe(false);
  });

  it('starts a new step after a pause, in another block, or on a structural edit', () => {
    const history = new BlockHistory<B>();
    const v0 = make('A', 'B');
    const v1 = withText(v0, 0, 'A1');
    const v2 = withText(v1, 0, 'A12'); // after a pause
    const v3 = withText(v2, 1, 'B1'); // another block
    const v4 = [...v3, ...make('new').map((b) => ({ ...b, id: 'n' }))];
    history.record(v0, v1, null, 0);
    history.record(v1, v2, null, 2_000);
    history.record(v2, v3, null, 2_100);
    history.record(v3, v4, null, 2_200);

    expect(texts(history.undo(v4, null)?.blocks)).toEqual(['A12', 'B1']);
    expect(texts(history.undo(v3, null)?.blocks)).toEqual(['A12', 'B']);
    expect(texts(history.undo(v2, null)?.blocks)).toEqual(['A1', 'B']);
    expect(texts(history.undo(v1, null)?.blocks)).toEqual(['A', 'B']);
    expect(history.undo(v0, null)).toBeNull();
  });

  it('redoes what was undone, and a new edit clears redo', () => {
    const history = new BlockHistory<B>();
    const v0 = make('A');
    const v1 = make('A', 'B');
    history.record(v0, v1, null, 0);
    const undone = history.undo(v1, { index: 1, start: 1, end: 1 });
    expect(texts(undone?.blocks)).toEqual(['A']);
    const redone = history.redo(v0, null);
    expect(texts(redone?.blocks)).toEqual(['A', 'B']);
    expect(redone?.caret).toEqual({ index: 1, start: 1, end: 1 });

    history.undo(v1, null);
    history.record(v0, make('Z'), null, 10_000);
    expect(history.canRedo).toBe(false);
  });

  it('falls back to the end of the changed block when the cursor is unknown', () => {
    const history = new BlockHistory<B>();
    const v0 = make('One', 'Two');
    history.record(v0, withText(v0, 1, 'Two!'), null, 0);
    expect(history.undo(v0, null)?.caret).toEqual({
      index: 1,
      start: 3,
      end: 3,
    });
  });

  it('keeps a bounded number of steps', () => {
    const history = new BlockHistory<B>(3);
    let prev = make('0');
    for (let i = 1; i <= 5; i++) {
      const next = [
        ...prev,
        ...make(String(i)).map((b) => ({ ...b, id: `x${i}` })),
      ];
      history.record(prev, next, null, i * 10_000);
      prev = next;
    }
    let count = 0;
    while (history.undo(prev, null)) count++;
    expect(count).toBe(3);
  });
});
