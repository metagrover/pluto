// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
} from '../../src/components/features/notes/NotesView';
import {
  blockIndexAtY,
  duplicateBlock,
  duplicateBlockRange,
  insertPastedBlocks,
  moveBlock,
  moveBlockRange,
  numberedListIndex,
  removeBlock,
  replaceBlockRange,
  scrollSelectedMenuItemIntoView,
  selectionBounds,
  splitPasteIntoBlocks,
  taskRunPosition,
} from '../../src/components/features/notes/editor/blockOps';

const b = (id: string, type = 'paragraph', text = id) => ({ id, type, text });

describe('notes block operations', () => {
  it('moves, duplicates and removes blocks', () => {
    const blocks = [b('a'), b('b'), b('c')];
    expect(moveBlock(blocks, 0, 2).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(moveBlock(blocks, 0, 5)).toBe(blocks);

    const dup = duplicateBlock(blocks, 1);
    expect(dup.map((x) => x.text)).toEqual(['a', 'b', 'b', 'c']);
    expect(dup[2].id).not.toBe('b');

    expect(
      removeBlock([b('only')], 0, () => b('new')).map((x) => x.id),
    ).toEqual(['new']);
  });

  it('groups consecutive tasks but not checklists', () => {
    const blocks = [
      b('t1', 'task'),
      b('t2', 'task'),
      b('c1', 'todo'),
      b('t3', 'task'),
    ];
    expect(blocks.map((_, i) => taskRunPosition(blocks, i))).toEqual([
      'start',
      'end',
      null,
      'single',
    ]);
  });

  it('numbers lists and round-trips numbered items and dividers', () => {
    const md = '1. First\n2. Second\n---\n1. Again';
    const blocks = parseMarkdownToBlocks(md);
    expect(blocks.map((x) => x.type)).toEqual([
      'numbered',
      'numbered',
      'divider',
      'numbered',
    ]);
    expect(numberedListIndex(blocks, 1)).toBe(2);
    expect(numberedListIndex(blocks, 3)).toBe(1);
    expect(serializeBlocksToMarkdown(blocks)).toBe(md);
  });

  it('splits multi-line pastes into blocks around the caret', () => {
    expect(splitPasteIntoBlocks('one line', parseMarkdownToBlocks)).toBeNull();

    const pasted = splitPasteIntoBlocks(
      'pasted\n- [ ] check\n[task: Ship it]\n',
      parseMarkdownToBlocks,
    );
    expect(pasted?.map((x) => x.type)).toEqual(['paragraph', 'todo', 'task']);

    const blocks = [b('x', 'paragraph', 'Hello world')];
    const result = insertPastedBlocks(blocks, 0, 6, 6, pasted!);
    expect(serializeBlocksToMarkdown(result.blocks as never)).toBe(
      'Hello pasted\n- [ ] check\n[task: Ship itworld]',
    );
    expect(result.focusIndex).toBe(2);
    expect(result.caret).toBe('Ship it'.length);
  });
});

describe('scrollSelectedMenuItemIntoView', () => {
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, height }) as DOMRect;

  it('scrolls the menu down just enough to reveal the highlighted item', () => {
    const menu = document.createElement('div');
    const item = document.createElement('button');
    item.dataset.selected = 'true';
    menu.appendChild(item);
    menu.getBoundingClientRect = () => rect(100, 200);
    item.getBoundingClientRect = () => rect(280, 40);
    menu.scrollTop = 0;
    scrollSelectedMenuItemIntoView(menu);
    expect(menu.scrollTop).toBe(26);
  });

  it('scrolls up when the item is above the visible area, and not at all when visible', () => {
    const menu = document.createElement('div');
    const item = document.createElement('button');
    item.dataset.selected = 'true';
    menu.appendChild(item);
    menu.getBoundingClientRect = () => rect(100, 200);
    item.getBoundingClientRect = () => rect(80, 40);
    menu.scrollTop = 120;
    scrollSelectedMenuItemIntoView(menu);
    expect(menu.scrollTop).toBe(94);

    item.getBoundingClientRect = () => rect(150, 40);
    scrollSelectedMenuItemIntoView(menu);
    expect(menu.scrollTop).toBe(94);
  });
});

describe('block range helpers', () => {
  const make = (...texts: string[]) =>
    texts.map((text, i) => ({ id: `b${i}`, type: 'paragraph', text }));
  const texts = (blocks: Array<{ text: string }>) => blocks.map((b) => b.text);
  const empty = () => ({ id: 'new', type: 'paragraph', text: '' });

  it('orders and clamps a selection whichever way it was made', () => {
    expect(selectionBounds({ anchor: 3, focus: 1 }, 5)).toEqual([1, 3]);
    expect(selectionBounds({ anchor: 2, focus: 9 }, 4)).toEqual([2, 3]);
    expect(selectionBounds({ anchor: 0, focus: 0 }, 0)).toBeNull();
  });

  it('replaces a range and never leaves the note empty', () => {
    const blocks = make('a', 'b', 'c', 'd');
    expect(texts(replaceBlockRange(blocks, 1, 2, make('x'), empty))).toEqual([
      'a',
      'x',
      'd',
    ]);
    expect(replaceBlockRange(blocks, 0, 3, [], empty)).toEqual([empty()]);
  });

  it('moves a range one place and stops at the edges', () => {
    const blocks = make('a', 'b', 'c', 'd');
    expect(texts(moveBlockRange(blocks, 1, 2, -1) ?? [])).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
    expect(texts(moveBlockRange(blocks, 1, 2, 1) ?? [])).toEqual([
      'a',
      'd',
      'b',
      'c',
    ]);
    expect(moveBlockRange(blocks, 0, 1, -1)).toBeNull();
    expect(moveBlockRange(blocks, 2, 3, 1)).toBeNull();
  });

  it('duplicates a range right after itself with fresh ids', () => {
    const next = duplicateBlockRange(make('a', 'b', 'c'), 0, 1);
    expect(texts(next)).toEqual(['a', 'b', 'a', 'b', 'c']);
    expect(new Set(next.map((b) => b.id)).size).toBe(5);
  });

  it('finds the row under a point and snaps past the edges', () => {
    const rows = [
      { top: 0, bottom: 30 },
      { top: 30, bottom: 60 },
      { top: 60, bottom: 90 },
    ];
    expect(blockIndexAtY(rows, -20)).toBe(0);
    expect(blockIndexAtY(rows, 45)).toBe(1);
    expect(blockIndexAtY(rows, 500)).toBe(2);
    expect(blockIndexAtY([], 10)).toBe(-1);
  });
});
