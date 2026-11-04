import {
  CheckSquare,
  Folder,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Type,
  User,
} from 'lucide-react';
import type React from 'react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { scrollSelectedMenuItemIntoView } from './blockOps';
import type {
  AvailableTask,
  EntityOption,
  SlashCommand,
  SlashMenuState,
} from './types';

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'task',
    title: 'Task',
    shortcut: '/task',
    keywords: ['task', 'action', 'item', 'todo'],
    description: 'Refer or create a task synced with Tasks ledger',
    icon: CheckSquare,
  },
  {
    id: 'todo',
    title: 'Checklist',
    shortcut: '/todo',
    keywords: ['todo', 'check', 'checklist', 'list'],
    description: 'Checkbox that stays in this note (not a task)',
    icon: ListChecks,
  },
  {
    id: 'person',
    title: 'Person',
    shortcut: '/person',
    keywords: ['person', 'people', 'mention', 'who', 'user'],
    description: 'Mention or link a person (@name)',
    icon: User,
  },
  {
    id: 'project',
    title: 'Project',
    shortcut: '/project',
    keywords: ['project', 'team', 'repo', 'tag'],
    description: 'Link or reference a project (#project)',
    icon: Folder,
  },
  {
    id: 'h1',
    title: 'Heading 1',
    shortcut: '/h1',
    keywords: ['h1', 'heading', 'title'],
    description: 'Big section heading',
    icon: Heading1,
  },
  {
    id: 'h2',
    title: 'Heading 2',
    shortcut: '/h2',
    keywords: ['h2', 'heading', 'subtitle'],
    description: 'Medium section heading',
    icon: Heading2,
  },
  {
    id: 'h3',
    title: 'Heading 3',
    shortcut: '/h3',
    keywords: ['h3', 'heading'],
    description: 'Small section heading',
    icon: Heading3,
  },
  {
    id: 'bullet',
    title: 'Bulleted list',
    shortcut: '/bullet',
    keywords: ['bullet', 'list', 'ul'],
    description: 'Create a simple bulleted list',
    icon: List,
  },
  {
    id: 'quote',
    title: 'Quote',
    shortcut: '/quote',
    keywords: ['quote', 'callout', 'cite'],
    description: 'Capture a quote or callout',
    icon: Quote,
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    shortcut: '/numbered',
    keywords: ['numbered', 'number', 'ordered', 'ol'],
    description: 'Create a list with numbering',
    icon: ListOrdered,
  },
  {
    id: 'divider',
    title: 'Divider',
    shortcut: '/divider',
    keywords: ['divider', 'line', 'hr', 'separator'],
    description: 'Visually divide sections',
    icon: Minus,
  },
  {
    id: 'paragraph',
    title: 'Text',
    shortcut: '/text',
    keywords: ['text', 'paragraph', 'plain'],
    description: 'Plain writing',
    icon: Type,
  },
];

/** Items the slash menu shows for its current mode and query. */
export function filterSlashMenuItems(
  state: Pick<SlashMenuState, 'mode' | 'query'>,
  entities: EntityOption[],
  commands: SlashCommand[] = DEFAULT_SLASH_COMMANDS,
): {
  commands: SlashCommand[];
  people: EntityOption[];
  projects: EntityOption[];
} {
  const q = state.query.toLowerCase().trim();
  const byName = (type: EntityOption['type']) =>
    entities.filter(
      (e) => e.type === type && (!q || e.name.toLowerCase().includes(q)),
    );
  return {
    commands:
      state.mode !== 'root'
        ? []
        : !q
          ? commands
          : commands.filter(
              (cmd) =>
                cmd.id.includes(q) ||
                cmd.title.toLowerCase().includes(q) ||
                cmd.shortcut.includes(q) ||
                cmd.keywords.some((k) => k.includes(q)),
            ),
    people: state.mode === 'person' ? byName('person') : [],
    projects: state.mode === 'project' ? byName('project') : [],
  };
}

interface NotionSlashMenuProps {
  state: SlashMenuState;
  entities: EntityOption[];
  tasks?: AvailableTask[];
  onExecuteCommand: (commandId: string) => void;
  onSelectPerson: (person: EntityOption) => void;
  onSelectProject: (project: EntityOption) => void;
  onSelectTask?: (task: AvailableTask) => void;
  onCreateTask?: (title: string) => void;
  onClose: () => void;
  commands?: SlashCommand[];
  className?: string;
}

