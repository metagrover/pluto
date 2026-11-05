import {
  Calendar,
  Check,
  CheckSquare,
  FileText,
  Folder,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Type,
  User,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import {
  deleteNote,
  listNotes,
  saveNote,
  subscribeNotesChanged,
} from '../../../api/notes';
import {
  listTasks,
  saveTask,
  setTaskStatus,
  subscribeTasksChanged,
} from '../../../api/tasks';
import type { MeetingStartContext } from '../../../types/meetingStart';
import type { Note, NoteType, SaveNoteInput } from '../../../types/notes';
import { activeMentionQuery, matchPeople } from '../../../utils/noteMentions';
import { ownerOfLine } from '../../../utils/noteOwner';
import { Logo } from '../../Brand/Logo';
import { EmptyCanvas } from '../../ui/EmptyCanvas';
import {
  NoteAskPlutoPanel,
  type NoteAskPlutoSelection,
} from './NoteAskPlutoPanel';
import { NoteMeetingMenu } from './NoteMeetingMenu';
import {
  BlockHistory,
  type BlockSelection,
  type HistoryCaret,
  NotionBlockMenu,
  blockIndexAtY,
  caretVisualEdges,
  duplicateBlock,
  duplicateBlockRange,
  insertPastedBlocks,
  moveBlock,
  moveBlockRange,
  newBlockId,
  numberedListIndex,
  reconcileBlockIds,
  removeBlock,
  replaceBlockRange,
  scrollSelectedMenuItemIntoView,
  selectionBounds,
  splitPasteIntoBlocks,
  taskRunPosition,
} from './editor';
import { MentionTextarea } from './editor/MentionTextarea';
import './notes.css';

export interface NoteBlock {
  id: string;
  type:
    | 'h1'
    | 'h2'
    | 'h3'
    | 'todo'
    | 'task'
    | 'bullet'
    | 'numbered'
    | 'quote'
    | 'divider'
    | 'paragraph';
  text: string;
  checked?: boolean;
}

export interface SlashMenuState {
  isOpen: boolean;
  blockIndex: number;
  query: string;
  selectedIndex: number;
  mode: 'root' | 'person' | 'project' | 'task';
  /** Where the "@" is, when the person menu was opened by typing "@". */
  mentionStart?: number;
}

export const INITIAL_SLASH_MENU: SlashMenuState = {
  isOpen: false,
  blockIndex: -1,
  query: '',
  selectedIndex: 0,
  mode: 'root',
};

/** The line without the "/command" typed to open the slash menu. */
export const stripSlashQuery = (text: string): string =>
  text.replace(/^\/\S*\s?/, '');

export function isValidTaskTitle(title: string): boolean {
  const clean = title.trim();
  return Boolean(
    clean &&
      clean !== '/' &&
      !clean.startsWith('/task') &&
      clean.length >= 2 &&
      !/^jot down thoughts/i.test(clean),
  );
}

export function parseMarkdownToBlocks(markdown: string): NoteBlock[] {
  if (!markdown || !markdown.trim()) {
    return [{ id: 'b-0', type: 'paragraph', text: '' }];
  }

  const lines = markdown.split('\n');
  const blocks: NoteBlock[] = [];
  let blockCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      if (blocks.length > 0 && blocks[blocks.length - 1].text === '') {
        continue;
      }
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'paragraph',
        text: '',
      });
      continue;
    }

    if (line.startsWith('# ')) {
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'h1',
        text: line.substring(2).trim(),
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'h2',
        text: line.substring(3).trim(),
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'h3',
        text: line.substring(4).trim(),
      });
    } else if (line.startsWith('> ')) {
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'quote',
        text: line.substring(2).trim(),
      });
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ id: `b-${blockCounter++}`, type: 'divider', text: '' });
    } else if (/^\d+[.)]\s+/.test(line)) {
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'numbered',
        text: line.replace(/^\d+[.)]\s+/, ''),
      });
    } else {
      const taskMatch = line.match(
        /^(?:\[task(?::(done|x))?:\s*(.+?)\]|[-*]\s+\[([ xX])\]\s+\[task\]\s+(.+))$/i,
      );
      if (taskMatch) {
        const isDone = Boolean(
          taskMatch[1] || (taskMatch[3] && taskMatch[3].toLowerCase() === 'x'),
        );
        const text = (taskMatch[2] || taskMatch[4] || '').trim();
        blocks.push({
          id: `b-${blockCounter++}`,
          type: 'task',
          text,
          checked: isDone,
        });
      } else {
        const todoMatch = line.match(/^(\s*[-*]\s*\[)([ xX])(\])\s*(.*)$/);
        if (todoMatch) {
          blocks.push({
            id: `b-${blockCounter++}`,
            type: 'todo',
            text: todoMatch[4] || '',
            checked: todoMatch[2].toLowerCase() === 'x',
          });
        } else {
          const bulletMatch = line.match(/^(\s*[-*])\s+(.*)$/);
          if (bulletMatch) {
            blocks.push({
              id: `b-${blockCounter++}`,
              type: 'bullet',
              text: bulletMatch[2] || '',
            });
          } else {
            blocks.push({
              id: `b-${blockCounter++}`,
              type: 'paragraph',
              text: line,
            });
          }
        }
      }
    }
  }

  if (blocks.length === 0) {
    blocks.push({ id: 'b-0', type: 'paragraph', text: '' });
  }

  return blocks;
}

export function serializeBlocksToMarkdown(blocks: NoteBlock[]): string {
  return blocks
    .map((b, index) => {
      switch (b.type) {
        case 'h1':
          return `# ${b.text}`;
        case 'h2':
          return `## ${b.text}`;
        case 'h3':
          return `### ${b.text}`;
        case 'task':
          return `[task:${b.checked ? 'done:' : ''} ${b.text}]`;
        case 'todo':
          return `- [${b.checked ? 'x' : ' '}] ${b.text}`;
        case 'bullet':
          return `- ${b.text}`;
        case 'numbered':
          return `${numberedListIndex(blocks, index)}. ${b.text}`;
        case 'quote':
          return `> ${b.text}`;
        case 'divider':
          return '---';
        default:
          return b.text;
      }
    })
    .join('\n');
}

type BlockCaret = 'start' | 'end' | number | [number, number];

interface EntityOption {
  id: string;
  name: string;
  type: 'person' | 'project';
}

interface Props {
  initialNoteId?: string | null;
  onOpenTask?: (taskId: string) => void;
  onOpenMeeting?: (meetingId: string) => void;
  /** Starts a meeting with this note as its notes; absent while recording. */
  onStartMeeting?: (start: MeetingStartContext) => void;
  /** Opens a person's page from an "@Name" tag in the open note. */
  onOpenPerson?: (personId: string, fromNoteId: string | null) => void;
}

