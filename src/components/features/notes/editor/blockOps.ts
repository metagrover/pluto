// Pure helpers for Notion-style block editing. They work on any block shape
// with an id/type/text so the Notes view and shared editor can reuse them.

export interface EditableBlock {
  id: string;
  type: string;
  text: string;
  checked?: boolean;
}

export const newBlockId = (): string =>
  `b-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

export function moveBlock<T extends EditableBlock>(
  blocks: T[],
  from: number,
  to: number,
): T[] {
  if (
    from === to ||
    from < 0 ||
    from >= blocks.length ||
    to < 0 ||
    to >= blocks.length
  ) {
    return blocks;
  }
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function duplicateBlock<T extends EditableBlock>(
  blocks: T[],
  index: number,
): T[] {
  const block = blocks[index];
  if (!block) return blocks;
  const next = [...blocks];
  next.splice(index + 1, 0, { ...block, id: newBlockId() });
  return next;
}

export function removeBlock<T extends EditableBlock>(
  blocks: T[],
  index: number,
  emptyBlock: () => T,
): T[] {
  if (!blocks[index]) return blocks;
  const next = blocks.filter((_, i) => i !== index);
  return next.length > 0 ? next : [emptyBlock()];
}

/**
 * Where a block sits inside a run of consecutive task blocks, so tasks can be
 * drawn inside one shared container that sets them apart from checklists.
 */
export type TaskRunPosition = 'single' | 'start' | 'middle' | 'end' | null;

export function taskRunPosition(
  blocks: EditableBlock[],
  index: number,
): TaskRunPosition {
  if (blocks[index]?.type !== 'task') return null;
  const prevIsTask = blocks[index - 1]?.type === 'task';
  const nextIsTask = blocks[index + 1]?.type === 'task';
  if (!prevIsTask && !nextIsTask) return 'single';
  if (!prevIsTask) return 'start';
  if (!nextIsTask) return 'end';
  return 'middle';
}

/** 1-based number for a numbered-list block, counting its run of siblings. */
export function numberedListIndex(
  blocks: EditableBlock[],
  index: number,
): number {
  let n = 1;
  for (let i = index - 1; i >= 0 && blocks[i].type === 'numbered'; i--) n++;
  return n;
}

/**
 * Splits pasted multi-line text into blocks. Returns null for single-line
 * pastes so the browser's normal paste handles them.
 */
export function splitPasteIntoBlocks<T extends EditableBlock>(
  pasted: string,
  parse: (markdown: string) => T[],
): T[] | null {
  const normalized = pasted.replace(/\r\n?/g, '\n');
  if (!normalized.includes('\n')) return null;
  const parsed = parse(normalized.replace(/\n+$/, ''));
  return parsed.map((block) => ({ ...block, id: newBlockId() }));
}

/**
 * Inserts pasted blocks at the caret. The first pasted line joins the text
 * before the caret; the text after the caret follows the last pasted line.
 * Returns the new blocks and where the caret should land.
 */
export function insertPastedBlocks<T extends EditableBlock>(
  blocks: T[],
  index: number,
  selectionStart: number,
  selectionEnd: number,
  pasted: T[],
): { blocks: T[]; focusIndex: number; caret: number } {
  const current = blocks[index];
  if (!current || pasted.length === 0) {
    return { blocks, focusIndex: index, caret: selectionStart };
  }
  const before = current.text.slice(0, selectionStart);
  const after = current.text.slice(selectionEnd);
  const [first, ...rest] = pasted;
  const merged: T[] = [];

  // Keep the current block's type when it has text before the caret;
  // otherwise let the first pasted line decide (e.g. pasting "# Title").
  const firstBlock: T =
    before.length > 0
      ? { ...current, text: before + first.text }
      : { ...current, ...first, id: current.id };
  merged.push(firstBlock);
  merged.push(...rest);

  const last = merged[merged.length - 1];
  const caret = last.text.length;
  merged[merged.length - 1] = { ...last, text: last.text + after };

  const next = [...blocks];
  next.splice(index, 1, ...merged);
  return { blocks: next, focusIndex: index + merged.length - 1, caret };
}

/**
 * Whether the caret is on the first or last *visual* line of a textarea, so
 * arrow keys only jump between blocks at the edges, like Notion. Falls back
 * to logical lines when layout isn't available (e.g. jsdom).
 */
export function caretVisualEdges(textarea: HTMLTextAreaElement): {
  onFirstLine: boolean;
  onLastLine: boolean;
} {
  const { value, selectionStart, selectionEnd } = textarea;
  const logicalFirst = !value.slice(0, selectionStart).includes('\n');
  const logicalLast = !value.slice(selectionEnd).includes('\n');
  if (selectionStart !== selectionEnd) {
    return { onFirstLine: false, onLastLine: false };
  }

  const style = window.getComputedStyle(textarea);
  const lineHeight =
    Number.parseFloat(style.lineHeight) ||
    Number.parseFloat(style.fontSize) * 1.5 ||
    0;
  if (!lineHeight || textarea.clientWidth === 0) {
    return { onFirstLine: logicalFirst, onLastLine: logicalLast };
  }

  // Mirror the textarea to measure where the caret sits.
  const mirror = document.createElement('div');
  const props = [
    'boxSizing',
    'width',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'textTransform',
    'wordSpacing',
    'tabSize',
  ] as const;
  for (const prop of props) {
    mirror.style[prop] = style[prop];
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.width = `${textarea.clientWidth}px`;

  mirror.textContent = value.slice(0, selectionStart);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  mirror.appendChild(document.createTextNode(value.slice(selectionStart)));
  document.body.appendChild(mirror);
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const caretTop = marker.offsetTop - paddingTop;
  const contentHeight =
    mirror.scrollHeight -
    paddingTop -
    (Number.parseFloat(style.paddingBottom) || 0);
  document.body.removeChild(mirror);

  const totalLines = Math.max(1, Math.round(contentHeight / lineHeight));
  const caretLine = Math.round(caretTop / lineHeight);
  return {
    onFirstLine: caretLine <= 0,
    onLastLine: caretLine >= totalLines - 1,
  };
}

/**
 * Carries existing block ids over to freshly parsed blocks (by position) so
 * React keeps the same textareas mounted and the user's focus and caret
 * survive a re-parse. Extra blocks get new unique ids.
 */
export function reconcileBlockIds<T extends EditableBlock>(
  prev: T[],
  next: T[],
): T[] {
  return next.map((block, i) =>
    prev[i] ? { ...block, id: prev[i].id } : { ...block, id: newBlockId() },
  );
}

/**
 * Keeps the highlighted item of a scrollable menu visible while the user
 * moves through it with the arrow keys. Scrolls only the menu, never the page.
 */
export function scrollSelectedMenuItemIntoView(menu: HTMLElement | null): void {
  const item = menu?.querySelector<HTMLElement>('[data-selected="true"]');
  if (!menu || !item) return;
  const menuRect = menu.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const padding = 6;
  if (itemRect.top < menuRect.top + padding) {
    menu.scrollTop -= menuRect.top + padding - itemRect.top;
  } else if (itemRect.bottom > menuRect.bottom - padding) {
    menu.scrollTop += itemRect.bottom - (menuRect.bottom - padding);
  }
}

/**
 * A run of whole blocks selected together (Notion-style). The anchor stays
 * put while the focus moves with Shift+Arrow or a mouse drag.
 */
export interface BlockSelection {
  anchor: number;
  focus: number;
}

/** First and last selected index, clamped to the current blocks. */
export function selectionBounds(
  selection: BlockSelection,
  blockCount: number,
): [number, number] | null {
  if (blockCount === 0) return null;
  const clamp = (n: number) => Math.max(0, Math.min(blockCount - 1, n));
  const a = clamp(selection.anchor);
  const f = clamp(selection.focus);
  return [Math.min(a, f), Math.max(a, f)];
}

/** Replaces blocks start..end with new ones; never leaves the note empty. */
export function replaceBlockRange<T extends EditableBlock>(
  blocks: T[],
  start: number,
  end: number,
  replacement: T[],
  emptyBlock: () => T,
): T[] {
  const next = [
    ...blocks.slice(0, start),
    ...replacement,
    ...blocks.slice(end + 1),
  ];
  return next.length > 0 ? next : [emptyBlock()];
}

/** Moves blocks start..end up or down one place. Null at the edges. */
export function moveBlockRange<T extends EditableBlock>(
  blocks: T[],
  start: number,
  end: number,
  delta: -1 | 1,
): T[] | null {
  if (delta === -1 ? start <= 0 : end >= blocks.length - 1) return null;
  const range = blocks.slice(start, end + 1);
  const rest = [...blocks.slice(0, start), ...blocks.slice(end + 1)];
  rest.splice(start + delta, 0, ...range);
  return rest;
}

/** Copies blocks start..end (with fresh ids) right after the range. */
export function duplicateBlockRange<T extends EditableBlock>(
  blocks: T[],
  start: number,
  end: number,
): T[] {
  const copies = blocks
    .slice(start, end + 1)
    .map((block) => ({ ...block, id: newBlockId() }));
  return [...blocks.slice(0, end + 1), ...copies, ...blocks.slice(end + 1)];
}

/**
 * Index of the block row at a vertical position. Points above the first row
 * or below the last snap to that row, so drags past the edges still work.
 */
export function blockIndexAtY(
  rows: Array<{ top: number; bottom: number }>,
  y: number,
): number {
  if (rows.length === 0) return -1;
  if (y < rows[0].top) return 0;
  for (let i = 0; i < rows.length; i++) {
    if (y < rows[i].bottom) return i;
  }
  return rows.length - 1;
}
