import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  NotionBlockRow,
  detectMarkdownShortcut,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
} from './notes/editor';
import type { NotionBlock } from './notes/editor';
import './notes/notes.css';

const LIST_TYPES = new Set<NotionBlock['type']>(['todo', 'task', 'bullet']);

let blockSeq = 0;
const nextId = () => `live-${Date.now().toString(36)}-${blockSeq++}`;
const withFreshIds = (blocks: NotionBlock[]) =>
  blocks.map((block) => ({ ...block, id: nextId() }));

/**
 * Live meeting notes, edited the way notes are in Notes: "[] " makes a
 * checkbox, "- " a bullet, "# " a heading, and Enter continues a list. The
 * notes stay plain markdown, so everything after the meeting reads them as
 * before.
 */
export const LiveNotesEditor = ({
  value,
  onChange,
  idPrefix,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The first line's textarea gets `${idPrefix}0`, for its label. */
  idPrefix: string;
  placeholder: string;
}) => {
  const [blocks, setBlocks] = useState<NotionBlock[]>(() =>
    withFreshIds(parseMarkdownToBlocks(value)),
  );
  const emitted = useRef(value);
  const pendingFocus = useRef<{ index: number; caret: number } | null>(null);

  // Notes changed from outside (prep, "Use it"): show them as they are now.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setBlocks(withFreshIds(parseMarkdownToBlocks(value)));
  }, [value]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const element = document.getElementById(
      `${idPrefix}${target.index}`,
    ) as HTMLTextAreaElement | null;
    if (!element) return;
    element.focus();
    const caret = Math.min(target.caret, element.value.length);
    element.setSelectionRange(caret, caret);
  });

  const commit = (
    next: NotionBlock[],
    focus?: { index: number; caret: number },
  ) => {
    const safe = next.length
      ? next
      : [{ id: nextId(), type: 'paragraph' as const, text: '' }];
    if (focus) pendingFocus.current = focus;
    setBlocks(safe);
    const markdown = serializeBlocksToMarkdown(safe);
    if (markdown !== emitted.current) {
      emitted.current = markdown;
      onChange(markdown);
    }
  };

  const changeText = (index: number, text: string) => {
    const block = blocks[index];
    if (!block) return;
    // Pasted lines become their own blocks.
    if (text.includes('\n')) {
      const pasted = withFreshIds(
        parseMarkdownToBlocks(
          serializeBlocksToMarkdown([{ ...block, text }]).replace(/\n+$/, ''),
        ),
      );
      const next = [...blocks];
      next.splice(index, 1, ...pasted);
      const last = index + pasted.length - 1;
      commit(next, {
        index: last,
        caret: pasted[pasted.length - 1].text.length,
      });
      return;
    }
    if (block.type === 'paragraph') {
      const shortcut = detectMarkdownShortcut(text);
      if (shortcut) {
        const next = [...blocks];
        next[index] = {
          ...block,
          type: shortcut.type,
          text: shortcut.text,
          checked: shortcut.checked,
        };
        commit(next, { index, caret: shortcut.text.length });
        return;
      }
    }
    const next = [...blocks];
    next[index] = { ...block, text };
    commit(next);
  };

  const keyDown = (
    index: number,
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.nativeEvent.isComposing) return;
    const block = blocks[index];
    const element = event.currentTarget;
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? start;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (LIST_TYPES.has(block.type) && !block.text.trim()) {
        // Enter on an empty list item ends the list.
        const next = [...blocks];
        next[index] = { ...block, type: 'paragraph', checked: undefined };
        commit(next, { index, caret: 0 });
        return;
      }
      const before = block.text.slice(0, start);
      const after = block.text.slice(end);
      const continues = LIST_TYPES.has(block.type);
      const next = [...blocks];
      next[index] = { ...block, text: before };
      next.splice(index + 1, 0, {
        id: nextId(),
        type: continues ? block.type : 'paragraph',
        text: after,
        checked: continues && block.type !== 'bullet' ? false : undefined,
      });
      commit(next, { index: index + 1, caret: 0 });
      return;
    }
    if (event.key === 'Backspace' && start === 0 && end === 0) {
      if (block.type !== 'paragraph') {
        event.preventDefault();
        const next = [...blocks];
        next[index] = { ...block, type: 'paragraph', checked: undefined };
        commit(next, { index, caret: 0 });
        return;
      }
      if (index > 0) {
        event.preventDefault();
        const previous = blocks[index - 1];
        const next = [...blocks];
        next[index - 1] = { ...previous, text: previous.text + block.text };
        next.splice(index, 1);
        commit(next, { index: index - 1, caret: previous.text.length });
      }
      return;
    }
    if (event.key === 'ArrowUp' && start === 0 && end === 0 && index > 0) {
      event.preventDefault();
      pendingFocus.current = {
        index: index - 1,
        caret: blocks[index - 1].text.length,
      };
      setBlocks([...blocks]);
      return;
    }
    if (
      event.key === 'ArrowDown' &&
      start === block.text.length &&
      end === start &&
      index < blocks.length - 1
    ) {
      event.preventDefault();
      pendingFocus.current = { index: index + 1, caret: 0 };
      setBlocks([...blocks]);
    }
  };

  const toggle = (index: number) => {
    const next = [...blocks];
    next[index] = { ...next[index], checked: !next[index].checked };
    commit(next);
  };

  const onlyEmpty = blocks.length === 1 && !blocks[0].text;

  return (
    // Clicking the empty space below the notes continues the last line.
    <div
      className="live-notes-editor"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const last = blocks.length - 1;
        pendingFocus.current = { index: last, caret: blocks[last].text.length };
        setBlocks([...blocks]);
      }}
    >
      {blocks.map((block, index) => (
        <NotionBlockRow
          key={block.id}
          block={block}
          index={index}
          totalBlocks={blocks.length}
          idPrefix={idPrefix}
          onChangeText={changeText}
          onKeyDown={keyDown}
          onToggleChecked={toggle}
          placeholder={
            block.type === 'paragraph'
              ? onlyEmpty
                ? placeholder
                : ' '
              : undefined
          }
        />
      ))}
    </div>
  );
};
