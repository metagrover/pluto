import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Copy,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Minus,
  Quote,
  Trash2,
  Type,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useRef } from 'react';

export interface TurnIntoOption {
  type: string;
  label: string;
  icon: LucideIcon;
}

export const TURN_INTO_OPTIONS: TurnIntoOption[] = [
  { type: 'paragraph', label: 'Text', icon: Type },
  { type: 'h1', label: 'Heading 1', icon: Heading1 },
  { type: 'h2', label: 'Heading 2', icon: Heading2 },
  { type: 'h3', label: 'Heading 3', icon: Heading3 },
  { type: 'task', label: 'Task', icon: CheckSquare },
  { type: 'todo', label: 'Checklist', icon: ListChecks },
  { type: 'bullet', label: 'Bulleted list', icon: List },
  { type: 'numbered', label: 'Numbered list', icon: ListOrdered },
  { type: 'quote', label: 'Quote', icon: Quote },
  { type: 'divider', label: 'Divider', icon: Minus },
];

interface NotionBlockMenuProps {
  blockType: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onTurnInto: (type: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onClose: () => void;
  turnIntoOptions?: TurnIntoOption[];
}

const itemClass =
  'w-full flex items-center gap-2 px-2 py-1 rounded-md text-left text-[12px] text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent';

export const NotionBlockMenu: React.FC<NotionBlockMenuProps> = ({
  blockType,
  canMoveUp,
  canMoveDown,
  onTurnInto,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onClose,
  turnIntoOptions = TURN_INTO_OPTIONS,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>('button:not([disabled])')
      ?.focus();
    const handleOutside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])',
      ) ?? [],
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    items[(current + delta + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Block actions"
      onKeyDown={handleKeyDown}
      className="notion-block-menu pointer-events-auto absolute z-50 left-0 top-6 w-52 max-h-80 overflow-y-auto rounded-xl border border-pro-border/80 bg-pro-surface/98 dark:bg-[#1a1a1a]/98 backdrop-blur-md shadow-xl p-1.5 select-none"
    >
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={onDelete}
      >
        <Trash2 size={13} className="text-pro-text-muted" />
        <span className="flex-1">Delete</span>
        <kbd className="notion-block-menu__kbd">Del</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={onDuplicate}
      >
        <Copy size={13} className="text-pro-text-muted" />
        <span className="flex-1">Duplicate</span>
        <kbd className="notion-block-menu__kbd">⌘D</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={onMoveUp}
        disabled={!canMoveUp}
      >
        <ArrowUp size={13} className="text-pro-text-muted" />
        <span className="flex-1">Move up</span>
        <kbd className="notion-block-menu__kbd">⌘⇧↑</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={onMoveDown}
        disabled={!canMoveDown}
      >
        <ArrowDown size={13} className="text-pro-text-muted" />
        <span className="flex-1">Move down</span>
        <kbd className="notion-block-menu__kbd">⌘⇧↓</kbd>
      </button>
      <div className="my-1 border-t border-pro-border/50" />
      <div className="px-2 py-1 text-[10px] font-semibold text-pro-text-muted uppercase tracking-wider">
        Turn into
      </div>
      {turnIntoOptions.map((option) => {
        const Icon = option.icon;
        const active = option.type === blockType;
        return (
          <button
            key={option.type}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            className={`${itemClass} ${active ? 'text-pro-accent font-medium' : ''}`}
            onClick={() => onTurnInto(option.type)}
          >
            <Icon size={13} className="text-pro-text-muted" />
            <span className="flex-1">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};