export const getDisplayTitle = (note: {
  title?: string;
  content: string;
  noteType: NoteType;
  targetName?: string | null;
}): string => {
  if (note.title?.trim()) return note.title.trim();
  const trimmed = note.content.trim();
  if (trimmed) {
    const firstLine = trimmed
      .split('\n')[0]
      .replace(/^[#\-\*\s\[\]xX]+/, '')
      .trim();
    if (firstLine) return firstLine.slice(0, 80);
  }
  if (note.noteType === 'scratchpad') return 'Daily Scratchpad';
  if (note.noteType === 'person' && note.targetName)
    return `Notes with ${note.targetName}`;
  if (note.noteType === 'project' && note.targetName)
    return `${note.targetName} Notes`;
  return 'Untitled Note';
};

export interface NoteTaskRef {
  id: string;
  title: string;
  status: 'active' | 'completed';
  sourceNoteId: string | null;
  sourceNoteLineId: string | null;
}

export const taskNoteSource = (
  metadata: unknown,
): Pick<NoteTaskRef, 'sourceNoteId' | 'sourceNoteLineId'> => {
  let parsed: unknown = metadata;
  if (typeof metadata === 'string') {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      parsed = null;
    }
  }
  const record =
    parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  return {
    sourceNoteId:
      typeof record.source_note_id === 'string' ? record.source_note_id : null,
    sourceNoteLineId:
      typeof record.source_note_line_id === 'string'
        ? record.source_note_line_id
        : null,
  };
};

const NOTE_TASK_LINE =
  /^(?:\[task(?::(?:done|x))?:\s*(.+?)\]|[-*]\s+\[[ xX]\]\s+\[task\]\s+(.+))$/i;

export const noteTaskLineTitle = (line: string): string | null => {
  const match = line.trim().match(NOTE_TASK_LINE);
  const title = (match?.[1] || match?.[2] || '').trim();
  return title || null;
};

/**
 * Finds the task a note line refers to, looking only at tasks created from
 * this note. A line whose text was edited keeps its task through its line id,
 * as long as that task's old title is no longer a task in the note.
 */
export const findNoteTask = (
  tasks: NoteTaskRef[],
  noteId: string,
  title: string,
  lineId?: string,
  noteTaskTitles?: Set<string>,
): NoteTaskRef | undefined => {
  const key = title.toLowerCase().trim();
  const own = tasks.filter((task) => task.sourceNoteId === noteId);
  const byTitle = own.find((task) => task.title.toLowerCase().trim() === key);
  if (byTitle || !lineId || !noteTaskTitles) return byTitle;
  return own.find(
    (task) =>
      task.sourceNoteLineId === lineId &&
      !noteTaskTitles.has(task.title.toLowerCase().trim()),
  );
};

export interface UpcomingMeetingForNote {
  title: string;
  startDate: string;
  personId: string;
  personName: string;
  /** True when the note is linked to this person, so prep will offer it. */
  linked: boolean;
}

const sameName = (a: string | undefined, b: string): boolean =>
  !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Finds an upcoming calendar meeting for the note's linked person, or, for a
 * note with no link yet, for a person it @mentions. Names must match exactly,
 * as they must for meeting prep to pick the note up.
 */
export const findUpcomingMeetingForNote = ({
  targetId,
  content,
  entities,
  events,
}: {
  targetId: string | null;
  content: string;
  entities: Array<{ id: string; name: string; type: string }>;
  events: Array<{
    title?: string;
    /** Calendar events carry `start`; `startDate` is accepted for older data. */
    start?: string;
    startDate?: string;
    attendees: Array<{ name?: string; email?: string }>;
  }>;
}): UpcomingMeetingForNote | null => {
  const people = entities.filter((entity) => entity.type === 'person');
  const target = entities.find((entity) => entity.id === targetId);
  const candidates = target
    ? target.type === 'person'
      ? [{ person: target, linked: true }]
      : []
    : people
        .filter((person) => content.includes(`@${person.name}`))
        .map((person) => ({ person, linked: false }));
  for (const { person, linked } of candidates) {
    const event = events.find((candidate) =>
      candidate.attendees.some((attendee) =>
        sameName(attendee.name, person.name),
      ),
    );
    if (event) {
      return {
        title: event.title || 'Meeting',
        startDate: event.start ?? event.startDate ?? '',
        personId: person.id,
        personName: person.name,
        linked,
      };
    }
  }
  return null;
};

export const toggleMarkdownTask = (text: string, taskIndex: number): string => {
  let currentTask = 0;
  return text.replace(
    /^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/gm,
    (line, prefix: string, state: string, suffix: string) => {
      if (currentTask++ !== taskIndex) return line;
      return `${prefix}${state.toLocaleLowerCase() === 'x' ? ' ' : 'x'}${suffix}`;
    },
  );
};

export function extractNoteTitleAndBlocks(
  rawTitle: string | undefined,
  rawContent: string,
  noteType: NoteType,
  _targetName?: string | null,
): { title: string; content: string; blocks: NoteBlock[] } {
  let initialBlocks = parseMarkdownToBlocks(rawContent);
  let effectiveTitle = (rawTitle || '').trim();

  // If content starts with an H1 heading
  if (initialBlocks.length > 0 && initialBlocks[0].type === 'h1') {
    const firstH1Text = initialBlocks[0].text.trim();
    if (!effectiveTitle) {
      // If note has no title, the H1 becomes the title
      effectiveTitle = firstH1Text;
      initialBlocks = initialBlocks.slice(1);
    } else if (
      effectiveTitle.toLowerCase() === firstH1Text.toLowerCase() ||
      (noteType === 'scratchpad' &&
        firstH1Text.toLowerCase() === 'daily scratchpad')
    ) {
      // If note title matches the H1 heading (e.g. "Daily Scratchpad"), strip the duplicate H1
      initialBlocks = initialBlocks.slice(1);
    }
  }

  // Strip leading empty paragraph if one exists right after the stripped heading
  if (
    initialBlocks.length > 0 &&
    initialBlocks[0].type === 'paragraph' &&
    initialBlocks[0].text === ''
  ) {
    initialBlocks = initialBlocks.slice(1);
  }

  // Ensure at least one block exists
  if (initialBlocks.length === 0) {
    initialBlocks = [{ id: 'b-0', type: 'paragraph', text: '' }];
  }

  return {
    title: effectiveTitle,
    content: serializeBlocksToMarkdown(initialBlocks),
    blocks: initialBlocks,
  };
}

export const NotesView = ({
  initialNoteId,
  onStartMeeting,
  onOpenPerson,
}: Props) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    initialNoteId || null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const ownerPeople = useMemo(
    () => entities.filter((entity) => entity.type === 'person'),
    [entities],
  );
  const openMentionedPerson = useMemo(
    () =>
      onOpenPerson
        ? (personId: string) => onOpenPerson(personId, selectedNoteId)
        : undefined,
    [onOpenPerson, selectedNoteId],
  );
  const [calendarEvents, setCalendarEvents] = useState<
    Array<{
      title: string;
      start?: string;
      startDate?: string;
      attendees: Array<{ name?: string; email?: string }>;
    }>
  >([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isConfirmingDeleteHeader, setIsConfirmingDeleteHeader] =
    useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const linkPickerRef = useRef<HTMLDivElement>(null);
  const linkSearchInputRef = useRef<HTMLInputElement>(null);
  const [focusedBlockIndex, setFocusedBlockIndex] = useState<number | null>(
    null,
  );
  // Ask Pluto side panel. The last focused block decides where answers land.
  const [askOpen, setAskOpen] = useState(false);
  const [askSelection, setAskSelection] =
    useState<NoteAskPlutoSelection | null>(null);
  const lastFocusedBlockRef = useRef<number | null>(null);
  // Whole blocks selected together (drag across blocks, Shift+Arrow, Esc).
  const [blockSelection, setBlockSelection] = useState<BlockSelection | null>(
    null,
  );
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Undo/redo for the note's blocks. Edits are recorded in one place (an
  // effect on `blocks`); loads, outside merges and undo itself are skipped.
  const historyRef = useRef(new BlockHistory<NoteBlock>());
  const lastBlocksRef = useRef<NoteBlock[] | null>(null);
  const skipHistoryRef = useRef(false);
  const preEditCaretRef = useRef<HistoryCaret | null>(null);
  const lastKeyboardHistoryAtRef = useRef(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const [freshBlockIds, setFreshBlockIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    if (focusedBlockIndex !== null) {
      lastFocusedBlockRef.current = focusedBlockIndex;
    }
  }, [focusedBlockIndex]);

  // Active note local edit buffer
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [blocks, setBlocks] = useState<NoteBlock[]>(() =>
    parseMarkdownToBlocks(''),
  );
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editPinned, setEditPinned] = useState(false);
  const [editType, setEditType] = useState<NoteType>('general');
  const [slashMenu, setSlashMenu] =
    useState<SlashMenuState>(INITIAL_SLASH_MENU);
  // Keep the highlighted slash command visible during arrow-key moves.
  useLayoutEffect(() => {
    if (!slashMenu.isOpen) return;
    scrollSelectedMenuItemIntoView(slashMenuRef.current);
  }, [slashMenu.isOpen, slashMenu.selectedIndex, slashMenu.mode]);

  const pendingSaveRef = useRef<{
    noteId: string;
    timeout: NodeJS.Timeout;
  } | null>(null);
  // Which note the edit buffers were loaded from, and the content of our
  // recent saves, so refresh echoes of our own saves are ignored.
  const loadedNoteIdRef = useRef<string | null>(null);
  const sentContentsRef = useRef<string[]>([]);
  const editContentRef = useRef(editContent);
  editContentRef.current = editContent;
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialNoteId) {
      setSelectedNoteId(initialNoteId);
    }
  }, [initialNoteId]);

  // Load notes
  const refreshNotes = useCallback(async () => {
    try {
      const loaded = await listNotes();
      setNotes(loaded);
      if (!selectedNoteId && loaded.length > 0) {
        setSelectedNoteId(loaded[0].id);
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
    }
  }, [selectedNoteId]);

  useEffect(() => {
    void refreshNotes();
    const unsub = subscribeNotesChanged(() => {
      void refreshNotes();
    });
    return () => unsub();
  }, [refreshNotes]);

  // Load entities for person & project linking
  useEffect(() => {
    const loadEntities = async () => {
      try {
        const [people, projects] = await Promise.all([
          window.ipcRenderer.invoke(
            'GET_ENTITIES_BY_TYPE',
            'person',
          ) as Promise<Array<{ id: string; name: string }>>,
          window.ipcRenderer.invoke(
            'GET_ENTITIES_BY_TYPE',
            'project',
          ) as Promise<Array<{ id: string; name: string }>>,
        ]);
        const mapped: EntityOption[] = [
          ...(people || []).map((p) => ({
            id: p.id,
            name: p.name,
            type: 'person' as const,
          })),
          ...(projects || []).map((p) => ({
            id: p.id,
            name: p.name,
            type: 'project' as const,
          })),
        ];
        setEntities(mapped);
      } catch (err) {
        console.error('Failed to load entities:', err);
      }
    };
    void loadEntities();
  }, []);

  // Load upcoming calendar events for ambient hints
  useEffect(() => {
    const loadCalendar = async () => {
      try {
        const now = new Date();
        const start = now.toISOString();
        const nextWeek = new Date(
          now.getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const events = (await window.ipcRenderer.invoke('CALENDAR_LIST_DAY', {
          start,
          end: nextWeek,
        })) as Array<{
          title: string;
          start?: string;
          startDate?: string;
          attendees: Array<{ name?: string; email?: string }>;
        }>;
        if (Array.isArray(events)) {
          setCalendarEvents(events);
        }
      } catch {
        // Calendar might not be configured or available; graceful fallback
      }
    };
    void loadCalendar();
  }, []);

  // When selected note changes, populate edit buffers. A refresh of the same
  // note (e.g. after our own autosave) must not rebuild the blocks: new block
  // ids remount every textarea and the user loses focus mid-typing.
  useEffect(() => {
    if (!selectedNoteId) return;
    const note = notes.find((n) => n.id === selectedNoteId);
    if (note && loadedNoteIdRef.current === selectedNoteId) {
      const isOwnSave = sentContentsRef.current.includes(note.content);
      const isSaving = pendingSaveRef.current?.noteId === selectedNoteId;
      if (isOwnSave || isSaving) return;
      // A genuine outside change (e.g. a task completed in Tasks): merge it in
      // while keeping block ids so focused editors stay mounted.
      const extracted = extractNoteTitleAndBlocks(
        note.title,
        note.content,
        note.noteType,
        note.targetName,
      );
      if (extracted.content !== editContentRef.current) {
        skipHistoryRef.current = true;
        setEditContent(extracted.content);
        setBlocks((prev) => reconcileBlockIds(prev, extracted.blocks));
      }
      setEditPinned(note.pinned);
      return;
    }
    if (note) {
      loadedNoteIdRef.current = selectedNoteId;
      sentContentsRef.current = [];
      const extracted = extractNoteTitleAndBlocks(
        note.title,
        note.content,
        note.noteType,
        note.targetName,
      );
      setEditTitle(extracted.title);
      setEditContent(extracted.content);
      historyRef.current.reset();
      lastBlocksRef.current = null;
      setBlocks(extracted.blocks);
      setEditTargetId(note.targetId || null);
      setEditPinned(note.pinned);
      setEditType(note.noteType);
      setConfirmDeleteId(null);
      setIsConfirmingDeleteHeader(false);
      setShowLinkPicker(false);
      setLinkSearchQuery('');
    }
  }, [selectedNoteId, notes]);

  // Focus search input when link picker opens
  useEffect(() => {
    if (showLinkPicker) {
      setTimeout(() => {
        linkSearchInputRef.current?.focus();
      }, 30);
    }
  }, [showLinkPicker]);

  // Close link picker on outside click
  useEffect(() => {
    if (!showLinkPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        linkPickerRef.current &&
        !linkPickerRef.current.contains(e.target as Node)
      ) {
        setShowLinkPicker(false);
        setLinkSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLinkPicker]);

  // Keep blocks in sync if editContent changes externally (e.g. from task extraction, tests)
  useEffect(() => {
    if (serializeBlocksToMarkdown(blocks) !== editContent) {
      setBlocks((prev) =>
        reconcileBlockIds(prev, parseMarkdownToBlocks(editContent)),
      );
    }
  }, [editContent]);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId),
    [notes, selectedNoteId],
  );

  const [availableTasks, setAvailableTasks] = useState<NoteTaskRef[]>([]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await listTasks();
      if (res?.tasks) {
        const mapped = res.tasks.map((t) => ({
          id: t.entity?.id ?? (t as unknown as { id: string }).id,
          title: t.entity?.name ?? (t as unknown as { title: string }).title,
          status:
            t.entity?.status === 'completed' ||
            (t as unknown as { status?: string }).status === 'completed'
              ? ('completed' as const)
              : ('active' as const),
          ...taskNoteSource(t.entity?.metadata),
        }));
        setAvailableTasks(mapped);
        return mapped;
      }
    } catch {}
    return [];
  }, []);

  useEffect(() => {
    void fetchTasks();
    const unsub = subscribeTasksChanged(async () => {
      const updatedTasks = await fetchTasks();
      if (updatedTasks.length > 0) {
        setBlocks((prevBlocks) => {
          let changed = false;
          const next = prevBlocks.map((b) => {
            if (b.type === 'task' && loadedNoteIdRef.current) {
              const matching = findNoteTask(
                updatedTasks,
                loadedNoteIdRef.current,
                b.text,
              );
              if (matching) {
                const isCompleted = matching.status === 'completed';
                if (Boolean(b.checked) !== isCompleted) {
                  changed = true;
                  return { ...b, checked: isCompleted };
                }
              }
            }
            return b;
          });
          if (changed) {
            // Synced from the Tasks list, not an edit to undo.
            skipHistoryRef.current = true;
            const nextMd = serializeBlocksToMarkdown(next);
            setEditContent(nextMd);
          }
          return changed ? next : prevBlocks;
        });
      }
    });
    return () => unsub();
  }, [fetchTasks]);

  // Sync tasks from note content into TasksView idempotently without triggering LED or toast notifications
  const syncTasksFromContent = useCallback(
    async (noteId: string, content: string, targetId: string | null) => {
      if (!noteId) return 0;
      const lines = content.split('\n');
      let count = 0;
      const targetEntity = entities.find((e) => e.id === targetId);
      const noteTaskTitles = new Set(
        lines.flatMap((line) => {
          const title = noteTaskLineTitle(line);
          return title ? [title.toLowerCase()] : [];
        }),
      );

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        // Only sync explicitly created/embedded tasks ([task: ...] or - [ ] [task] ...).
        // Checklists (- [ ]) stay local to the note and do NOT create tasks in Tasks ledger.
        const taskMatch = line
          .trim()
          .match(
            /^(?:\[task(?::(done|x))?:\s*(.+?)\]|[-*]\s+\[([ xX])\]\s+\[task\]\s+(.+))$/i,
          );

        if (taskMatch) {
          const isDone = Boolean(
            taskMatch[1] ||
              (taskMatch[3] && taskMatch[3].toLowerCase() === 'x'),
          );
          const text = (taskMatch[2] || taskMatch[4] || '').trim();
          if (!isValidTaskTitle(text)) continue;
          const sourceNoteLineId = `${noteId}:line:${lineIndex}`;
          const matching = findNoteTask(
            availableTasks,
            noteId,
            text,
            sourceNoteLineId,
            noteTaskTitles,
          );
          try {
            const taskId = await saveTask({
              id: matching?.id,
              title: text,
              status: isDone ? 'completed' : 'active',
              projectId:
                targetEntity?.type === 'project' ? targetEntity.id : undefined,
              sourceNoteId: noteId,
              sourceNoteLineId,
            });
            if (taskId) {
              await setTaskStatus(taskId, isDone ? 'completed' : 'active');
            }
            count++;
          } catch (e) {
            console.error('Failed to sync task:', e);
          }
        }
      }
      return count;
    },
    [entities, availableTasks],
  );

  // Debounced auto-save with automatic task synchronization
  const triggerAutoSave = useCallback(
    (updates: Partial<SaveNoteInput>, immediate = false) => {
      if (!selectedNoteId) return;
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current.timeout);
      pendingSaveRef.current = null;

      const performSave = async () => {
        pendingSaveRef.current = null;
        try {
          const contentToSave =
            updates.content !== undefined ? updates.content : editContent;
          sentContentsRef.current = [
            ...sentContentsRef.current.slice(-9),
            contentToSave,
          ];
          const targetIdToSave =
            updates.targetId !== undefined ? updates.targetId : editTargetId;
          await saveNote({
            id: selectedNoteId,
            title: updates.title !== undefined ? updates.title : editTitle,
            content: contentToSave,
            targetId: targetIdToSave,
            pinned: updates.pinned !== undefined ? updates.pinned : editPinned,
            noteType:
              updates.noteType !== undefined ? updates.noteType : editType,
          });
          // Automatically sync checklist items into Tasks ledger without flashing toasts or triggering LED
          void syncTasksFromContent(
            selectedNoteId,
            contentToSave,
            targetIdToSave,
          );
        } catch (err) {
          console.error('Failed to auto-save note:', err);
        }
      };

      if (immediate) {
        void performSave();
      } else {
        pendingSaveRef.current = {
          noteId: selectedNoteId,
          timeout: setTimeout(performSave, 400),
        };
      }
    },
    [
      selectedNoteId,
      editTitle,
      editContent,
      editTargetId,
      editPinned,
      editType,
      syncTasksFromContent,
    ],
  );

  const handleTitleChange = (val: string) => {
    setEditTitle(val);
    triggerAutoSave({ title: val });
  };

  const handleContentChange = (val: string) => {
    let transformed = val;
    // Replace /task at start of line with - [ ] title and auto-save task
    if (/(?:^|\n)\/task(?:\s+(.*))?$/im.test(transformed)) {
      transformed = transformed.replace(
        /(^|\n)\/task(?:\s+(.*))?$/gim,
        (_m, prefix, rest) => {
          const taskTitle = (rest || '').trim();
          if (taskTitle && selectedNoteId) {
            void saveTask({
              title: taskTitle,
              status: 'active',
              sourceNoteId: selectedNoteId,
              sourceNoteLineId: `${selectedNoteId}:task:${Date.now()}`,
            });
          }
          return `${prefix}[task: ${taskTitle}]`;
        },
      );
    }
    // Replace /todo or /checklist at start of line with checklist box - [ ] (checklist only, no task)
    if (/(?:^|\n)\/(?:todo|checklist)(?:\s+(.*))?$/im.test(transformed)) {
      transformed = transformed.replace(
        /(^|\n)\/(?:todo|checklist)(?:\s+(.*))?$/gim,
        (_m, prefix, rest) => `${prefix}- [ ] ${(rest || '').trim()}`,
      );
    }
    // Replace /person or /people followed by name
    if (/(?:^|\n)\/(person|people)\s+(.+)$/im.test(transformed)) {
      transformed = transformed.replace(
        /(^|\n)\/(person|people)\s+(.+)$/gim,
        (_m, prefix, _cmd, query) => {
          const match = entities.find(
            (e) =>
              e.type === 'person' &&
              e.name.toLowerCase().includes(query.trim().toLowerCase()),
          );
          return match ? `${prefix}@${match.name} ` : `${prefix}@${query} `;
        },
      );
    }
    // Replace /project followed by name
    if (/(?:^|\n)\/project\s+(.+)$/im.test(transformed)) {
      transformed = transformed.replace(
        /(^|\n)\/project\s+(.+)$/gim,
        (_m, prefix, query) => {
          const match = entities.find(
            (e) =>
              e.type === 'project' &&
              e.name.toLowerCase().includes(query.trim().toLowerCase()),
          );
          return match ? `${prefix}#${match.name} ` : `${prefix}#${query} `;
        },
      );
    }
    setEditContent(transformed);
    triggerAutoSave({ content: transformed });
  };

  const updateBlocks = useCallback(
    (nextBlocks: NoteBlock[]) => {
      setBlocks(nextBlocks);
      const nextMarkdown = serializeBlocksToMarkdown(nextBlocks);
      setEditContent(nextMarkdown);
      triggerAutoSave({ content: nextMarkdown });
    },
    [triggerAutoSave],
  );

  // Record every user edit to the blocks as an undo step.
  useEffect(() => {
    const prev = lastBlocksRef.current;
    lastBlocksRef.current = blocks;
    if (prev === null || skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    historyRef.current.record(prev, blocks, preEditCaretRef.current);
    preEditCaretRef.current = null;
  }, [blocks]);

  const currentCaret = (): HistoryCaret | null => {
    const el = document.activeElement;
    if (!(el instanceof HTMLTextAreaElement)) return null;
    const match = el.id.match(/^note-block-(\d+)$/);
    return match
      ? {
          index: Number(match[1]),
          start: el.selectionStart,
          end: el.selectionEnd,
        }
      : null;
  };

  const applyHistoryEntry = (entry: {
    blocks: NoteBlock[];
    caret: HistoryCaret | null;
  }) => {
    skipHistoryRef.current = true;
    setBlocks(entry.blocks);
    const markdown = serializeBlocksToMarkdown(entry.blocks);
    setEditContent(markdown);
    triggerAutoSave({ content: markdown });
    setBlockSelection(null);
    setSlashMenu(INITIAL_SLASH_MENU);
    const caret = entry.caret;
    if (caret && entry.blocks.length > 0) {
      const index = Math.min(caret.index, entry.blocks.length - 1);
      const length = entry.blocks[index].text.length;
      requestFocus(index, [
        Math.min(caret.start, length),
        Math.min(caret.end, length),
      ]);
    }
  };

  const undo = () => {
    const entry = historyRef.current.undo(blocks, currentCaret());
    if (entry) applyHistoryEntry(entry);
  };

  const redo = () => {
    const entry = historyRef.current.redo(blocks, currentCaret());
    if (entry) applyHistoryEntry(entry);
  };
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  // ⌘Z undoes, ⌘⇧Z or ⌘Y redoes. Returns true when it handled the key.
  const handleHistoryShortcut = (e: React.KeyboardEvent): boolean => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
    const key = e.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return false;
    e.preventDefault();
    lastKeyboardHistoryAtRef.current = Date.now();
    if (key === 'y' || e.shiftKey) redo();
    else undo();
    return true;
  };

  // Opens Ask Pluto. Text selected in a block becomes the question's focus.
  const openAskPluto = useCallback(() => {
    const bounds = blockSelection
      ? selectionBounds(blockSelection, blocks.length)
      : null;
    if (bounds) {
      const [start, end] = bounds;
      const text = serializeBlocksToMarkdown(blocks.slice(start, end + 1))
        .trim()
        .slice(0, 6_000);
      setAskSelection(
        text ? { text, blockIndex: end, blockCount: end - start + 1 } : null,
      );
      setAskOpen(true);
      return;
    }
    const index = lastFocusedBlockRef.current;
    const el =
      index === null ? null : document.getElementById(`note-block-${index}`);
    if (
      index !== null &&
      el instanceof HTMLTextAreaElement &&
      el.selectionStart !== el.selectionEnd
    ) {
      const text = el.value.slice(el.selectionStart, el.selectionEnd).trim();
      setAskSelection(text ? { text, blockIndex: index } : null);
    } else {
      setAskSelection(null);
    }
    setAskOpen(true);
  }, [blockSelection, blocks]);

  // Briefly highlights blocks Pluto added so the change is easy to spot.
  const flashBlocks = useCallback((added: NoteBlock[]) => {
    if (!added.length) return;
    const ids = new Set(added.map((block) => block.id));
    setFreshBlockIds(ids);
    window.setTimeout(() => {
      setFreshBlockIds((current) => (current === ids ? new Set() : current));
    }, 1_800);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-block-id="${added[0].id}"]`)
        ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

  const insertAnswerIntoNote = useCallback(
    (markdown: string) => {
      const parsed = parseMarkdownToBlocks(markdown.trim()).map((block) => ({
        ...block,
        id: newBlockId(),
      }));
      const anchor =
        askSelection?.blockIndex ?? lastFocusedBlockRef.current ?? null;
      const lastIsEmpty =
        blocks.length > 0 &&
        blocks[blocks.length - 1].type === 'paragraph' &&
        !blocks[blocks.length - 1].text.trim();
      const next =
        anchor !== null && anchor < blocks.length
          ? [
              ...blocks.slice(0, anchor + 1),
              ...parsed,
              ...blocks.slice(anchor + 1),
            ]
          : lastIsEmpty
            ? [...blocks.slice(0, -1), ...parsed]
            : [...blocks, ...parsed];
      updateBlocks(next);
      flashBlocks(parsed);
    },
    [askSelection, blocks, flashBlocks, updateBlocks],
  );

  const addSuggestedTasks = useCallback(
    (titles: string[]) => {
      const added: NoteBlock[] = titles
        .filter((title) => isValidTaskTitle(title))
        .map((title) => ({ id: newBlockId(), type: 'task', text: title }));
      if (!added.length) return;
      const lastIsEmpty =
        blocks.length > 0 &&
        blocks[blocks.length - 1].type === 'paragraph' &&
        !blocks[blocks.length - 1].text.trim();
      const base = lastIsEmpty ? blocks.slice(0, -1) : blocks;
      updateBlocks([...base, ...added]);
      flashBlocks(added);
    },
    [blocks, flashBlocks, updateBlocks],
  );

  // Focus a block's editor (or a divider) and place the caret.
  const focusBlock = useCallback((index: number, caret: BlockCaret = 'end') => {
    const el = document.getElementById(`note-block-${index}`) as
      | HTMLTextAreaElement
      | HTMLElement
      | null;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      const len = el.value.length;
      const [from, to] = Array.isArray(caret)
        ? caret
        : caret === 'start'
          ? [0, 0]
          : caret === 'end'
            ? [len, len]
            : [caret, caret];
      el.setSelectionRange(Math.min(from, len), Math.min(to, len));
    }
  }, []);

  // Move focus once React has rendered the change (not on a timer), so
  // keystrokes typed right after Enter/Backspace land in the right block.
  const pendingFocusRef = useRef<{ index: number; caret: BlockCaret } | null>(
    null,
  );
  const requestFocus = useCallback(
    (index: number, caret: BlockCaret = 'end') => {
      pendingFocusRef.current = { index, caret };
      // Fallback for changes that don't re-render
      requestAnimationFrame(() => {
        const pending = pendingFocusRef.current;
        if (!pending) return;
        pendingFocusRef.current = null;
        focusBlock(pending.index, pending.caret);
      });
    },
    [focusBlock],
  );
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    focusBlock(pending.index, pending.caret);
  });

  const [blockMenuIndex, setBlockMenuIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: 'before' | 'after';
  } | null>(null);

  const moveBlockAndFocus = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= blocks.length) return;
      updateBlocks(moveBlock(blocks, from, to));
      requestFocus(to);
    },
    [blocks, updateBlocks, focusBlock],
  );

  const duplicateBlockAndFocus = useCallback(
    (index: number) => {
      updateBlocks(duplicateBlock(blocks, index));
      requestFocus(index + 1);
    },
    [blocks, updateBlocks, focusBlock],
  );

  const deleteBlockAndFocus = useCallback(
    (index: number) => {
      updateBlocks(
        removeBlock(blocks, index, () => ({
          id: newBlockId(),
          type: 'paragraph',
          text: '',
        })),
      );
      requestFocus(Math.max(0, index - 1));
    },
    [blocks, updateBlocks, focusBlock],
  );

  const turnBlockInto = useCallback(
    (index: number, type: NoteBlock['type']) => {
      const block = blocks[index];
      if (!block) return;
      const next = [...blocks];
      next[index] = {
        ...block,
        type,
        text: type === 'divider' ? '' : block.text,
        checked:
          type === 'todo' || type === 'task'
            ? Boolean(block.checked)
            : undefined,
      };
      if (type === 'divider' && index === blocks.length - 1) {
        next.push({ id: newBlockId(), type: 'paragraph', text: '' });
      }
      updateBlocks(next);
      requestFocus(type === 'divider' ? index + 1 : index);
    },
    [blocks, updateBlocks, focusBlock],
  );

  const handleBlockPaste = (
    index: number,
    e: React.ClipboardEvent<HTMLElement>,
  ) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLTextAreaElement)) return;
    const pasted = splitPasteIntoBlocks(
      e.clipboardData.getData('text/plain'),
      parseMarkdownToBlocks,
    );
    if (!pasted) return;
    e.preventDefault();
    const result = insertPastedBlocks(
      blocks,
      index,
      target.selectionStart,
      target.selectionEnd,
      pasted,
    );
    updateBlocks(result.blocks);
    requestFocus(result.focusIndex, result.caret);
  };

  const handleBlockDrop = () => {
    if (dragIndex === null || !dropTarget) return;
    let to =
      dropTarget.position === 'after' ? dropTarget.index + 1 : dropTarget.index;
    if (dragIndex < to) to -= 1;
    if (to !== dragIndex) updateBlocks(moveBlock(blocks, dragIndex, to));
    setDragIndex(null);
    setDropTarget(null);
  };

  // ---- Block selection (several whole blocks at once) ----
  const selectedRange = blockSelection
    ? selectionBounds(blockSelection, blocks.length)
    : null;
  const emptyParagraph = useCallback(
    (): NoteBlock => ({ id: newBlockId(), type: 'paragraph', text: '' }),
    [],
  );

  // Selects blocks and moves keyboard focus to the canvas so copy, cut,
  // paste and shortcuts apply to the selection.
  const selectBlocks = useCallback(
    (anchor: number, focus: number) => {
      if (blocks.length === 0) return;
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement) {
        active.setSelectionRange(active.selectionEnd, active.selectionEnd);
      }
      window.getSelection()?.removeAllRanges();
      setBlockSelection({ anchor, focus });
      setSlashMenu(INITIAL_SLASH_MENU);
      canvasRef.current?.focus({ preventScroll: true });
    },
    [blocks.length],
  );

  // Remember where the cursor was before each edit, and route the app's
  // Edit > Undo/Redo menu (which arrives as a beforeinput event) to the
  // note history instead of the text box's own.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const remember = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLTextAreaElement)) return;
      const match = t.id.match(/^note-block-(\d+)$/);
      if (!match) return;
      preEditCaretRef.current = {
        index: Number(match[1]),
        start: t.selectionStart,
        end: t.selectionEnd,
      };
    };
    const onBeforeInput = (e: Event) => {
      const inputType = (e as InputEvent).inputType;
      if (inputType === 'historyUndo' || inputType === 'historyRedo') {
        e.preventDefault();
        // ⌘Z already ran it from the keydown handler.
        if (Date.now() - lastKeyboardHistoryAtRef.current < 150) return;
        if (inputType === 'historyUndo') undoRef.current();
        else redoRef.current();
        return;
      }
      remember(e);
    };
    canvas.addEventListener('keydown', remember, true);
    canvas.addEventListener('paste', remember, true);
    canvas.addEventListener('cut', remember, true);
    canvas.addEventListener('beforeinput', onBeforeInput, true);
    return () => {
      canvas.removeEventListener('keydown', remember, true);
      canvas.removeEventListener('paste', remember, true);
      canvas.removeEventListener('cut', remember, true);
      canvas.removeEventListener('beforeinput', onBeforeInput, true);
    };
  }, [activeNote?.id]);

  // Keep the moving end of the selection on screen.
  useEffect(() => {
    if (!blockSelection) return;
    document
      .querySelector(`[data-block-index="${blockSelection.focus}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [blockSelection]);

  // A different note starts with nothing selected.
  useEffect(() => {
    setBlockSelection(null);
  }, [selectedNoteId]);

  const selectedMarkdown = useCallback(() => {
    if (!selectedRange) return '';
    const [start, end] = selectedRange;
    return serializeBlocksToMarkdown(blocks.slice(start, end + 1));
  }, [blocks, selectedRange]);

  const deleteSelectedBlocks = useCallback(() => {
    if (!selectedRange) return;
    const [start, end] = selectedRange;
    const next = replaceBlockRange(blocks, start, end, [], emptyParagraph);
    updateBlocks(next);
    setBlockSelection(null);
    if (start === 0) requestFocus(0, 'start');
    else requestFocus(Math.min(start - 1, next.length - 1), 'end');
  }, [blocks, emptyParagraph, requestFocus, selectedRange, updateBlocks]);

  const pasteOverSelectedBlocks = useCallback(
    (text: string) => {
      if (!selectedRange) return;
      const [start, end] = selectedRange;
      const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
      const pasted = normalized
        ? parseMarkdownToBlocks(normalized).map((block) => ({
            ...block,
            id: newBlockId(),
          }))
        : [];
      const next = replaceBlockRange(
        blocks,
        start,
        end,
        pasted,
        emptyParagraph,
      );
      updateBlocks(next);
      setBlockSelection(null);
      requestFocus(
        Math.min(start + Math.max(pasted.length, 1) - 1, next.length - 1),
        'end',
      );
    },
    [blocks, emptyParagraph, requestFocus, selectedRange, updateBlocks],
  );

  const turnSelectedBlocksInto = useCallback(
    (type: NoteBlock['type']) => {
      if (!selectedRange || type === 'divider') return;
      const [start, end] = selectedRange;
      const next = blocks.map((block, i) =>
        i < start || i > end || block.type === 'divider'
          ? block
          : {
              ...block,
              type,
              checked:
                type === 'todo' || type === 'task'
                  ? Boolean(block.checked)
                  : undefined,
            },
      );
      updateBlocks(next);
    },
    [blocks, selectedRange, updateBlocks],
  );

  // Keyboard while blocks are selected (focus sits on the canvas).
  const handleSelectionKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selectedRange || !blockSelection || e.target !== e.currentTarget) {
      return;
    }
    if (handleHistoryShortcut(e)) return;
    const [start, end] = selectedRange;
    const mod = e.metaKey || e.ctrlKey;
    const last = blocks.length - 1;

    if (e.key === 'Escape') {
      e.preventDefault();
      setBlockSelection(null);
    } else if (e.key === 'Enter' && !mod) {
      e.preventDefault();
      setBlockSelection(null);
      requestFocus(blockSelection.focus, 'end');
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      deleteSelectedBlocks();
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setBlockSelection({ anchor: 0, focus: last });
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      updateBlocks(duplicateBlockRange(blocks, start, end));
      setBlockSelection({ anchor: end + 1, focus: end + 1 + (end - start) });
    } else if (
      mod &&
      e.shiftKey &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    ) {
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      const moved = moveBlockRange(blocks, start, end, delta);
      if (!moved) return;
      updateBlocks(moved);
      setBlockSelection({
        anchor: blockSelection.anchor + delta,
        focus: blockSelection.focus + delta,
      });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      const focus = Math.max(0, Math.min(last, blockSelection.focus + delta));
      setBlockSelection(
        e.shiftKey
          ? { anchor: blockSelection.anchor, focus }
          : {
              anchor:
                e.key === 'ArrowUp'
                  ? Math.max(0, start - 1)
                  : Math.min(last, end + 1),
              focus:
                e.key === 'ArrowUp'
                  ? Math.max(0, start - 1)
                  : Math.min(last, end + 1),
            },
      );
    } else if (mod && e.altKey) {
      const byDigit: Record<string, NoteBlock['type']> = {
        Digit0: 'paragraph',
        Digit1: 'h1',
        Digit2: 'h2',
        Digit3: 'h3',
        Digit4: 'todo',
        Digit5: 'bullet',
        Digit6: 'numbered',
      };
      const type = byDigit[e.code];
      if (type) {
        e.preventDefault();
        turnSelectedBlocksInto(type);
      }
    }
  };

  // Mouse: drag from one block into another to select whole blocks, or
  // Shift+click to extend from the block you were in.
  const rowRects = () =>
    Array.from(
      canvasRef.current?.querySelectorAll<HTMLElement>('.note-block-row') ?? [],
    ).map((row) => row.getBoundingClientRect());

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button, input, a, [role="menu"], .notion-gutter-container, .slash-command-menu',
      )
    ) {
      if (blockSelection && !e.shiftKey) setBlockSelection(null);
      return;
    }
    const index = blockIndexAtY(rowRects(), e.clientY);
    if (index < 0) return;

    if (e.shiftKey) {
      const anchor = blockSelection?.anchor ?? lastFocusedBlockRef.current;
      // Shift+click inside the block being edited extends its text instead.
      const extendsText = !blockSelection && anchor === index;
      if (anchor !== null && anchor !== undefined && !extendsText) {
        e.preventDefault();
        selectBlocks(anchor, index);
        return;
      }
    }
    if (blockSelection) setBlockSelection(null);

    const start = index;
    let active = false;
    const onMove = (move: MouseEvent) => {
      if (!(move.buttons & 1)) {
        onUp();
        return;
      }
      const over = blockIndexAtY(rowRects(), move.clientY);
      if (over < 0) return;
      if (!active && over === start) return;
      if (!active) {
        active = true;
        setIsDragSelecting(true);
      }
      move.preventDefault();
      selectBlocks(start, over);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (active) {
        setIsDragSelecting(false);
        canvasRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Notion-style slash commands catalog
  const slashCommands = useMemo(
    () => [
      {
        id: 'task',
        title: 'Task',
        shortcut: '/task',
        keywords: ['task', 'action', 'item'],
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
        keywords: ['numbered', 'number', 'ordered', 'ol', '1.'],
        description: 'Create a list with numbering',
        icon: ListOrdered,
      },
      {
        id: 'divider',
        title: 'Divider',
        shortcut: '/divider',
        keywords: ['divider', 'line', 'hr', 'separator', '---'],
        description: 'Visually divide blocks',
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
    ],
    [],
  );

  const filteredCommands = useMemo(() => {
    if (!slashMenu.isOpen || slashMenu.mode !== 'root') return [];
    const q = slashMenu.query.toLowerCase().trim();
    if (!q) return slashCommands;
    return slashCommands.filter(
      (cmd) =>
        cmd.id.includes(q) ||
        cmd.title.toLowerCase().includes(q) ||
        cmd.shortcut.includes(q) ||
        cmd.keywords.some((k) => k.includes(q)),
    );
  }, [slashMenu.isOpen, slashMenu.mode, slashMenu.query, slashCommands]);

  const filteredPeople = useMemo(() => {
    if (!slashMenu.isOpen || slashMenu.mode !== 'person') return [];
    return matchPeople(ownerPeople, slashMenu.query);
  }, [slashMenu.isOpen, slashMenu.mode, slashMenu.query, ownerPeople]);

  const filteredProjects = useMemo(() => {
    if (!slashMenu.isOpen || slashMenu.mode !== 'project') return [];
    const q = slashMenu.query.toLowerCase().trim();
    const all = entities.filter((e) => e.type === 'project');
    if (!q) return all;
    return all.filter((p) => p.name.toLowerCase().includes(q));
  }, [slashMenu.isOpen, slashMenu.mode, slashMenu.query, entities]);

  useEffect(() => {
    if (slashMenu.isOpen && slashMenu.mode === 'task') {
      void fetchTasks();
    }
  }, [slashMenu.isOpen, slashMenu.mode, fetchTasks]);

  const filteredTasks = useMemo(() => {
    if (!slashMenu.isOpen || slashMenu.mode !== 'task') return [];
    const q = slashMenu.query.toLowerCase().trim();
    if (!q) return availableTasks;
    return availableTasks.filter((t) => t.title.toLowerCase().includes(q));
  }, [slashMenu.isOpen, slashMenu.mode, slashMenu.query, availableTasks]);

  const executeSlashCommand = useCallback(
    (commandId: string, blockIndex: number) => {
      const block = blocks[blockIndex];
      if (!block) return;

      if (commandId === 'task') {
        const queryText = stripSlashQuery(block.text).trim();
        const isValid = isValidTaskTitle(queryText);
        const next = [...blocks];
        next[blockIndex] = {
          ...block,
          type: 'task',
          checked: false,
          text: queryText === '/' ? '' : queryText,
        };
        updateBlocks(next);
        if (selectedNoteId && isValid) {
          void saveTask({
            title: queryText,
            status: 'active',
            sourceNoteId: selectedNoteId,
            sourceNoteLineId: `${selectedNoteId}:line:${blockIndex}`,
          });
        }
        setSlashMenu(INITIAL_SLASH_MENU);
        requestFocus(blockIndex, 'end');
      } else if (commandId === 'todo') {
        const queryText = stripSlashQuery(block.text).trim();
        const next = [...blocks];
        next[blockIndex] = {
          ...block,
          type: 'todo',
          checked: false,
          text: queryText,
        };
        updateBlocks(next);
        setSlashMenu(INITIAL_SLASH_MENU);
        requestFocus(blockIndex, 'end');
      } else if (commandId === 'person' || commandId === 'project') {
        // Swap "/person" for "@" (or "#") so further typing filters the list.
        const sigil = commandId === 'person' ? '@' : '#';
        const next = [...blocks];
        next[blockIndex] = {
          ...block,
          text: `${sigil}${stripSlashQuery(block.text)}`,
        };
        updateBlocks(next);
        setSlashMenu({
          isOpen: true,
          blockIndex,
          query: '',
          selectedIndex: 0,
          mode: commandId,
          mentionStart: 0,
        });
        requestFocus(blockIndex, 1);
      } else if (commandId === 'divider') {
        const next = [...blocks];
        next[blockIndex] = { ...block, type: 'divider', text: '' };
        next.splice(blockIndex + 1, 0, {
          id: newBlockId(),
          type: 'paragraph',
          text: '',
        });
        updateBlocks(next);
        setSlashMenu(INITIAL_SLASH_MENU);
        requestFocus(blockIndex + 1, 'start');
      } else if (
        commandId === 'h1' ||
        commandId === 'h2' ||
        commandId === 'h3' ||
        commandId === 'bullet' ||
        commandId === 'numbered' ||
        commandId === 'quote' ||
        commandId === 'paragraph'
      ) {
        const next = [...blocks];
        next[blockIndex] = {
          ...block,
          type: commandId as NoteBlock['type'],
          text: stripSlashQuery(block.text),
        };
        updateBlocks(next);
        setSlashMenu(INITIAL_SLASH_MENU);
        requestFocus(blockIndex, 'end');
      }
    },
    [blocks, updateBlocks, selectedNoteId],
  );

  const selectCreateTaskFromSlash = useCallback(
    async (taskTitleQuery: string, blockIndex: number) => {
      const title = taskTitleQuery.trim() || 'New task';
      const block = blocks[blockIndex];
      if (!block) return;
      const cleanTitle = title.trim();
      const isValid = isValidTaskTitle(cleanTitle);
      const next = [...blocks];
      next[blockIndex] = {
        ...block,
        type: 'task',
        checked: false,
        text: cleanTitle === '/' ? '' : cleanTitle,
      };
      updateBlocks(next);
      setSlashMenu(INITIAL_SLASH_MENU);
      if (selectedNoteId && isValid) {
        try {
          await saveTask({
            title: cleanTitle,
            status: 'active',
            sourceNoteId: selectedNoteId,
            sourceNoteLineId: `${selectedNoteId}:line:${blockIndex}`,
          });
        } catch (err) {
          console.error('Failed to create task from slash:', err);
        }
      }
      requestFocus(blockIndex, 'end');
    },
    [blocks, updateBlocks, selectedNoteId],
  );

  const selectExistingTaskFromSlash = useCallback(
    (
      task: { id: string; title: string; status: 'active' | 'completed' },
      blockIndex: number,
    ) => {
      const block = blocks[blockIndex];
      if (!block) return;
      const next = [...blocks];
      next[blockIndex] = {
        ...block,
        type: 'task',
        checked: task.status === 'completed',
        text: task.title,
      };
      updateBlocks(next);
      setSlashMenu(INITIAL_SLASH_MENU);
      if (selectedNoteId) {
        void saveTask({
          id: task.id,
          title: task.title,
          status: task.status,
          sourceNoteId: selectedNoteId,
          sourceNoteLineId: `${selectedNoteId}:line:${blockIndex}`,
        });
      }
      requestFocus(blockIndex, 'end');
    },
    [blocks, updateBlocks, selectedNoteId],
  );

  const selectPersonFromSlash = useCallback(
    (person: EntityOption, blockIndex: number) => {
      const block = blocks[blockIndex];
      if (!block) return;
      const next = [...blocks];
      const insert = `@${person.name} `;
      const typed = `@${slashMenu.query}`;
      // Find the typed "@query" again: a shortcut like "[] " may have
      // stripped a prefix since the menu opened, moving it left.
      const start =
        slashMenu.mentionStart === undefined
          ? -1
          : block.text.lastIndexOf(typed, slashMenu.mentionStart);
      if (start !== -1) {
        // Typed "@query": replace it with the name, keeping the text around it.
        const end = start + typed.length;
        const after = block.text.slice(end).replace(/^ /, '');
        next[blockIndex] = {
          ...block,
          text: `${block.text.slice(0, start)}${insert}${after}`,
        };
        updateBlocks(next);
        setSlashMenu(INITIAL_SLASH_MENU);
        requestFocus(blockIndex, start + insert.length);
        return;
      }
      const cleanText = stripSlashQuery(block.text).trim();
      next[blockIndex] = {
        ...block,
        text: cleanText ? `${cleanText} ${insert}` : insert,
      };
      updateBlocks(next);
      setSlashMenu(INITIAL_SLASH_MENU);
      requestFocus(blockIndex, 'end');
    },
    [
      blocks,
      updateBlocks,
      requestFocus,
      slashMenu.mentionStart,
      slashMenu.query,
    ],
  );

  const selectProjectFromSlash = useCallback(
    (project: EntityOption, blockIndex: number) => {
      const block = blocks[blockIndex];
      if (!block) return;
      const next = [...blocks];
      const insert = `#${project.name} `;
      const typed = `#${slashMenu.query}`;
      const start =
        slashMenu.mentionStart === undefined
          ? -1
          : block.text.lastIndexOf(typed, slashMenu.mentionStart);
      if (start !== -1) {
        // Typed "#query": replace it with the name, keeping the text around it.
        const after = block.text.slice(start + typed.length).replace(/^ /, '');
        next[blockIndex] = {
          ...block,
          text: `${block.text.slice(0, start)}${insert}${after}`,
        };
        updateBlocks(next);
        setSlashMenu(INITIAL_SLASH_MENU);
        requestFocus(blockIndex, start + insert.length);
        return;
      }
      const cleanText = stripSlashQuery(block.text).trim();
      next[blockIndex] = {
        ...block,
        text: cleanText ? `${cleanText} ${insert}` : insert,
      };
      updateBlocks(next);
      setSlashMenu(INITIAL_SLASH_MENU);
      requestFocus(blockIndex, 'end');
    },
    [
      blocks,
      updateBlocks,
      requestFocus,
      slashMenu.mentionStart,
      slashMenu.query,
    ],
  );

  useEffect(() => {
    if (!slashMenu.isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.slash-command-menu')) {
        setSlashMenu(INITIAL_SLASH_MENU);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [slashMenu.isOpen]);

  // An "@" whose menu was closed with Esc stays plain text.
  const dismissedMentionRef = useRef<{ index: number; start: number } | null>(
    null,
  );

  const handleBlockTextChange = useCallback(
    (index: number, val: string) => {
      // Check for slash command trigger in blocks
      if (val.startsWith('/')) {
        const slashQuery = val.slice(1);
        // If /task command typed with space (e.g. "/task ") or exact "/task"
        if (
          /^\/task(\s+(.*))?$/i.test(val) &&
          (val.includes(' ') || val.length >= 5)
        ) {
          const match = val.match(/^\/task(\s+(.*))?$/i);
          const taskTitle = (match?.[2] ?? '').trim();
          const isValid = isValidTaskTitle(taskTitle);
          setBlocks((prev) => {
            const next = [...prev];
            next[index] = {
              ...next[index],
              type: 'task',
              checked: false,
              text: taskTitle === '/' ? '' : taskTitle,
            };
            const nextMarkdown = serializeBlocksToMarkdown(next);
            setEditContent(nextMarkdown);
            triggerAutoSave({ content: nextMarkdown }, true);
            if (isValid && selectedNoteId) {
              void saveTask({
                title: taskTitle,
                status: 'active',
                sourceNoteId: selectedNoteId,
                sourceNoteLineId: `${selectedNoteId}:line:${index}`,
              });
            }
            return next;
          });
          setSlashMenu(INITIAL_SLASH_MENU);
          requestFocus(index, 'end');
          return;
        }

        // If /todo command typed with space (e.g. "/todo ") or exact "/todo"
        if (
          /^\/(?:todo|checklist)(\s+(.*))?$/i.test(val) &&
          (val.includes(' ') || val.length >= 5)
        ) {
          const match = val.match(/^\/(?:todo|checklist)(\s+(.*))?$/i);
          const todoTitle = (match?.[1] ?? '').trim();
          setBlocks((prev) => {
            const next = [...prev];
            next[index] = {
              ...next[index],
              type: 'todo',
              checked: false,
              text: todoTitle,
            };
            const nextMarkdown = serializeBlocksToMarkdown(next);
            setEditContent(nextMarkdown);
            triggerAutoSave({ content: nextMarkdown }, true);
            return next;
          });
          setSlashMenu(INITIAL_SLASH_MENU);
          requestFocus(index, 'end');
          return;
        }

        // If person shortcut "/person [name]" or "/people [name]" typed with space
        if (/^\/(person|people)\s+(.*)$/i.test(val)) {
          const query = val
            .replace(/^\/(person|people)\s+/i, '')
            .trim()
            .toLowerCase();
          const match = query
            ? entities.find(
                (e) =>
                  e.type === 'person' && e.name.toLowerCase().includes(query),
              )
            : null;
          if (match) {
            setBlocks((prev) => {
              const next = [...prev];
              next[index] = {
                ...next[index],
                text: `@${match.name} `,
              };
              const nextMarkdown = serializeBlocksToMarkdown(next);
              setEditContent(nextMarkdown);
              triggerAutoSave({ content: nextMarkdown });
              return next;
            });
            setSlashMenu(INITIAL_SLASH_MENU);
            return;
          }
        }

        // If project shortcut "/project [name]" typed with space
        if (/^\/project\s+(.*)$/i.test(val)) {
          const query = val
            .replace(/^\/project\s+/i, '')
            .trim()
            .toLowerCase();
          const match = query
            ? entities.find(
                (e) =>
                  e.type === 'project' && e.name.toLowerCase().includes(query),
              )
            : null;
          if (match) {
            setBlocks((prev) => {
              const next = [...prev];
              next[index] = {
                ...next[index],
                text: `#${match.name} `,
              };
              const nextMarkdown = serializeBlocksToMarkdown(next);
              setEditContent(nextMarkdown);
              triggerAutoSave({ content: nextMarkdown });
              return next;
            });
            setSlashMenu(INITIAL_SLASH_MENU);
            return;
          }
        }

        // Open floating menu
        setSlashMenu({
          isOpen: true,
          blockIndex: index,
          query: slashQuery,
          selectedIndex: 0,
          mode: 'root',
        });
      } else if (
        slashMenu.isOpen &&
        slashMenu.mode === 'project' &&
        slashMenu.blockIndex === index &&
        slashMenu.mentionStart !== undefined
      ) {
        // Typing after the "#" a Project pick put in filters the projects.
        const field = document.getElementById(`note-block-${index}`);
        const caret =
          field instanceof HTMLTextAreaElement && field.value === val
            ? field.selectionStart
            : val.length;
        const start = slashMenu.mentionStart;
        const query = val.slice(start + 1, caret);
        if (val[start] === '#' && caret > start && !/[\n#]/.test(query)) {
          setSlashMenu((prev) => ({ ...prev, query, selectedIndex: 0 }));
        } else {
          setSlashMenu(INITIAL_SLASH_MENU);
        }
      } else {
        // "@query" just before the caret opens the person menu.
        const field = document.getElementById(`note-block-${index}`);
        const mention =
          field instanceof HTMLTextAreaElement && field.value === val
            ? activeMentionQuery(val, field.selectionStart)
            : null;
        const dismissed = dismissedMentionRef.current;
        if (
          mention &&
          !(dismissed?.index === index && dismissed.start === mention.start) &&
          matchPeople(ownerPeople, mention.query).length > 0
        ) {
          setSlashMenu({
            isOpen: true,
            blockIndex: index,
            query: mention.query,
            selectedIndex: 0,
            mode: 'person',
            mentionStart: mention.start,
          });
        } else if (slashMenu.isOpen && slashMenu.blockIndex === index) {
          setSlashMenu(INITIAL_SLASH_MENU);
        }
        if (!mention) dismissedMentionRef.current = null;
      }

      setBlocks((prev) => {
        const next = [...prev];
        const block = { ...next[index] };

        // Real-time Notion-style markdown shortcut transforms
        if (val.startsWith('# ')) {
          block.type = 'h1';
          block.text = val.substring(2);
        } else if (val.startsWith('## ')) {
          block.type = 'h2';
          block.text = val.substring(3);
        } else if (val.startsWith('### ')) {
          block.type = 'h3';
          block.text = val.substring(4);
        } else if (
          val.startsWith('- [ ] ') ||
          val.startsWith('[] ') ||
          val.startsWith('[ ] ')
        ) {
          block.type = 'todo';
          block.checked = false;
          block.text = val.replace(/^(\s*[-*]\s*\[\s*\]\s*|\[\s*\]\s*)/, '');
        } else if (val.startsWith('- [x] ') || val.startsWith('[x] ')) {
          block.type = 'todo';
          block.checked = true;
          block.text = val.replace(
            /^(\s*[-*]\s*\[\s*x\s*\]\s*|\[\s*x\s*\]\s*)/i,
            '',
          );
        } else if (val.startsWith('- ') || val.startsWith('* ')) {
          block.type = 'bullet';
          block.text = val.substring(2);
        } else if (val.startsWith('> ')) {
          block.type = 'quote';
          block.text = val.substring(2);
        } else if (block.type !== 'numbered' && /^\d+[.)] /.test(val)) {
          block.type = 'numbered';
          block.text = val.replace(/^\d+[.)] /, '');
        } else if (val === '---' && block.type === 'paragraph') {
          block.type = 'divider';
          block.text = '';
          if (!next[index + 1]) {
            next.push({ id: newBlockId(), type: 'paragraph', text: '' });
          }
          requestFocus(index + 1, 'start');
        } else {
          block.text = val;
        }

        next[index] = block;
        // A type change renders a different element, so put the caret back
        // where it was (minus the markdown prefix that was consumed).
        if (block.type !== prev[index]?.type && block.type !== 'divider') {
          const active = document.getElementById(
            `note-block-${index}`,
          ) as HTMLTextAreaElement | null;
          const consumed = val.length - block.text.length;
          const caret = active?.selectionStart ?? val.length;
          requestFocus(index, Math.max(0, caret - consumed));
        }
        const nextMarkdown = serializeBlocksToMarkdown(next);
        setEditContent(nextMarkdown);
        triggerAutoSave({ content: nextMarkdown });
        return next;
      });
    },
    [
      triggerAutoSave,
      entities,
      ownerPeople,
      editTargetId,
      slashMenu,
      requestFocus,
    ],
  );

  const handleToggleBlockChecked = useCallback(
    (index: number) => {
      setBlocks((prev) => {
        const next = [...prev];
        const block = next[index];
        if (block && (block.type === 'todo' || block.type === 'task')) {
          const nextChecked = !block.checked;
          next[index] = {
            ...block,
            checked: nextChecked,
          };
          const nextMarkdown = serializeBlocksToMarkdown(next);
          setEditContent(nextMarkdown);
          triggerAutoSave({ content: nextMarkdown }, true);

          // Only sync task status to the Tasks ledger if it's an explicit task!
          // Checklists stay strictly inside the note.
          if (block.type === 'task' && selectedNoteId) {
            const matching = findNoteTask(
              availableTasks,
              selectedNoteId,
              block.text,
            );
            void saveTask({
              id: matching?.id,
              title: block.text,
              status: nextChecked ? 'completed' : 'active',
              sourceNoteId: selectedNoteId,
              sourceNoteLineId: `${selectedNoteId}:line:${index}`,
            });
          }
        }
        return next;
      });
    },
    [triggerAutoSave, selectedNoteId, availableTasks],
  );

  const handleBlockKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const block = blocks[index];

    if (handleHistoryShortcut(e)) return;

    // Handle keyboard navigation when slash menu is open
    if (slashMenu.isOpen && slashMenu.blockIndex === index) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const max =
          slashMenu.mode === 'root'
            ? filteredCommands.length
            : slashMenu.mode === 'person'
              ? filteredPeople.length
              : slashMenu.mode === 'project'
                ? filteredProjects.length
                : 1 + filteredTasks.length;
        if (max > 0) {
          setSlashMenu((prev) => ({
            ...prev,
            selectedIndex: (prev.selectedIndex + 1) % max,
          }));
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const max =
          slashMenu.mode === 'root'
            ? filteredCommands.length
            : slashMenu.mode === 'person'
              ? filteredPeople.length
              : slashMenu.mode === 'project'
                ? filteredProjects.length
                : 1 + filteredTasks.length;
        if (max > 0) {
          setSlashMenu((prev) => ({
            ...prev,
            selectedIndex: (prev.selectedIndex - 1 + max) % max,
          }));
        }
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (slashMenu.mode === 'root') {
          const chosen = filteredCommands[slashMenu.selectedIndex];
          if (chosen) {
            executeSlashCommand(chosen.id, index);
          }
        } else if (slashMenu.mode === 'person') {
          const chosen = filteredPeople[slashMenu.selectedIndex];
          if (chosen) {
            selectPersonFromSlash(chosen, index);
          }
        } else if (slashMenu.mode === 'project') {
          const chosen = filteredProjects[slashMenu.selectedIndex];
          if (chosen) {
            selectProjectFromSlash(chosen, index);
          }
        } else if (slashMenu.mode === 'task') {
          if (slashMenu.selectedIndex === 0) {
            void selectCreateTaskFromSlash(slashMenu.query, index);
          } else {
            const chosen = filteredTasks[slashMenu.selectedIndex - 1];
            if (chosen) {
              selectExistingTaskFromSlash(chosen, index);
            }
          }
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (slashMenu.mentionStart !== undefined)
          dismissedMentionRef.current = {
            index,
            start: slashMenu.mentionStart,
          };
        setSlashMenu(INITIAL_SLASH_MENU);
        return;
      }
    }

    const mod = e.metaKey || e.ctrlKey;

    // Esc selects the whole block, like Notion.
    if (e.key === 'Escape' && !mod) {
      e.preventDefault();
      selectBlocks(index, index);
      return;
    }

    // Cmd+A selects the block's text first, then every block.
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
      const t = e.currentTarget;
      if (
        t.value.length === 0 ||
        (t.selectionStart === 0 && t.selectionEnd === t.value.length)
      ) {
        e.preventDefault();
        selectBlocks(0, blocks.length - 1);
        return;
      }
    }

    // Shift+Arrow past the start or end of a block's text selects blocks.
    if (
      e.shiftKey &&
      !mod &&
      !e.altKey &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    ) {
      const t = e.currentTarget;
      const atStart =
        t.selectionStart === 0 &&
        (t.selectionDirection === 'backward' || t.selectionEnd === 0);
      const atEnd =
        t.selectionEnd === t.value.length &&
        (t.selectionDirection !== 'backward' ||
          t.selectionStart === t.value.length);
      if (e.key === 'ArrowUp' && atStart) {
        e.preventDefault();
        selectBlocks(index, Math.max(0, index - 1));
        return;
      }
      if (e.key === 'ArrowDown' && atEnd) {
        e.preventDefault();
        selectBlocks(index, Math.min(blocks.length - 1, index + 1));
        return;
      }
    }

    // Cmd+Shift+Up/Down moves the block, like Notion
    if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveBlockAndFocus(index, e.key === 'ArrowUp' ? index - 1 : index + 1);
      return;
    }

    // Cmd+D duplicates the block
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateBlockAndFocus(index);
      return;
    }

    // Cmd+Option+0..6 turns the block into another type (Notion shortcuts)
    if (mod && e.altKey) {
      const byDigit: Record<string, NoteBlock['type']> = {
        Digit0: 'paragraph',
        Digit1: 'h1',
        Digit2: 'h2',
        Digit3: 'h3',
        Digit4: 'todo',
        Digit5: 'bullet',
        Digit6: 'numbered',
      };
      const type = byDigit[e.code];
      if (type) {
        e.preventDefault();
        turnBlockInto(index, type);
        return;
      }
    }

    // Cmd+Enter toggles checkbox on to-do or task block
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (block.type === 'todo' || block.type === 'task') {
        e.preventDefault();
        handleToggleBlockChecked(index);
        return;
      }
    }

    // Tab / Shift+Tab indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const val = e.currentTarget.value;
      if (e.shiftKey) {
        if (val.startsWith('  ')) {
          handleBlockTextChange(index, val.substring(2));
          requestFocus(index, Math.max(0, start - 2));
        }
      } else {
        const nextVal = `${val.substring(0, start)}  ${val.substring(end)}`;
        handleBlockTextChange(index, nextVal);
        requestFocus(index, start + 2);
      }
      return;
    }

    // Cmd+B / Cmd+I inline formatting
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const val = e.currentTarget.value;
      const sel = val.substring(start, end);
      const nextVal = `${val.substring(0, start)}**${sel}**${val.substring(end)}`;
      handleBlockTextChange(index, nextVal);
      requestFocus(index, [start + 2, end + 2]);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const val = e.currentTarget.value;
      const sel = val.substring(start, end);
      const nextVal = `${val.substring(0, start)}*${sel}*${val.substring(end)}`;
      handleBlockTextChange(index, nextVal);
      requestFocus(index, [start + 1, end + 1]);
      return;
    }

    // Enter key creates next block
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();

      // If empty todo, task, bullet, or quote, exit list and become paragraph
      if (
        (block.type === 'todo' ||
          block.type === 'task' ||
          block.type === 'bullet' ||
          block.type === 'numbered' ||
          block.type === 'quote') &&
        !block.text.trim()
      ) {
        const next = [...blocks];
        next[index] = { ...block, type: 'paragraph', text: '' };
        updateBlocks(next);
        requestFocus(index, 'start');
        return;
      }

      const pos = e.currentTarget.selectionStart;
      const currentText = block.text.substring(0, pos);
      const newBlockText = block.text.substring(pos);

      const next = [...blocks];
      next[index] = { ...block, text: currentText };

      const newBlock: NoteBlock = {
        id: `b-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type:
          block.type === 'todo' ||
          block.type === 'bullet' ||
          block.type === 'numbered'
            ? block.type
            : 'paragraph',
        text: newBlockText,
        checked: block.type === 'todo' ? false : undefined,
      };

      next.splice(index + 1, 0, newBlock);
      updateBlocks(next);

      requestFocus(index + 1, 'start');
      return;
    }

    // Backspace key on empty or start
    if (e.key === 'Backspace') {
      const isAtStart =
        e.currentTarget.selectionStart === 0 &&
        e.currentTarget.selectionEnd === 0;

      if (isAtStart) {
        if (block.type !== 'paragraph') {
          e.preventDefault();
          const next = [...blocks];
          next[index] = { ...block, type: 'paragraph' };
          updateBlocks(next);
          requestFocus(index, 'start');
          return;
        }

        if (index > 0 && blocks[index - 1].type === 'divider') {
          // Backspace after a divider removes the divider
          e.preventDefault();
          updateBlocks(blocks.filter((_, i) => i !== index - 1));
          requestFocus(index - 1, 'start');
          return;
        }

        if (index > 0) {
          e.preventDefault();
          const prevIndex = index - 1;
          const prevBlock = blocks[prevIndex];
          const prevLen = prevBlock.text.length;
          const mergedText = prevBlock.text + block.text;

          const next = [...blocks];
          next[prevIndex] = { ...prevBlock, text: mergedText };
          next.splice(index, 1);
          updateBlocks(next);

          requestFocus(prevIndex, prevLen);
          return;
        }
      }
    }

    // Arrow keys move between blocks from the first/last visual line
    if (
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      !e.shiftKey &&
      !e.altKey &&
      !mod
    ) {
      const { onFirstLine, onLastLine } = caretVisualEdges(e.currentTarget);
      if (e.key === 'ArrowUp' && onFirstLine && index > 0) {
        e.preventDefault();
        focusBlock(index - 1, 'end');
        return;
      }
      if (e.key === 'ArrowDown' && onLastLine && index < blocks.length - 1) {
        e.preventDefault();
        focusBlock(index + 1, 'start');
        return;
      }
    }
  };

  // Keyboard handling for a focused divider (it has no text to edit)
  const handleDividerKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLElement>,
  ) => {
    if (handleHistoryShortcut(e)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      selectBlocks(index, index);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      deleteBlockAndFocus(index);
    } else if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      focusBlock(index - 1, 'end');
    } else if (e.key === 'ArrowDown' && index < blocks.length - 1) {
      e.preventDefault();
      focusBlock(index + 1, 'start');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleAddBlockBelow(index);
    } else if (
      (e.metaKey || e.ctrlKey) &&
      e.shiftKey &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    ) {
      e.preventDefault();
      moveBlockAndFocus(index, e.key === 'ArrowUp' ? index - 1 : index + 1);
    }
  };

  const handleAddBlockBelow = useCallback(
    (index: number) => {
      const newBlock: NoteBlock = {
        id: `b-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: 'paragraph',
        text: '',
      };
      const next = [...blocks];
      next.splice(index + 1, 0, newBlock);
      updateBlocks(next);
      requestFocus(index + 1, 'start');
    },
    [blocks, updateBlocks],
  );

  const handleTogglePinned = () => {
    const nextPinned = !editPinned;
    setEditPinned(nextPinned);
    triggerAutoSave({ pinned: nextPinned }, true);
  };

  const handleTargetChange = (targetId: string | null) => {
    setEditTargetId(targetId);
    let derivedType: NoteType = 'general';
    if (targetId) {
      const match = entities.find((e) => e.id === targetId);
      if (match?.type === 'person') derivedType = 'person';
      else if (match?.type === 'project') derivedType = 'project';
    }
    setEditType(derivedType);
    triggerAutoSave({ targetId, noteType: derivedType }, true);
  };

  const handleCreateNote = async (type: NoteType = 'general') => {
    try {
      const initialTitle = type === 'scratchpad' ? 'Scratchpad' : '';
      const newNote = await saveNote({
        title: initialTitle,
        content: '',
        noteType: type,
        pinned: type === 'scratchpad',
      });
      setSelectedNoteId(newNote.id);
      void refreshNotes();
      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  };

  const handleDeleteNote = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await deleteNote(id);
      if (pendingSaveRef.current?.noteId === id) {
        clearTimeout(pendingSaveRef.current.timeout);
        pendingSaveRef.current = null;
      }
      setConfirmDeleteId(null);
      setIsConfirmingDeleteHeader(false);
      if (selectedNoteId === id) {
        const remaining = notes.filter((n) => n.id !== id);
        setSelectedNoteId(remaining.length > 0 ? remaining[0].id : null);
      }
      void refreshNotes();
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  // Global Keyboard Shortcuts (Cmd+N, Cmd+S, Cmd+Backspace)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // The editor already handled it (e.g. deleting selected blocks).
      if (e.defaultPrevented) return;
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void handleCreateNote('general');
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'j' && activeNote) {
        e.preventDefault();
        if (askOpen) setAskOpen(false);
        else openAskPluto();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        triggerAutoSave({}, true);
      } else if (isCmdOrCtrl && (e.key === 'Backspace' || e.key === 'Delete')) {
        const activeEl = document.activeElement;
        const isTyping =
          activeEl &&
          (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
        if (!isTyping && activeNote) {
          e.preventDefault();
          setIsConfirmingDeleteHeader(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerAutoSave, activeNote, askOpen, openAskPluto]);

  const toggleCheckboxOnLine = useCallback(
    (lineIndex: number) => {
      const lines = editContent.split('\n');
      if (lineIndex < 0 || lineIndex >= lines.length) return false;
      const line = lines[lineIndex];
      // Checklist item: - [ ] or - [x] (local to note)
      const match = line.match(/^(\s*[-*]\s*\[)([ xX])(\].*)$/);
      if (match) {
        const currentMark = match[2];
        const newMark = currentMark.toLowerCase() === 'x' ? ' ' : 'x';
        lines[lineIndex] = `${match[1]}${newMark}${match[3]}`;
        const nextContent = lines.join('\n');
        setEditContent(nextContent);
        triggerAutoSave({ content: nextContent }, true);
        return true;
      }
      // Task item: [task: ...] or [task:done: ...] (synced with Tasks ledger)
      const taskMatch = line.match(/^\[task(?::(done|x))?:\s*(.+?)\]$/i);
      if (taskMatch) {
        const isDone = Boolean(taskMatch[1]);
        const text = taskMatch[2];
        lines[lineIndex] = isDone ? `[task: ${text}]` : `[task:done: ${text}]`;
        const nextContent = lines.join('\n');
        setEditContent(nextContent);
        triggerAutoSave({ content: nextContent }, true);
        if (selectedNoteId) {
          const matching = findNoteTask(availableTasks, selectedNoteId, text);
          void saveTask({
            id: matching?.id,
            title: text,
            status: isDone ? 'active' : 'completed',
            sourceNoteId: selectedNoteId,
            sourceNoteLineId: `${selectedNoteId}:line:${lineIndex}`,
          });
        }
        return true;
      }
      return false;
    },
    [editContent, triggerAutoSave, selectedNoteId, availableTasks],
  );

  const toggleCheckboxAtOffset = useCallback(
    (offset: number) => {
      const lines = editContent.split('\n');
      let charCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineEnd = charCount + line.length;
        if (offset >= charCount && offset <= lineEnd) {
          return toggleCheckboxOnLine(i);
        }
        charCount = lineEnd + 1;
      }
      return false;
    },
    [editContent, toggleCheckboxOnLine],
  );

  // Tab key indent handler and Cmd/Ctrl+Enter toggle in textarea
  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const val = e.currentTarget.value;
      const nextVal = `${val.substring(0, start)}  ${val.substring(end)}`;
      setEditContent(nextVal);
      triggerAutoSave({ content: nextVal });
      setTimeout(() => {
        const textarea = document.getElementById(
          'note-textarea-editor',
        ) as HTMLTextAreaElement | null;
        if (textarea) {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }
      }, 0);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const textarea = e.currentTarget;
      const pos = textarea.selectionStart;
      if (toggleCheckboxAtOffset(pos)) {
        e.preventDefault();
      }
    }
  };

  const handleTextareaClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const pos = textarea.selectionStart;
    const val = textarea.value;
    const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
    const lineEnd = val.indexOf('\n', pos);
    const line = val.substring(
      lineStart,
      lineEnd === -1 ? val.length : lineEnd,
    );
    const match = line.match(/^(\s*[-*]\s*\[)([ xX])(\])/);
    const taskMatch = line.match(/^(\[task(?::(done|x))?:\s*)/i);
    if (match) {
      const boxStart = lineStart;
      const boxEnd = lineStart + match[0].length + 1;
      if (pos >= boxStart && pos <= boxEnd) {
        toggleCheckboxAtOffset(pos);
      }
    } else if (taskMatch) {
      const boxStart = lineStart;
      const boxEnd = lineStart + taskMatch[0].length;
      if (pos >= boxStart && pos <= boxEnd) {
        toggleCheckboxAtOffset(pos);
      }
    }
  };

  // The card next to the note only says what meeting prep actually does: it
  // offers unchecked checklist items from notes linked to an invited person.
  const ambientUpcomingMeeting = useMemo(
    () =>
      findUpcomingMeetingForNote({
        targetId: editTargetId,
        content: editContent,
        entities,
        events: calendarEvents,
      }),
    [editTargetId, editContent, entities, calendarEvents],
  );

  const handleInsertMeetingAgenda = () => {
    if (!ambientUpcomingMeeting) return;
    const dateFormatted = new Date(
      ambientUpcomingMeeting.startDate,
    ).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const newBlocks: NoteBlock[] = [
      ...blocks,
      {
        id: `b-${Date.now()}-h3`,
        type: 'h3',
        text: `Agenda for ${ambientUpcomingMeeting.title} (${dateFormatted})`,
      },
      {
        id: `b-${Date.now()}-todo`,
        type: 'todo',
        text: '',
        checked: false,
      },
    ];
    updateBlocks(newBlocks);
  };

  // Filter notes by search query
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter((n) => {
      const displayTitle = getDisplayTitle(n).toLowerCase();
      const matchesTitle = displayTitle.includes(q);
      const matchesContent = n.content.toLowerCase().includes(q);
      const matchesTarget = n.targetName?.toLowerCase().includes(q);
      return matchesTitle || matchesContent || matchesTarget;
    });
  }, [notes, searchQuery]);

  const targetEntity = entities.find((e) => e.id === editTargetId);

  const pickerFilteredEntities = useMemo(() => {
    if (!linkSearchQuery.trim()) return entities;
    const q = linkSearchQuery.toLowerCase();
    return entities.filter((e) => e.name.toLowerCase().includes(q));
  }, [entities, linkSearchQuery]);

  const pickerFilteredPeople = useMemo(
    () => pickerFilteredEntities.filter((e) => e.type === 'person'),
    [pickerFilteredEntities],
  );

  const pickerFilteredProjects = useMemo(
    () => pickerFilteredEntities.filter((e) => e.type === 'project'),
    [pickerFilteredEntities],
  );

  return (
    <div className="notes-workspace flex h-full w-full bg-pro-bg overflow-hidden select-none">
      {/* Left Column: Note List */}
      <nav
        aria-label="Notes sidebar"
        className="w-80 shrink-0 border-r border-pro-border flex flex-col h-full bg-black/[0.02] dark:bg-white/[0.02]"
      >
        {/* Header */}
        <div className="h-12 shrink-0 border-b border-pro-border flex items-center justify-between px-4 gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-[17px] font-semibold text-pro-text-main tracking-tight">
              Notes
            </h1>
            <span className="text-[11px] text-pro-text-muted px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/5 font-medium">
              {notes.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleCreateNote('general')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-pro-accent text-white dark:text-black font-medium text-[12px] hover:opacity-90 transition-opacity cursor-pointer"
            title="Create new note (⌘N)"
            aria-label="Create new note"
          >
            <Plus size={14} aria-hidden="true" />
            <span>Note</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pt-3 pb-2">
          <div className="relative flex items-center">
            <Search
              size={14}
              className="absolute left-2.5 text-pro-text-muted pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Search notes"
              placeholder="Search notes (press Esc to clear)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchQuery('');
              }}
              className="w-full pl-8 pr-7 py-1.5 text-[12px] bg-black/[0.04] dark:bg-white/[0.05] border border-pro-border/70 rounded-md text-pro-text-main placeholder:text-pro-text-muted focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 p-0.5 text-pro-text-muted hover:text-pro-text-main"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Notes List */}
        <div
          role="listbox"
          tabIndex={0}
          aria-label="Notes list"
          className="flex-1 overflow-y-auto p-2 space-y-1 focus:outline-none"
        >
          {filteredNotes.length === 0 ? (
            <div className="p-6 text-center text-pro-text-muted text-[13px]">
              {searchQuery.trim()
                ? 'No notes match your search'
                : 'Your notes will appear here'}
            </div>
          ) : (
            filteredNotes.map((note) => {
              const isSelected = note.id === selectedNoteId;
              const isConfirmingDelete = confirmDeleteId === note.id;
              const dateDisplay = new Date(note.updatedAt).toLocaleDateString(
                undefined,
                {
                  month: 'short',
                  day: 'numeric',
                },
              );
              const displayTitle = getDisplayTitle(note);

              return (
                <div
                  key={note.id}
                  role="option"
                  tabIndex={0}
                  aria-selected={isSelected}
                  onClick={() => setSelectedNoteId(note.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedNoteId(note.id);
                    }
                  }}
                  className={`note-sidebar-item group relative p-3 rounded-lg cursor-pointer border ${
                    isSelected
                      ? 'is-active border-pro-border bg-white dark:bg-black/20 shadow-sm'
                      : 'border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-medium text-[13px] text-pro-text-main truncate">
                      {note.pinned && (
                        <Star
                          size={12}
                          className="text-amber-500 fill-amber-500 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{displayTitle}</span>
                    </div>
                    <span className="text-[11px] text-pro-text-muted shrink-0">
                      {dateDisplay}
                    </span>
                  </div>

                  <p className="text-[12px] text-pro-text-muted line-clamp-2 mt-1 select-none">
                    {note.content.replace(/^[#\-\*\s\[\]xX]+/, '') ||
                      'Empty note...'}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      {note.targetName && (
                        <span className="px-1.5 py-0.5 rounded bg-pro-accent/10 text-pro-accent font-medium flex items-center gap-1">
                          {note.noteType === 'person' ? (
                            <User size={10} aria-hidden="true" />
                          ) : (
                            <Folder size={10} aria-hidden="true" />
                          )}
                          <span>{note.targetName}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {isConfirmingDelete ? (
                        <div
                          className="flex items-center gap-1 bg-red-500/10 dark:bg-red-500/20 px-1.5 py-0.5 rounded text-[11px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-rose-600 dark:text-rose-400">
                            Delete?
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteNote(note.id, e)}
                            className="p-0.5 text-rose-600 hover:text-rose-700 font-bold cursor-pointer"
                            aria-label="Confirm delete note"
                          >
                            <Check size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                            className="p-0.5 text-pro-text-muted hover:text-pro-text-main cursor-pointer"
                            aria-label="Cancel delete note"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(note.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-pro-text-muted hover:text-rose-500 transition-all cursor-pointer"
                          title="Delete note"
                          aria-label={`Delete note ${displayTitle}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </nav>

      {/* Right Column: Editor & Ambient Canvas */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-pro-bg select-text">
        {activeNote ? (
          <>
            {/* Editor Toolbar: Clean, calm document header */}
            <div className="h-12 shrink-0 border-b border-pro-border flex items-center justify-between px-6 select-none min-w-0">
              {/* Document Identity Breadcrumb */}
              <div className="flex items-center gap-2 text-pro-text-muted text-[13px] font-medium shrink-0 min-w-0">
                <FileText
                  size={14}
                  className="text-pro-text-muted/60 shrink-0"
                  aria-hidden="true"
                />
                <span className="text-pro-text-muted/80 text-[12px] font-medium select-none">
                  Notes
                </span>
              </div>

              {/* Header Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <NoteMeetingMenu
                  noteId={selectedNoteId}
                  title={getDisplayTitle({
                    title: editTitle,
                    content: editContent,
                    noteType: editType,
                    targetName: targetEntity?.name ?? null,
                  })}
                  content={editContent}
                  personName={
                    targetEntity?.type === 'person' ? targetEntity.name : null
                  }
                  events={calendarEvents}
                  onStartMeeting={onStartMeeting}
                />
                <button
                  type="button"
                  onClick={() => (askOpen ? setAskOpen(false) : openAskPluto())}
                  onMouseDown={(e) => e.preventDefault()}
                  className={`note-ask-trigger ${askOpen ? 'is-active' : ''}`}
                  aria-pressed={askOpen}
                  aria-label="Ask Pluto about this note"
                  title="Ask Pluto about this note (⌘J)"
                >
                  <Logo size={14} variant="default" />
                  <span>Ask Pluto</span>
                  <kbd>⌘J</kbd>
                </button>
                {/* Pin button */}
                <button
                  type="button"
                  onClick={handleTogglePinned}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer shrink-0 ${
                    editPinned
                      ? 'text-amber-500 fill-amber-500 bg-amber-500/10'
                      : 'text-pro-text-muted/70 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                  title={editPinned ? 'Unpin note' : 'Pin note to top'}
                  aria-label={editPinned ? 'Unpin note' : 'Pin note'}
                >
                  <Star size={14} />
                </button>

                {/* Delete button */}
                {isConfirmingDeleteHeader ? (
                  <div
                    className="flex items-center gap-1.5 bg-rose-500/10 dark:bg-rose-500/20 px-2 py-0.5 rounded text-[11px] shrink-0 border border-rose-500/30"
                    role="alertdialog"
                    aria-label="Delete note confirmation"
                  >
                    <span className="text-rose-600 dark:text-rose-400 font-medium">
                      Delete?
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteNote(activeNote.id)}
                      className="px-1.5 py-0.5 rounded bg-rose-600 text-white font-semibold text-[10px] hover:bg-rose-700 cursor-pointer"
                      aria-label="Confirm delete active note"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsConfirmingDeleteHeader(false)}
                      className="p-0.5 text-pro-text-muted hover:text-pro-text-main cursor-pointer"
                      aria-label="Cancel delete active note"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsConfirmingDeleteHeader(true)}
                    className="p-1.5 rounded-md transition-colors text-pro-text-muted/70 hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer shrink-0"
                    title="Delete note (⌘⌫)"
                    aria-label="Delete note"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 flex">
              {/* Note Canvas Container */}
              <div className="flex-1 min-w-0 overflow-y-auto px-8 py-6 flex gap-8">
                {/* Notion-style Unified Document Canvas */}
                <div className="flex-1 max-w-[760px] flex flex-col min-w-0">
                  {/* Title and link row share the writing column */}
                  <div className="note-doc-header">
                    {/* Note Title Input */}
                    <TextareaAutosize
                      ref={titleInputRef}
                      rows={1}
                      aria-label="Note title"
                      value={editTitle}
                      placeholder={
                        getDisplayTitle({
                          content: editContent,
                          noteType: editType,
                          targetName: targetEntity?.name,
                        }) || 'Untitled note'
                      }
                      onChange={(e) =>
                        handleTitleChange(e.target.value.replace(/\n/g, ' '))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const firstBlock =
                            document.getElementById('note-block-0');
                          firstBlock?.focus();
                        }
                      }}
                      className="note-title-input note-doc-title text-pro-text-main mb-3 w-full"
                    />

                    {/* Inline Entity Link Badge / Searchable Picker */}
                    <div className="flex items-center gap-2 mb-6 text-[12px] relative select-none">
                      {targetEntity ? (
                        <div className="relative inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setShowLinkPicker((prev) => !prev)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium text-[11px] transition-colors cursor-pointer border ${
                              targetEntity.type === 'person'
                                ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20 hover:bg-sky-500/15'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/15'
                            }`}
                            title={`Linked to ${targetEntity.type}: ${targetEntity.name} (click to change)`}
                            aria-label={`Linked to ${targetEntity.name}, click to change`}
                          >
                            {targetEntity.type === 'person' ? (
                              <User size={12} aria-hidden="true" />
                            ) : (
                              <Folder size={12} aria-hidden="true" />
                            )}
                            <span className="font-semibold">
                              {targetEntity.name}
                            </span>
                            <span className="text-[9px] opacity-70 uppercase tracking-wider ml-0.5">
                              {targetEntity.type}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTargetChange(null)}
                            className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-md cursor-pointer text-pro-text-muted/70 hover:text-rose-500 transition-colors"
                            title="Unlink"
                            aria-label={`Unlink ${targetEntity.name}`}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setShowLinkPicker((prev) => !prev)}
                            className="-ml-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium text-pro-text-muted hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-pro-border/50"
                            aria-label="Link note to person or project"
                            aria-expanded={showLinkPicker}
                          >
                            <Link2
                              size={12}
                              className="text-pro-text-muted/70"
                              aria-hidden="true"
                            />
                            <span>Link person or project</span>
                          </button>
                        </div>
                      )}

                      {/* Searchable Entity Picker Popover */}
                      {showLinkPicker && (
                        <div
                          ref={linkPickerRef}
                          className="absolute left-0 top-full mt-1.5 w-64 max-h-80 overflow-y-auto bg-pro-bg border border-pro-border rounded-lg shadow-xl z-30 p-1.5 flex flex-col gap-1 backdrop-blur-md"
                          role="menu"
                          aria-label="Select entity to link"
                        >
                          {/* Search input */}
                          <div className="relative flex items-center px-1.5 py-1 border-b border-pro-border/40 mb-1">
                            <Search
                              size={12}
                              className="text-pro-text-muted/60 shrink-0 mr-1.5"
                              aria-hidden="true"
                            />
                            <input
                              ref={linkSearchInputRef}
                              type="text"
                              placeholder="Search people & projects..."
                              value={linkSearchQuery}
                              onChange={(e) =>
                                setLinkSearchQuery(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  setShowLinkPicker(false);
                                  setLinkSearchQuery('');
                                }
                              }}
                              className="w-full bg-transparent text-[11px] text-pro-text-main placeholder:text-pro-text-muted/50 focus:outline-none"
                            />
                          </div>

                          {/* People Section */}
                          {pickerFilteredPeople.length > 0 && (
                            <div>
                              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-pro-text-muted/70">
                                People
                              </div>
                              {pickerFilteredPeople.map((entity) => (
                                <button
                                  key={entity.id}
                                  type="button"
                                  onClick={() => {
                                    handleTargetChange(entity.id);
                                    setShowLinkPicker(false);
                                    setLinkSearchQuery('');
                                  }}
                                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center justify-between hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main cursor-pointer ${
                                    targetEntity?.id === entity.id
                                      ? 'bg-pro-accent/10 font-medium'
                                      : ''
                                  }`}
                                  role="menuitem"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    <User
                                      size={12}
                                      className="text-sky-500 shrink-0"
                                    />
                                    <span className="truncate">
                                      {entity.name}
                                    </span>
                                  </div>
                                  {targetEntity?.id === entity.id && (
                                    <Check
                                      size={12}
                                      className="text-pro-accent shrink-0"
                                    />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Projects Section */}
                          {pickerFilteredProjects.length > 0 && (
                            <div>
                              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-pro-text-muted/70">
                                Projects
                              </div>
                              {pickerFilteredProjects.map((entity) => (
                                <button
                                  key={entity.id}
                                  type="button"
                                  onClick={() => {
                                    handleTargetChange(entity.id);
                                    setShowLinkPicker(false);
                                    setLinkSearchQuery('');
                                  }}
                                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center justify-between hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main cursor-pointer ${
                                    targetEntity?.id === entity.id
                                      ? 'bg-pro-accent/10 font-medium'
                                      : ''
                                  }`}
                                  role="menuitem"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    <Folder
                                      size={12}
                                      className="text-amber-500 shrink-0"
                                    />
                                    <span className="truncate">
                                      {entity.name}
                                    </span>
                                  </div>
                                  {targetEntity?.id === entity.id && (
                                    <Check
                                      size={12}
                                      className="text-pro-accent shrink-0"
                                    />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Empty state */}
                          {pickerFilteredPeople.length === 0 &&
                            pickerFilteredProjects.length === 0 && (
                              <div className="px-2 py-3 text-center text-xs text-pro-text-muted">
                                No people or projects found
                              </div>
                            )}

                          {/* Clear link button if currently linked */}
                          {targetEntity && (
                            <div className="pt-1 mt-1 border-t border-pro-border/40">
                              <button
                                type="button"
                                onClick={() => {
                                  handleTargetChange(null);
                                  setShowLinkPicker(false);
                                  setLinkSearchQuery('');
                                }}
                                className="w-full text-left px-2 py-1 rounded text-[11px] text-rose-500 hover:bg-rose-500/10 transition-colors flex items-center gap-1.5 cursor-pointer"
                              >
                                <X size={11} />
                                <span>Remove link</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Hidden textarea for DOM test compatibility and background updates */}
                  <textarea
                    id="note-textarea-editor"
                    aria-label="Note content"
                    value={editContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                    onKeyDown={handleTextareaKeyDown}
                    onClick={handleTextareaClick}
                    className="hidden"
                  />

                  {/* Notion Live Document Canvas */}
                  <div
                    ref={canvasRef}
                    tabIndex={-1}
                    aria-label="Note content blocks"
                    className={`note-markdown-render note-block-canvas min-h-[400px] select-text flex flex-col pl-10 pr-4 ${
                      isDragSelecting ? 'is-block-selecting' : ''
                    } ${selectedRange ? 'has-block-selection' : ''}`}
                    onMouseDown={handleCanvasMouseDown}
                    onKeyDown={handleSelectionKeyDown}
                    onCopy={(e) => {
                      if (!selectedRange || e.target !== e.currentTarget)
                        return;
                      e.preventDefault();
                      e.clipboardData.setData('text/plain', selectedMarkdown());
                    }}
                    onCut={(e) => {
                      if (!selectedRange || e.target !== e.currentTarget)
                        return;
                      e.preventDefault();
                      e.clipboardData.setData('text/plain', selectedMarkdown());
                      deleteSelectedBlocks();
                    }}
                    onPaste={(e) => {
                      if (!selectedRange || e.target !== e.currentTarget)
                        return;
                      e.preventDefault();
                      pasteOverSelectedBlocks(
                        e.clipboardData.getData('text/plain'),
                      );
                    }}
                    onBlur={(e) => {
                      // Clicking away (outside the editor) clears the selection.
                      if (
                        e.target === e.currentTarget &&
                        !e.currentTarget.contains(
                          e.relatedTarget as Node | null,
                        )
                      ) {
                        setBlockSelection(null);
                      }
                    }}
                  >
                    <output className="sr-only" aria-live="polite">
                      {selectedRange
                        ? `${selectedRange[1] - selectedRange[0] + 1} ${
                            selectedRange[1] === selectedRange[0]
                              ? 'block'
                              : 'blocks'
                          } selected`
                        : ''}
                    </output>
                    <div>
                      {blocks.map((block, index) => {
                        const taskRun = taskRunPosition(blocks, index);
                        const isDropBefore =
                          dragIndex !== null &&
                          dropTarget?.index === index &&
                          dropTarget.position === 'before';
                        const isDropAfter =
                          dragIndex !== null &&
                          dropTarget?.index === index &&
                          dropTarget.position === 'after';
                        return (
                          <div
                            key={block.id}
                            data-block-id={block.id}
                            data-block-index={index}
                            data-block-type={block.type}
                            data-task-run={taskRun ?? undefined}
                            className={`note-block-row relative group/block flex items-start ${
                              taskRun
                                ? `note-task-group note-task-group--${taskRun}`
                                : ''
                            } ${freshBlockIds.has(block.id) ? 'is-fresh' : ''} ${
                              dragIndex === index ? 'is-dragging' : ''
                            } ${
                              isDropBefore ? 'is-drop-before' : ''
                            } ${isDropAfter ? 'is-drop-after' : ''} ${
                              selectedRange &&
                              index >= selectedRange[0] &&
                              index <= selectedRange[1]
                                ? `is-selected${index === selectedRange[0] ? ' is-selected-first' : ''}${index === selectedRange[1] ? ' is-selected-last' : ''}`
                                : ''
                            }`}
                            onPaste={(e) => handleBlockPaste(index, e)}
                            onDragOver={(e) => {
                              if (dragIndex === null) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              const rect =
                                e.currentTarget.getBoundingClientRect();
                              const position =
                                e.clientY < rect.top + rect.height / 2
                                  ? 'before'
                                  : 'after';
                              if (
                                dropTarget?.index !== index ||
                                dropTarget.position !== position
                              ) {
                                setDropTarget({ index, position });
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              handleBlockDrop();
                            }}
                          >
                            {taskRun === 'start' || taskRun === 'single' ? (
                              <div
                                className="note-task-group__label"
                                title="These tasks also appear in your Tasks list"
                              >
                                <RefreshCw size={11} aria-hidden="true" />
                                <span>Tasks</span>
                              </div>
                            ) : null}
                            <div className="notion-gutter-container absolute -left-10 w-9 flex items-center justify-end select-none pointer-events-none group-hover/block:pointer-events-auto group-focus-within/block:pointer-events-auto z-10">
                              <div
                                className={`flex items-center gap-0.5 transition-opacity duration-150 ${
                                  blockMenuIndex === index
                                    ? 'opacity-100 pointer-events-auto'
                                    : 'opacity-0 group-hover/block:opacity-60 hover:!opacity-100 group-focus-within/block:opacity-40 focus-within:!opacity-100'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleAddBlockBelow(index)}
                                  className="w-4 h-5 flex items-center justify-center rounded text-pro-text-muted/40 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-colors"
                                  title="Add block below"
                                  aria-label="Add block below"
                                >
                                  <Plus size={12} />
                                </button>
                                <button
                                  type="button"
                                  draggable
                                  onDragStart={(e) => {
                                    setBlockMenuIndex(null);
                                    setDragIndex(index);
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData(
                                      'text/plain',
                                      block.text,
                                    );
                                    const row =
                                      e.currentTarget.closest(
                                        '.note-block-row',
                                      );
                                    if (row) {
                                      e.dataTransfer.setDragImage(row, 16, 12);
                                    }
                                  }}
                                  onDragEnd={() => {
                                    setDragIndex(null);
                                    setDropTarget(null);
                                  }}
                                  onClick={() =>
                                    setBlockMenuIndex((prev) =>
                                      prev === index ? null : index,
                                    )
                                  }
                                  className="w-4 h-5 flex items-center justify-center rounded text-pro-text-muted/40 hover:text-pro-text-main hover:bg-black/5 dark:hover:bg-white/10 cursor-grab active:cursor-grabbing transition-colors"
                                  title="Drag to move · Click to open menu"
                                  aria-label="Block actions"
                                  aria-haspopup="menu"
                                  aria-expanded={blockMenuIndex === index}
                                >
                                  <GripVertical size={13} />
                                </button>
                              </div>
                              {blockMenuIndex === index ? (
                                <NotionBlockMenu
                                  blockType={block.type}
                                  canMoveUp={index > 0}
                                  canMoveDown={index < blocks.length - 1}
                                  onTurnInto={(type) => {
                                    setBlockMenuIndex(null);
                                    turnBlockInto(
                                      index,
                                      type as NoteBlock['type'],
                                    );
                                  }}
                                  onDuplicate={() => {
                                    setBlockMenuIndex(null);
                                    duplicateBlockAndFocus(index);
                                  }}
                                  onDelete={() => {
                                    setBlockMenuIndex(null);
                                    deleteBlockAndFocus(index);
                                  }}
                                  onMoveUp={() => {
                                    setBlockMenuIndex(null);
                                    moveBlockAndFocus(index, index - 1);
                                  }}
                                  onMoveDown={() => {
                                    setBlockMenuIndex(null);
                                    moveBlockAndFocus(index, index + 1);
                                  }}
                                  onClose={() => setBlockMenuIndex(null)}
                                />
                              ) : null}
                            </div>

                            <div className="flex-1 min-w-0">
                              {block.type === 'h1' ? (
                                <MentionTextarea
                                  people={ownerPeople}
                                  onOpenPerson={openMentionedPerson}
                                  id={`note-block-${index}`}
                                  value={block.text}
                                  onFocus={() => setFocusedBlockIndex(index)}
                                  onBlur={() =>
                                    setFocusedBlockIndex((prev) =>
                                      prev === index ? null : prev,
                                    )
                                  }
                                  onChange={(
                                    e: React.ChangeEvent<HTMLTextAreaElement>,
                                  ) =>
                                    handleBlockTextChange(index, e.target.value)
                                  }
                                  onKeyDown={(
                                    e: React.KeyboardEvent<HTMLTextAreaElement>,
                                  ) => handleBlockKeyDown(index, e)}
                                  placeholder={
                                    focusedBlockIndex === index
                                      ? 'Heading 1'
                                      : ''
                                  }
                                  className="notion-block-textarea note-block-text text-pro-text-main placeholder:text-pro-text-muted/30"
                                />
                              ) : block.type === 'h2' ? (
                                <MentionTextarea
                                  people={ownerPeople}
                                  onOpenPerson={openMentionedPerson}
                                  id={`note-block-${index}`}
                                  value={block.text}
                                  onFocus={() => setFocusedBlockIndex(index)}
                                  onBlur={() =>
                                    setFocusedBlockIndex((prev) =>
                                      prev === index ? null : prev,
                                    )
                                  }
                                  onChange={(
                                    e: React.ChangeEvent<HTMLTextAreaElement>,
                                  ) =>
                                    handleBlockTextChange(index, e.target.value)
                                  }
                                  onKeyDown={(
                                    e: React.KeyboardEvent<HTMLTextAreaElement>,
                                  ) => handleBlockKeyDown(index, e)}
                                  placeholder={
                                    focusedBlockIndex === index
                                      ? 'Heading 2'
                                      : ''
                                  }
                                  className="notion-block-textarea note-block-text text-pro-text-main placeholder:text-pro-text-muted/30"
                                />
                              ) : block.type === 'h3' ? (
                                <MentionTextarea
                                  people={ownerPeople}
                                  onOpenPerson={openMentionedPerson}
                                  id={`note-block-${index}`}
                                  value={block.text}
                                  onFocus={() => setFocusedBlockIndex(index)}
                                  onBlur={() =>
                                    setFocusedBlockIndex((prev) =>
                                      prev === index ? null : prev,
                                    )
                                  }
                                  onChange={(
                                    e: React.ChangeEvent<HTMLTextAreaElement>,
                                  ) =>
                                    handleBlockTextChange(index, e.target.value)
                                  }
                                  onKeyDown={(
                                    e: React.KeyboardEvent<HTMLTextAreaElement>,
                                  ) => handleBlockKeyDown(index, e)}
                                  placeholder={
                                    focusedBlockIndex === index
                                      ? 'Heading 3'
                                      : ''
                                  }
                                  className="notion-block-textarea note-block-text text-pro-text-main placeholder:text-pro-text-muted/30"
                                />
                              ) : block.type === 'quote' ? (
                                <div className="note-quote">
                                  <MentionTextarea
                                    people={ownerPeople}
                                    onOpenPerson={openMentionedPerson}
                                    id={`note-block-${index}`}
                                    value={block.text}
                                    onFocus={() => setFocusedBlockIndex(index)}
                                    onBlur={() =>
                                      setFocusedBlockIndex((prev) =>
                                        prev === index ? null : prev,
                                      )
                                    }
                                    onChange={(
                                      e: React.ChangeEvent<HTMLTextAreaElement>,
                                    ) =>
                                      handleBlockTextChange(
                                        index,
                                        e.target.value,
                                      )
                                    }
                                    onKeyDown={(
                                      e: React.KeyboardEvent<HTMLTextAreaElement>,
                                    ) => handleBlockKeyDown(index, e)}
                                    placeholder={
                                      focusedBlockIndex === index
                                        ? 'Empty quote'
                                        : ''
                                    }
                                    className="notion-block-textarea note-block-text placeholder:text-pro-text-muted/30"
                                  />
                                </div>
                              ) : block.type === 'task' ? (
                                <li className="note-list-item group/task">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(block.checked)}
                                    aria-label={
                                      block.checked
                                        ? 'Mark task incomplete'
                                        : 'Mark task complete'
                                    }
                                    onChange={() =>
                                      handleToggleBlockChecked(index)
                                    }
                                    title="Synced to your Tasks list"
                                    className="notion-task-checkbox rounded-full shrink-0 cursor-pointer"
                                  />
                                  <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                                    <MentionTextarea
                                      people={ownerPeople}
                                      onOpenPerson={openMentionedPerson}
                                      id={`note-block-${index}`}
                                      value={block.text}
                                      onFocus={() =>
                                        setFocusedBlockIndex(index)
                                      }
                                      onBlur={() =>
                                        setFocusedBlockIndex((prev) =>
                                          prev === index ? null : prev,
                                        )
                                      }
                                      onChange={(
                                        e: React.ChangeEvent<HTMLTextAreaElement>,
                                      ) =>
                                        handleBlockTextChange(
                                          index,
                                          e.target.value,
                                        )
                                      }
                                      onKeyDown={(
                                        e: React.KeyboardEvent<HTMLTextAreaElement>,
                                      ) => handleBlockKeyDown(index, e)}
                                      placeholder={
                                        focusedBlockIndex === index
                                          ? 'Task title'
                                          : ''
                                      }
                                      className={`notion-block-textarea note-block-text placeholder:text-pro-text-muted/30 ${
                                        block.checked
                                          ? 'is-checked'
                                          : 'text-pro-text-main'
                                      }`}
                                    />
                                  </div>
                                </li>
                              ) : block.type === 'todo' ? (
                                <li className="note-list-item group/todo">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(block.checked)}
                                    aria-label={
                                      block.checked
                                        ? 'Mark checklist item incomplete'
                                        : 'Mark checklist item complete'
                                    }
                                    onChange={() =>
                                      handleToggleBlockChecked(index)
                                    }
                                    className="notion-todo-checkbox rounded-[4px] shrink-0 cursor-pointer"
                                  />
                                  <MentionTextarea
                                    people={ownerPeople}
                                    onOpenPerson={openMentionedPerson}
                                    id={`note-block-${index}`}
                                    value={block.text}
                                    onFocus={() => setFocusedBlockIndex(index)}
                                    onBlur={() =>
                                      setFocusedBlockIndex((prev) =>
                                        prev === index ? null : prev,
                                      )
                                    }
                                    onChange={(
                                      e: React.ChangeEvent<HTMLTextAreaElement>,
                                    ) =>
                                      handleBlockTextChange(
                                        index,
                                        e.target.value,
                                      )
                                    }
                                    onKeyDown={(
                                      e: React.KeyboardEvent<HTMLTextAreaElement>,
                                    ) => handleBlockKeyDown(index, e)}
                                    placeholder={
                                      focusedBlockIndex === index
                                        ? 'Checklist item'
                                        : ''
                                    }
                                    className={`notion-block-textarea note-block-text placeholder:text-pro-text-muted/30 ${
                                      block.checked
                                        ? 'is-checked'
                                        : 'text-pro-text-main'
                                    }`}
                                  />
                                  {(() => {
                                    if (block.checked) return null;
                                    const owner = ownerOfLine(
                                      block.text,
                                      ownerPeople,
                                    );
                                    if (!owner || owner.id === editTargetId)
                                      return null;
                                    const first = owner.name
                                      .trim()
                                      .split(/\s+/)[0];
                                    return (
                                      <span
                                        className="note-owner-label"
                                        title={`Also listed under “Next time with ${owner.name}” and in prep for meetings with them`}
                                      >
                                        On {first}’s list
                                      </span>
                                    );
                                  })()}
                                </li>
                              ) : block.type === 'divider' ? (
                                <div
                                  id={`note-block-${index}`}
                                  role="separator"
                                  aria-label="Divider"
                                  tabIndex={0}
                                  onKeyDown={(e) =>
                                    handleDividerKeyDown(index, e)
                                  }
                                  className="note-divider-block"
                                >
                                  <hr />
                                </div>
                              ) : block.type === 'numbered' ? (
                                <li className="note-list-item">
                                  <span className="note-list-marker note-list-marker--number">
                                    {numberedListIndex(blocks, index)}.
                                  </span>
                                  <MentionTextarea
                                    people={ownerPeople}
                                    onOpenPerson={openMentionedPerson}
                                    id={`note-block-${index}`}
                                    value={block.text}
                                    onFocus={() => setFocusedBlockIndex(index)}
                                    onBlur={() =>
                                      setFocusedBlockIndex((prev) =>
                                        prev === index ? null : prev,
                                      )
                                    }
                                    onChange={(
                                      e: React.ChangeEvent<HTMLTextAreaElement>,
                                    ) =>
                                      handleBlockTextChange(
                                        index,
                                        e.target.value,
                                      )
                                    }
                                    onKeyDown={(
                                      e: React.KeyboardEvent<HTMLTextAreaElement>,
                                    ) => handleBlockKeyDown(index, e)}
                                    placeholder={
                                      focusedBlockIndex === index
                                        ? 'List item'
                                        : ''
                                    }
                                    className="notion-block-textarea note-block-text text-pro-text-main placeholder:text-pro-text-muted/30"
                                  />
                                </li>
                              ) : block.type === 'bullet' ? (
                                <li className="note-list-item">
                                  <span
                                    className="note-list-marker note-list-marker--bullet"
                                    aria-hidden="true"
                                  />
                                  <MentionTextarea
                                    people={ownerPeople}
                                    onOpenPerson={openMentionedPerson}
                                    id={`note-block-${index}`}
                                    value={block.text}
                                    onFocus={() => setFocusedBlockIndex(index)}
                                    onBlur={() =>
                                      setFocusedBlockIndex((prev) =>
                                        prev === index ? null : prev,
                                      )
                                    }
                                    onChange={(
                                      e: React.ChangeEvent<HTMLTextAreaElement>,
                                    ) =>
                                      handleBlockTextChange(
                                        index,
                                        e.target.value,
                                      )
                                    }
                                    onKeyDown={(
                                      e: React.KeyboardEvent<HTMLTextAreaElement>,
                                    ) => handleBlockKeyDown(index, e)}
                                    placeholder={
                                      focusedBlockIndex === index
                                        ? 'List item'
                                        : ''
                                    }
                                    className="notion-block-textarea note-block-text text-pro-text-main placeholder:text-pro-text-muted/30"
                                  />
                                </li>
                              ) : (
                                <MentionTextarea
                                  people={ownerPeople}
                                  onOpenPerson={openMentionedPerson}
                                  id={`note-block-${index}`}
                                  value={block.text}
                                  onFocus={() => setFocusedBlockIndex(index)}
                                  onBlur={() =>
                                    setFocusedBlockIndex((prev) =>
                                      prev === index ? null : prev,
                                    )
                                  }
                                  onChange={(
                                    e: React.ChangeEvent<HTMLTextAreaElement>,
                                  ) =>
                                    handleBlockTextChange(index, e.target.value)
                                  }
                                  onKeyDown={(
                                    e: React.KeyboardEvent<HTMLTextAreaElement>,
                                  ) => handleBlockKeyDown(index, e)}
                                  placeholder={
                                    focusedBlockIndex === index ||
                                    (blocks.length === 1 && !block.text.trim())
                                      ? "Type '/' for commands..."
                                      : ''
                                  }
                                  className="notion-block-textarea note-block-text text-pro-text-main placeholder:text-pro-text-muted/30"
                                />
                              )}

                              {slashMenu.isOpen &&
                                slashMenu.blockIndex === index && (
                                  <div
                                    ref={slashMenuRef}
                                    role="menu"
                                    aria-label="Slash commands"
                                    className="slash-command-menu absolute z-50 left-6 top-full mt-1 w-72 max-h-72 overflow-y-auto rounded-xl border border-pro-border/80 bg-pro-surface/98 dark:bg-[#1a1a1a]/98 backdrop-blur-md shadow-xl p-1.5 text-xs text-pro-text-main animate-fade-in select-none"
                                  >
                                    {slashMenu.mode === 'root' ? (
                                      <>
                                        <div className="px-2 py-1 text-[10px] font-semibold text-pro-text-muted uppercase tracking-wider">
                                          Basic Blocks & Referrals
                                        </div>
                                        {filteredCommands.length === 0 ? (
                                          <div className="px-2 py-2 text-pro-text-muted text-[11px]">
                                            No matching command found
                                          </div>
                                        ) : (
                                          filteredCommands.map(
                                            (cmd, cmdIdx) => {
                                              const Icon = cmd.icon;
                                              const isSelected =
                                                cmdIdx ===
                                                slashMenu.selectedIndex;
                                              return (
                                                <button
                                                  key={cmd.id}
                                                  type="button"
                                                  role="menuitem"
                                                  data-selected={isSelected}
                                                  onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    executeSlashCommand(
                                                      cmd.id,
                                                      index,
                                                    );
                                                  }}
                                                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                                    isSelected
                                                      ? 'bg-pro-accent/15 text-pro-accent font-medium'
                                                      : 'hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main'
                                                  }`}
                                                >
                                                  <div className="flex items-center gap-2 min-w-0">
                                                    <div className="w-6 h-6 rounded-md border border-pro-border/50 flex items-center justify-center shrink-0 bg-pro-bg/50">
                                                      <Icon
                                                        size={13}
                                                        className="shrink-0"
                                                      />
                                                    </div>
                                                    <div className="min-w-0">
                                                      <div className="text-[12px] truncate">
                                                        {cmd.title}
                                                      </div>
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
                                            },
                                          )
                                        )}
                                      </>
                                    ) : slashMenu.mode === 'person' ? (
                                      <>
                                        <div className="px-2 py-1 text-[10px] font-semibold text-pro-text-muted uppercase tracking-wider flex items-center justify-between">
                                          <span>Refer Person (@)</span>
                                          <span className="font-mono text-[9px] lowercase opacity-60">
                                            Esc to cancel
                                          </span>
                                        </div>
                                        {filteredPeople.length === 0 ? (
                                          <div className="px-2 py-2 text-pro-text-muted text-[11px]">
                                            No people found. Add people in the
                                            People tab.
                                          </div>
                                        ) : (
                                          filteredPeople.map((p, pIdx) => {
                                            const isSelected =
                                              pIdx === slashMenu.selectedIndex;
                                            return (
                                              <button
                                                key={p.id}
                                                type="button"
                                                role="menuitem"
                                                data-selected={isSelected}
                                                onMouseDown={(e) => {
                                                  e.preventDefault();
                                                  selectPersonFromSlash(
                                                    p,
                                                    index,
                                                  );
                                                }}
                                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                                  isSelected
                                                    ? 'bg-pro-accent/15 text-pro-accent font-medium'
                                                    : 'hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main'
                                                }`}
                                              >
                                                <div className="w-5 h-5 rounded-full bg-pro-accent/10 text-pro-accent flex items-center justify-center shrink-0 text-[10px] font-semibold">
                                                  {p.name
                                                    .charAt(0)
                                                    .toUpperCase()}
                                                </div>
                                                <span className="text-[12px] truncate flex-1">
                                                  {p.name}
                                                </span>
                                                <span className="text-[10px] text-pro-text-muted font-mono shrink-0">
                                                  @{p.name.split(' ')[0]}
                                                </span>
                                              </button>
                                            );
                                          })
                                        )}
                                      </>
                                    ) : slashMenu.mode === 'project' ? (
                                      <>
                                        <div className="px-2 py-1 text-[10px] font-semibold text-pro-text-muted uppercase tracking-wider flex items-center justify-between">
                                          <span>Refer Project (#)</span>
                                          <span className="font-mono text-[9px] lowercase opacity-60">
                                            Esc to cancel
                                          </span>
                                        </div>
                                        {filteredProjects.length === 0 ? (
                                          <div className="px-2 py-2 text-pro-text-muted text-[11px]">
                                            No projects found.
                                          </div>
                                        ) : (
                                          filteredProjects.map((p, pIdx) => {
                                            const isSelected =
                                              pIdx === slashMenu.selectedIndex;
                                            return (
                                              <button
                                                key={p.id}
                                                type="button"
                                                role="menuitem"
                                                data-selected={isSelected}
                                                onMouseDown={(e) => {
                                                  e.preventDefault();
                                                  selectProjectFromSlash(
                                                    p,
                                                    index,
                                                  );
                                                }}
                                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                                  isSelected
                                                    ? 'bg-pro-accent/15 text-pro-accent font-medium'
                                                    : 'hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main'
                                                }`}
                                              >
                                                <Folder
                                                  size={13}
                                                  className="text-pro-accent shrink-0"
                                                />
                                                <span className="text-[12px] truncate flex-1">
                                                  {p.name}
                                                </span>
                                                <span className="text-[10px] text-pro-text-muted font-mono shrink-0">
                                                  #
                                                  {p.name
                                                    .replace(/\s+/g, '-')
                                                    .toLowerCase()}
                                                </span>
                                              </button>
                                            );
                                          })
                                        )}
                                      </>
                                    ) : slashMenu.mode === 'task' ? (
                                      <>
                                        <div className="px-2 py-1 text-[10px] font-semibold text-pro-text-muted uppercase tracking-wider flex items-center justify-between">
                                          <span>Refer or Create Task</span>
                                          <span className="font-mono text-[9px] lowercase opacity-60">
                                            Esc to cancel
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          role="menuitem"
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            void selectCreateTaskFromSlash(
                                              slashMenu.query,
                                              index,
                                            );
                                          }}
                                          data-selected={
                                            slashMenu.selectedIndex === 0
                                          }
                                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                            slashMenu.selectedIndex === 0
                                              ? 'bg-pro-accent/15 text-pro-accent font-medium'
                                              : 'hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main'
                                          }`}
                                        >
                                          <Plus
                                            size={13}
                                            className="text-pro-accent shrink-0"
                                          />
                                          <span className="text-[12px] truncate flex-1">
                                            Create task "
                                            {slashMenu.query.trim() ||
                                              'New task'}
                                            "
                                          </span>
                                          <span className="text-[10px] text-pro-text-muted font-mono shrink-0">
                                            Enter
                                          </span>
                                        </button>
                                        {filteredTasks.map((t, tIdx) => {
                                          const isSelected =
                                            tIdx + 1 ===
                                            slashMenu.selectedIndex;
                                          return (
                                            <button
                                              key={t.id}
                                              type="button"
                                              role="menuitem"
                                              data-selected={isSelected}
                                              onMouseDown={(e) => {
                                                e.preventDefault();
                                                selectExistingTaskFromSlash(
                                                  t,
                                                  index,
                                                );
                                              }}
                                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                                isSelected
                                                  ? 'bg-pro-accent/15 text-pro-accent font-medium'
                                                  : 'hover:bg-black/5 dark:hover:bg-white/5 text-pro-text-main'
                                              }`}
                                            >
                                              <CheckSquare
                                                size={13}
                                                className="text-pro-accent shrink-0"
                                              />
                                              <span className="text-[12px] truncate flex-1">
                                                {t.title}
                                              </span>
                                              <span className="text-[10px] text-pro-text-muted font-mono shrink-0">
                                                {t.status}
                                              </span>
                                            </button>
                                          );
                                        })}
                                      </>
                                    ) : null}
                                  </div>
                                )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Clickable bottom canvas area to append or focus */}
                    <div
                      className="flex-1 min-h-[160px] cursor-text py-4"
                      onClick={() => {
                        if (blocks.length > 0) {
                          const last = blocks[blocks.length - 1];
                          if (last.text.trim()) {
                            const newBlock: NoteBlock = {
                              id: `b-${Date.now()}`,
                              type: 'paragraph',
                              text: '',
                            };
                            updateBlocks([...blocks, newBlock]);
                            requestFocus(blocks.length, 'start');
                          } else {
                            const el = document.getElementById(
                              `note-block-${blocks.length - 1}`,
                            ) as HTMLTextAreaElement | null;
                            el?.focus();
                          }
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Ambient Companion Sidebar (Whispers & Context) */}
                {!askOpen && (ambientUpcomingMeeting || targetEntity) ? (
                  <aside
                    aria-label="Context & Upcoming Meetings"
                    className="w-64 shrink-0 hidden xl:flex flex-col gap-4 select-none"
                  >
                    {/* Whisper: Upcoming Meeting with action */}
                    {ambientUpcomingMeeting && (
                      <div className="ambient-whisper-card p-4 rounded-xl border border-pro-accent/30 bg-pro-accent/[0.04] text-[12px]">
                        <div className="flex items-center gap-1.5 text-pro-accent font-semibold mb-1.5">
                          <Calendar size={14} aria-hidden="true" />
                          <span>Upcoming Meeting</span>
                        </div>
                        <p className="font-medium text-pro-text-main text-[13px] leading-snug">
                          {ambientUpcomingMeeting.title}
                        </p>
                        <p className="text-pro-text-muted mt-1 text-[11px]">
                          {new Date(
                            ambientUpcomingMeeting.startDate,
                          ).toLocaleDateString(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                        <div className="mt-3 pt-2.5 border-t border-pro-accent/20 space-y-2">
                          {ambientUpcomingMeeting.linked ? (
                            <>
                              <p className="text-[11px] text-pro-text-muted leading-relaxed">
                                {ambientUpcomingMeeting.personName} is invited.
                                Unchecked checklist items in this note will be
                                offered in this meeting’s prep.
                              </p>
                              <button
                                type="button"
                                onClick={handleInsertMeetingAgenda}
                                className="w-full py-1 px-2 rounded bg-pro-accent/10 hover:bg-pro-accent/20 text-pro-accent text-[11px] font-medium transition-colors cursor-pointer text-center"
                              >
                                + Insert Agenda Block
                              </button>
                            </>
                          ) : (
                            <>
                              <p className="text-[11px] text-pro-text-muted leading-relaxed">
                                {ambientUpcomingMeeting.personName} is invited.
                                Link this note to them to offer its checklist
                                items in this meeting’s prep.
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  handleTargetChange(
                                    ambientUpcomingMeeting.personId,
                                  )
                                }
                                className="w-full py-1 px-2 rounded bg-pro-accent/10 hover:bg-pro-accent/20 text-pro-accent text-[11px] font-medium transition-colors cursor-pointer text-center"
                              >
                                Link to {ambientUpcomingMeeting.personName}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Context card: Target Info */}
                    {targetEntity && (
                      <div className="p-4 rounded-xl border border-pro-border bg-black/[0.02] dark:bg-white/[0.02] text-[12px]">
                        <div className="flex items-center gap-1.5 text-pro-text-muted font-medium mb-1">
                          {targetEntity.type === 'person' ? (
                            <User size={13} aria-hidden="true" />
                          ) : (
                            <Folder size={13} aria-hidden="true" />
                          )}
                          <span className="capitalize">
                            {targetEntity.type} Context
                          </span>
                        </div>
                        <p className="font-semibold text-pro-text-main text-[13px]">
                          {targetEntity.name}
                        </p>
                        <p className="text-[11px] text-pro-text-muted mt-2 leading-relaxed">
                          {targetEntity.type === 'person'
                            ? `When ${targetEntity.name} is invited to a meeting, unchecked checklist items from this note are offered in its prep.`
                            : `Tasks written in this note are filed under ${targetEntity.name}.`}
                        </p>
                      </div>
                    )}
                  </aside>
                ) : null}
              </div>
              {askOpen ? (
                <NoteAskPlutoPanel
                  key={activeNote.id}
                  noteId={activeNote.id}
                  selection={askSelection}
                  onClearSelection={() => setAskSelection(null)}
                  onClose={() => {
                    setAskOpen(false);
                    setAskSelection(null);
                    const index = lastFocusedBlockRef.current;
                    if (index !== null) requestFocus(index, 'end');
                  }}
                  onInsertMarkdown={insertAnswerIntoNote}
                  onAddTasks={addSuggestedTasks}
                  personName={
                    targetEntity?.type === 'person' ? targetEntity.name : null
                  }
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="my-auto">
              <EmptyCanvas
                kind="notes"
                title={
                  notes.length === 0
                    ? 'A page for whatever’s on your mind'
                    : 'No note selected'
                }
                description={
                  notes.length === 0
                    ? 'Save a thought, sketch an agenda, or make a little space to think.'
                    : 'Pick a note from the list to keep writing, or start a new one.'
                }
              >
                <button
                  type="button"
                  onClick={() => handleCreateNote('general')}
                  className="empty-canvas-action"
                >
                  Create Note
                </button>
              </EmptyCanvas>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