export const NotionSlashMenu: React.FC<NotionSlashMenuProps> = ({
  state,
  entities,
  tasks = [],
  onExecuteCommand,
  onSelectPerson,
  onSelectProject,
  onSelectTask,
  onCreateTask,
  onClose: _onClose,
  commands = DEFAULT_SLASH_COMMANDS,
  className = '',
}) => {
  const {
    commands: filteredCommands,
    people: filteredPeople,
    projects: filteredProjects,
  } = useMemo(
    () => filterSlashMenuItems(state, entities, commands),
    [state, entities, commands],
  );

  const menuRef = useRef<HTMLDivElement>(null);
  // Keep the highlighted item visible during arrow-key moves.
  useLayoutEffect(() => {
    if (!state.isOpen) return;
    scrollSelectedMenuItemIntoView(menuRef.current);
  }, [state.isOpen, state.selectedIndex, state.mode]);

  const filteredTasks = useMemo(() => {
    if (state.mode !== 'task') return [];
    const q = state.query.toLowerCase().trim();
    if (!q) return tasks;
    return tasks.filter((t) => t.title.toLowerCase().includes(q));
  }, [state.mode, state.query, tasks]);

  if (!state.isOpen) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Slash commands"
      className={`slash-command-menu absolute z-50 left-6 top-full mt-1 w-72 max-h-72 overflow-y-auto rounded-xl border border-pro-border/80 bg-pro-surface/98 dark:bg-[#1a1a1a]/98 backdrop-blur-md shadow-xl p-1.5 text-xs text-pro-text-main notion-floating-menu select-none ${className}`}
    >
      {state.mode === 'root' ? (
        <>
          <div className="px-2 py-1 text-[10px] font-semibold text-pro-text-muted uppercase tracking-wider">
            Basic Blocks & Referrals
          </div>
          {filteredCommands.length === 0 ? (
            <div className="px-2 py-2 text-pro-text-muted text-[11px]">
              No matching command found
            </div>
          ) : (
            filteredCommands.map((cmd, cmdIdx) => {
              const Icon = cmd.icon;
              const isSelected = cmdIdx === state.selectedIndex;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  role="menuitem"
                  data-selected={isSelected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onExecuteCommand(cmd.id);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-pro-accent/15 text-pro-accent font-medium'
                      : 'hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-md border border-pro-border/50 flex items-center justify-center shrink-0 text-pro-text-muted">
                      <Icon size={13} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{cmd.title}</div>
                      <div className="text-[10px] text-pro-text-muted truncate">
                        {cmd.description}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-pro-text-muted shrink-0">
                    {cmd.shortcut}
                  </span>
                </button>
              );
            })
          )}
        </>
      ) : state.mode === 'person' ? (
        <>
          <div className="px-2 py-1 text-[10px] font-semibold text-pro-text-muted uppercase tracking-wider flex items-center justify-between">
            <span>Refer Person (@)</span>
            <span className="font-mono text-[9px] lowercase opacity-60">
              Esc to cancel
            </span>
          </div>
          {filteredPeople.length === 0 ? (
            <div className="px-2 py-2 text-pro-text-muted text-[11px]">
              No people found. Add people in the People tab.
            </div>
          ) : (
            filteredPeople.map((p, pIdx) => {
              const isSelected = pIdx === state.selectedIndex;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  data-selected={isSelected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectPerson(p);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-pro-accent/15 text-pro-accent font-medium'
                      : 'hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main'
                  }`}
                >
                  <div className="w-5 h-5 rounded-full bg-pro-accent/10 text-pro-accent flex items-center justify-center shrink-0 text-[10px] font-semibold">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[12px] truncate flex-1">{p.name}</span>
                  <span className="text-[10px] text-pro-text-muted font-mono shrink-0">
                    @{p.name.split(' ')[0]}
                  </span>
                </button>
              );
            })
          )}
        </>
      ) : state.mode === 'project' ? (
        <>
          <div className="px-2 py-1 text-[10px] font-semibold text-pro-text-muted uppercase tracking-wider flex items-center justify-between">
            <span>Refer Project (#)</span>
            <span className="font-mono text-[9px] lowercase opacity-60">
              Esc to cancel
            </span>
          </div>
          {filteredProjects.length === 0 ? (
            <div className="px-2 py-2 text-pro-text-muted text-[11px]">
              No projects found. Add projects in the Projects tab.
            </div>
          ) : (
            filteredProjects.map((p, pIdx) => {
              const isSelected = pIdx === state.selectedIndex;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  data-selected={isSelected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectProject(p);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-pro-accent/15 text-pro-accent font-medium'
                      : 'hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main'
                  }`}
                >
                  <Folder
                    size={13}
                    className="text-pro-accent/80 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-[12px] truncate flex-1">{p.name}</span>
                  <span className="text-[10px] text-pro-text-muted font-mono shrink-0">
                    #{p.name.split(' ')[0]}
                  </span>
                </button>
              );
            })
          )}
        </>
      ) : state.mode === 'task' ? (
        <>
          <div className="px-2 py-1 text-[10px] font-semibold text-pro-text-muted uppercase tracking-wider flex items-center justify-between">
            <span>Select or Create Task</span>
            <span className="font-mono text-[9px] lowercase opacity-60">
              Esc to cancel
            </span>
          </div>
          {state.query.trim() && onCreateTask ? (
            <button
              type="button"
              role="menuitem"
              onMouseDown={(e) => {
                e.preventDefault();
                onCreateTask(state.query);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-pro-accent/10 text-pro-accent transition-colors cursor-pointer mb-1 border-b border-pro-border/40 pb-2"
            >
              <Plus size={13} className="shrink-0" />
              <span className="text-[12px] truncate flex-1">
                Create new task: <strong>"{state.query}"</strong>
              </span>
            </button>
          ) : null}
          {filteredTasks.length === 0 ? (
            <div className="px-2 py-2 text-pro-text-muted text-[11px]">
              No existing tasks found. Type to create one.
            </div>
          ) : (
            filteredTasks.map((t, tIdx) => {
              const isSelected = tIdx === state.selectedIndex;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  data-selected={isSelected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectTask?.(t);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-pro-accent/15 text-pro-accent font-medium'
                      : 'hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main'
                  }`}
                >
                  <CheckSquare
                    size={13}
                    className="text-pro-accent/80 shrink-0"
                    aria-hidden="true"
                  />
                  <span
                    className={`text-[12px] truncate flex-1 ${
                      t.status === 'completed'
                        ? 'line-through text-pro-text-muted'
                        : ''
                    }`}
                  >
                    {t.title}
                  </span>
                </button>
              );
            })
          )}
        </>
      ) : null}
    </div>
  );
};
