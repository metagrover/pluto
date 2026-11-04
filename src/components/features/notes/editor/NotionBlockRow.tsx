import { CheckSquare } from 'lucide-react';
import type React from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { NotionBlockGutter } from './NotionBlockGutter';
import { NotionCheckbox } from './NotionCheckbox';
import type { NotionBlock } from './types';

interface NotionBlockRowProps {
  block: NotionBlock;
  index: number;
  totalBlocks?: number;
  onChangeText: (index: number, text: string) => void;
  onKeyDown: (
    index: number,
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => void;
  onToggleChecked?: (index: number) => void;
  onAddBlockBelow?: (index: number) => void;
  onCycleBlockType?: (index: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  idPrefix?: string;
  extraMeta?: React.ReactNode;
  children?: React.ReactNode;
}

export const NotionBlockRow: React.FC<NotionBlockRowProps> = ({
  block,
  index,
  totalBlocks = 1,
  onChangeText,
  onKeyDown,
  onToggleChecked,
  onAddBlockBelow,
  onCycleBlockType,
  placeholder,
  autoFocus = false,
  className = '',
  textareaRef,
  idPrefix = 'note-block-',
  extraMeta,
  children,
}) => {
  const elementId = `${idPrefix}${index}`;

  const defaultPlaceholder =
    placeholder ||
    (block.type === 'h1'
      ? 'Heading 1'
      : block.type === 'h2'
        ? 'Heading 2'
        : block.type === 'h3'
          ? 'Heading 3'
          : block.type === 'quote'
            ? 'Empty quote'
            : block.type === 'todo' || block.type === 'task'
              ? 'To-do item'
              : block.type === 'bullet'
                ? 'List item'
                : index === 0 && totalBlocks === 1
                  ? "Type '/' for commands (/task, /person, /project)..."
                  : "Type '/' for commands...");

  return (
    <div
      className={`notion-block-row relative group/block py-0.5 ${className}`}
      data-block-type={block.type}
      data-block-id={block.id}
    >
      <div className="notion-gutter-container absolute -left-10 top-0.5 w-9 flex items-center justify-end select-none pointer-events-none group-hover/block:pointer-events-auto group-focus-within/block:pointer-events-auto z-10">
        <NotionBlockGutter
          blockType={block.type}
          onAddBlock={
            onAddBlockBelow ? () => onAddBlockBelow(index) : undefined
          }
          onGripClick={
            onCycleBlockType ? () => onCycleBlockType(index) : undefined
          }
        />
      </div>

      <div className="flex-1 min-w-0">
        {block.type === 'h1' ? (
          <TextareaAutosize
            ref={textareaRef}
            id={elementId}
            value={block.text}
            autoFocus={autoFocus}
            onChange={(e) => onChangeText(index, e.target.value)}
            onKeyDown={(e) => onKeyDown(index, e)}
            placeholder={defaultPlaceholder}
            className="notion-block-textarea text-2xl sm:text-3xl font-bold tracking-tight text-pro-text-main placeholder:text-pro-text-muted/30 pt-3 pb-1"
          />
        ) : block.type === 'h2' ? (
          <TextareaAutosize
            ref={textareaRef}
            id={elementId}
            value={block.text}
            autoFocus={autoFocus}
            onChange={(e) => onChangeText(index, e.target.value)}
            onKeyDown={(e) => onKeyDown(index, e)}
            placeholder={defaultPlaceholder}
            className="notion-block-textarea text-xl sm:text-2xl font-semibold tracking-tight text-pro-text-main placeholder:text-pro-text-muted/30 pt-2.5 pb-1"
          />
        ) : block.type === 'h3' ? (
          <TextareaAutosize
            ref={textareaRef}
            id={elementId}
            value={block.text}
            autoFocus={autoFocus}
            onChange={(e) => onChangeText(index, e.target.value)}
            onKeyDown={(e) => onKeyDown(index, e)}
            placeholder={defaultPlaceholder}
            className="notion-block-textarea text-lg font-semibold text-pro-text-main placeholder:text-pro-text-muted/30 pt-1.5 pb-0.5"
          />
        ) : block.type === 'quote' ? (
          <div className="border-l-2 border-pro-accent/50 pl-3.5 py-0.5 w-full">
            <TextareaAutosize
              ref={textareaRef}
              id={elementId}
              value={block.text}
              autoFocus={autoFocus}
              onChange={(e) => onChangeText(index, e.target.value)}
              onKeyDown={(e) => onKeyDown(index, e)}
              placeholder={defaultPlaceholder}
              className="notion-block-textarea text-[15px] italic leading-relaxed text-pro-text-main/90 placeholder:text-pro-text-muted/30"
            />
          </div>
        ) : block.type === 'task' ? (
          <div className="flex items-start gap-2.5 m-0 p-0 w-full group/task">
            <NotionCheckbox
              checked={Boolean(block.checked)}
              ariaLabel={
                block.checked ? 'Mark task incomplete' : 'Mark task complete'
              }
              onChange={() => onToggleChecked?.(index)}
              variant="task"
              className="mt-1"
            />
            <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
              <TextareaAutosize
                ref={textareaRef}
                id={elementId}
                value={block.text}
                autoFocus={autoFocus}
                onChange={(e) => onChangeText(index, e.target.value)}
                onKeyDown={(e) => onKeyDown(index, e)}
                placeholder={defaultPlaceholder}
                className={`notion-block-textarea text-[15px] leading-relaxed pt-0.5 ${
                  block.checked
                    ? 'line-through text-pro-text-muted/60'
                    : 'text-pro-text-main font-medium'
                }`}
              />
              <span className="opacity-0 group-hover/task:opacity-100 transition-opacity shrink-0 pt-0.5 text-[11px] text-pro-text-muted/40 select-none flex items-center gap-1 font-normal">
                <CheckSquare size={11} className="text-pro-accent/60" />
                Task
              </span>
            </div>
          </div>
        ) : block.type === 'todo' ? (
          <div className="flex items-start gap-2.5 m-0 p-0 w-full group/todo">
            <NotionCheckbox
              checked={Boolean(block.checked)}
              ariaLabel={
                block.checked
                  ? 'Mark checklist item incomplete'
                  : 'Mark checklist item complete'
              }
              onChange={() => onToggleChecked?.(index)}
              variant="todo"
              className="mt-1"
            />
            <TextareaAutosize
              ref={textareaRef}
              id={elementId}
              value={block.text}
              autoFocus={autoFocus}
              onChange={(e) => onChangeText(index, e.target.value)}
              onKeyDown={(e) => onKeyDown(index, e)}
              placeholder={defaultPlaceholder}
              className={`notion-block-textarea text-[15px] leading-relaxed pt-0.5 ${
                block.checked
                  ? 'line-through text-pro-text-muted/60'
                  : 'text-pro-text-main'
              }`}
            />
          </div>
        ) : block.type === 'bullet' ? (
          <div className="flex items-start gap-2.5 m-0 p-0 w-full">
            <span className="w-1.5 h-1.5 rounded-full bg-pro-text-muted mt-2.5 mr-0.5 shrink-0 select-none" />
            <TextareaAutosize
              ref={textareaRef}
              id={elementId}
              value={block.text}
              autoFocus={autoFocus}
              onChange={(e) => onChangeText(index, e.target.value)}
              onKeyDown={(e) => onKeyDown(index, e)}
              placeholder={defaultPlaceholder}
              className="notion-block-textarea text-[15px] leading-relaxed text-pro-text-main placeholder:text-pro-text-muted/30 pt-0.5"
            />
          </div>
        ) : (
          <TextareaAutosize
            ref={textareaRef}
            id={elementId}
            value={block.text}
            autoFocus={autoFocus}
            onChange={(e) => onChangeText(index, e.target.value)}
            onKeyDown={(e) => onKeyDown(index, e)}
            placeholder={defaultPlaceholder}
            className="notion-block-textarea text-[15px] leading-[1.68] text-pro-text-main placeholder:text-pro-text-muted/30 pt-0.5"
          />
        )}

        {extraMeta}
        {children}
      </div>
    </div>
  );
};
