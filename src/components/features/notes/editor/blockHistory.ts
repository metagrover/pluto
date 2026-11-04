import type { EditableBlock } from './blockOps';

/** Where the cursor was, so undo and redo can put it back. */
export interface HistoryCaret {
  index: number;
  start: number;
  end: number;
}

export interface HistoryEntry<T> {
  blocks: T[];
  caret: HistoryCaret | null;
}

/**
 * Index of the only block whose text changed, when nothing else did
 * (same blocks, same order, same types). -1 for anything structural.
 */
export function singleTextEditIndex<T extends EditableBlock>(
  prev: T[],
  next: T[],
): number {
  if (prev.length !== next.length) return -1;
  let changed = -1;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.id !== b.id || a.type !== b.type || a.checked !== b.checked) {
      return -1;
    }
    if (a.text !== b.text) {
      if (changed !== -1) return -1;
      changed = i;
    }
  }
  return changed;
}

/** First index where two block lists differ, or -1 when identical. */
export function firstChangedBlockIndex<T extends EditableBlock>(
  prev: T[],
  next: T[],
): number {
  const length = Math.max(prev.length, next.length);
  for (let i = 0; i < length; i++) {
    const a = prev[i];
    const b = next[i];
    if (
      !a ||
      !b ||
      a.id !== b.id ||
      a.type !== b.type ||
      a.text !== b.text ||
      a.checked !== b.checked
    ) {
      return i;
    }
  }
  return -1;
}

// Typing in one block counts as one step until a pause or a long run.
const TYPING_PAUSE_MS = 1_000;
const TYPING_GROUP_MAX_MS = 5_000;

/**
 * Undo/redo history for a note's blocks. Each entry is the state before an
 * edit plus where the cursor was, so undo restores both.
 */
export class BlockHistory<T extends EditableBlock> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private typing: { index: number; startedAt: number; lastAt: number } | null =
    null;

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Records an edit from `prev` to `next`. */
  record(
    prev: T[],
    next: T[],
    caret: HistoryCaret | null,
    now = Date.now(),
  ): void {
    if (prev === next || firstChangedBlockIndex(prev, next) === -1) return;
    const typedIndex = singleTextEditIndex(prev, next);
    const continuesTyping =
      typedIndex !== -1 &&
      this.typing !== null &&
      this.typing.index === typedIndex &&
      now - this.typing.lastAt < TYPING_PAUSE_MS &&
      now - this.typing.startedAt < TYPING_GROUP_MAX_MS;

    if (!continuesTyping) {
      this.past.push({
        blocks: prev,
        caret: caret ?? this.fallbackCaret(prev, next),
      });
      if (this.past.length > this.limit) this.past.shift();
      this.typing =
        typedIndex === -1
          ? null
          : { index: typedIndex, startedAt: now, lastAt: now };
    } else if (this.typing) {
      this.typing.lastAt = now;
    }
    this.future = [];
  }

  /** Returns the state to restore, or null when there is nothing to undo. */
  undo(current: T[], caret: HistoryCaret | null): HistoryEntry<T> | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ blocks: current, caret });
    this.typing = null;
    return entry;
  }

  redo(current: T[], caret: HistoryCaret | null): HistoryEntry<T> | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ blocks: current, caret });
    this.typing = null;
    return entry;
  }

  /** Ends the current typing group so the next edit is its own step. */
  breakGroup(): void {
    this.typing = null;
  }

  reset(): void {
    this.past = [];
    this.future = [];
    this.typing = null;
  }

  // Without a known cursor, return to the end of the first changed block.
  private fallbackCaret(prev: T[], next: T[]): HistoryCaret | null {
    const index = firstChangedBlockIndex(prev, next);
    if (index === -1 || !prev[index]) {
      return prev.length
        ? {
            index: prev.length - 1,
            start: prev[prev.length - 1].text.length,
            end: prev[prev.length - 1].text.length,
          }
        : null;
    }
    const length = prev[index].text.length;
    return { index, start: length, end: length };
  }
}
