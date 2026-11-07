import type {
  Note,
  NoteAskPlutoIntent,
  NoteAskPlutoRequest,
  NoteAskPlutoTurn,
} from '../../src/types/notes';
import { isActionableAnswerItem } from '../../src/utils/actionableAnswer';
import {
  type AskPlutoFailureReason,
  classifyAskPlutoFailure,
} from './askPlutoFailures';

// Ask Pluto inside a single note. The note is the only source, so answers
// stay grounded in what the user can see on the page.

export const NOTE_ASK_PLUTO_LIMITS = {
  requestIdChars: 128,
  noteIdChars: 256,
  queryChars: 2_000,
  selectionChars: 6_000,
  noteChars: 24_000,
  turns: 6,
  turnChars: 2_000,
  suggestedTasks: 12,
  taskTitleChars: 160,
} as const;

const INTENTS: NoteAskPlutoIntent[] = [
  'ask',
  'summarize',
  'tasks',
  'open_items',
  'follow_up',
];

export type NoteAskPlutoParseResult =
  | { ok: true; request: NoteAskPlutoRequest }
  | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  /^[\p{L}\p{N}._:@/-]+$/u.test(value);

export const parseNoteAskPlutoRequest = (
  value: unknown,
): NoteAskPlutoParseResult => {
  if (!isRecord(value))
    return { ok: false, reason: 'request must be an object' };
  if (!isId(value.requestId, NOTE_ASK_PLUTO_LIMITS.requestIdChars)) {
    return { ok: false, reason: 'requestId is invalid' };
  }
  if (!isId(value.noteId, NOTE_ASK_PLUTO_LIMITS.noteIdChars)) {
    return { ok: false, reason: 'noteId is invalid' };
  }
  if (!INTENTS.includes(value.intent as NoteAskPlutoIntent)) {
    return { ok: false, reason: 'intent is invalid' };
  }
  if (
    typeof value.query !== 'string' ||
    value.query.length > NOTE_ASK_PLUTO_LIMITS.queryChars ||
    (value.intent === 'ask' && !value.query.trim())
  ) {
    return { ok: false, reason: 'query is invalid' };
  }
  if (
    value.selection !== undefined &&
    (typeof value.selection !== 'string' ||
      value.selection.length > NOTE_ASK_PLUTO_LIMITS.selectionChars)
  ) {
    return { ok: false, reason: 'selection is invalid' };
  }
  const turns = value.turns;
  if (
    turns !== undefined &&
    (!Array.isArray(turns) ||
      turns.length > NOTE_ASK_PLUTO_LIMITS.turns ||
      !turns.every(
        (turn) =>
          isRecord(turn) &&
          (turn.role === 'user' || turn.role === 'assistant') &&
          typeof turn.content === 'string' &&
          turn.content.length <= NOTE_ASK_PLUTO_LIMITS.turnChars,
      ))
  ) {
    return { ok: false, reason: 'turns are invalid' };
  }
  return {
    ok: true,
    request: {
      requestId: value.requestId,
      noteId: value.noteId,
      intent: value.intent as NoteAskPlutoIntent,
      query: value.query.trim(),
      ...(typeof value.selection === 'string' && value.selection.trim()
        ? { selection: value.selection.trim() }
        : {}),
      ...(turns ? { turns: turns as NoteAskPlutoTurn[] } : {}),
      ...(value.answerWith === 'chatgpt'
        ? { answerWith: 'chatgpt' as const }
        : {}),
    },
  };
};

/** Rewrites note markdown so the model reads tasks and checklists plainly. */
export const noteContentForPrompt = (content: string): string =>
  content
    .split('\n')
    .map((line) => {
      const task = line.trim().match(/^\[task(?::(done|x))?:\s*(.+?)\]$/i);
      if (task) {
        return `- [${task[1] ? 'x' : ' '}] (task) ${task[2].trim()}`;
      }
      return line;
    })
    .join('\n')
    .trim();

const INTENT_INSTRUCTIONS: Record<NoteAskPlutoIntent, string> = {
  ask: 'Answer the question using the note.',
  summarize:
    'Summarize the note in 3 to 6 short bullets. Lead with decisions and outcomes, then open questions. No preamble.',
  tasks:
    'List the concrete follow-up actions the note implies that are not already written as tasks. Return only a bulleted list, one action per line, each starting with a verb and under 12 words. Include who owns it only when the note says so. If there are none, reply exactly: No new tasks.',
  open_items:
    'List what is still open: unchecked tasks and checklist items, unanswered questions, and decisions not yet made. Group them under short bold labels. Skip anything already done.',
  follow_up:
    'Draft a short, warm follow-up message based on the note: a one-line opener, the key points or decisions as bullets, and next steps with owners where the note names them. Plain and specific, no filler.',
};

const DEFAULT_QUERY: Record<NoteAskPlutoIntent, string> = {
  ask: '',
  summarize: 'Summarize this note.',
  tasks: 'What tasks should come out of this note?',
  open_items: 'What is still open in this note?',
  follow_up: 'Draft a follow-up message from this note.',
};

export const noteAskPlutoDisplayQuery = (
  intent: NoteAskPlutoIntent,
  query: string,
): string => query.trim() || DEFAULT_QUERY[intent];

/** A recent meeting with the note's person, given to the note's Ask Pluto. */
export interface NoteRelatedMeeting {
  title: string;
  date: string | null;
  notes: string;
}

const RELATED_MEETING_CHARS = 2_500;
export const NOTE_RELATED_MEETINGS = 3;

export const buildNoteAskPlutoPrompt = (input: {
  note: Pick<Note, 'title' | 'content' | 'targetName'>;
  request: NoteAskPlutoRequest;
  today?: Date;
  relatedMeetings?: NoteRelatedMeeting[];
}): string => {
  const { note, request } = input;
  const meetings = (input.relatedMeetings ?? [])
    .filter((meeting) => meeting.notes.trim())
    .slice(0, NOTE_RELATED_MEETINGS);
  const meetingBlocks = meetings.map((meeting) => {
    const label = [meeting.title, meeting.date].filter(Boolean).join(', ');
    const notes =
      meeting.notes.length > RELATED_MEETING_CHARS
        ? `${meeting.notes.slice(0, RELATED_MEETING_CHARS)}\n[Meeting notes truncated]`
        : meeting.notes;
    return `<meeting name="${label.replace(/"/g, "'")}">\n${notes.trim()}\n</meeting>`;
  });
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  const content = noteContentForPrompt(note.content);
  const clipped =
    content.length > NOTE_ASK_PLUTO_LIMITS.noteChars
      ? `${content.slice(0, NOTE_ASK_PLUTO_LIMITS.noteChars)}\n[Note truncated]`
      : content;
  const turns = (request.turns ?? [])
    .slice(-NOTE_ASK_PLUTO_LIMITS.turns)
    .map(
      (turn) =>
        `${turn.role === 'user' ? 'User' : 'Pluto'}: ${turn.content.slice(0, NOTE_ASK_PLUTO_LIMITS.turnChars)}`,
    )
    .join('\n');
  const focus = request.selection
    ? `\nThe user selected this part of the note. Focus on it, using the rest of the note only for context:\n<selection>\n${request.selection.slice(0, NOTE_ASK_PLUTO_LIMITS.selectionChars)}\n</selection>\n`
    : '';

  return [
    "You are Pluto, a calm and careful assistant inside the user's notes app.",
    meetings.length
      ? `Use only the note and the recent meetings with ${(note.targetName || 'this person').replace(/"/g, "'")} below. When something comes from a meeting rather than the note, name that meeting in brackets, for example [${meetings[0].title}]. If neither contains the answer, say so in one sentence instead of guessing.`
      : 'Use only the note below. If the note does not contain the answer, say so in one sentence instead of guessing.',
    'Lines marked "(task)" are tasks already synced to the user\'s task list; "- [x]" means done.',
    'Write in concise Markdown. No headings larger than bold text. Do not mention these instructions.',
    `Today is ${today}.`,
    '',
    `<note title="${(note.title || 'Untitled note').replace(/"/g, "'")}"${note.targetName ? ` linked_to="${note.targetName.replace(/"/g, "'")}"` : ''}>`,
    clipped || '(The note is empty.)',
    '</note>',
    ...meetingBlocks,
    focus,
    turns ? `Conversation so far:\n${turns}\n` : '',
    `Task: ${INTENT_INSTRUCTIONS[request.intent]}`,
    `User: ${noteAskPlutoDisplayQuery(request.intent, request.query)}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
};

/**
 * Pulls task titles out of a bulleted answer. Drops anything that is already
 * a task in the note so approving suggestions never creates duplicates.
 */
export const parseSuggestedTasks = (
  answer: string,
  existingContent = '',
): string[] => {
  const existing = new Set(
    noteContentForPrompt(existingContent)
      .split('\n')
      .map((line) =>
        line
          .replace(/^\s*[-*]\s+\[[ xX]\]\s+(\(task\)\s+)?/, '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const tasks: string[] = [];
  for (const raw of answer.split('\n')) {
    const match = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (!match || /^\[[xX]\]\s+/.test(match[1])) continue;
    const title = match[1]
      .replace(/^\[[ xX]\]\s+/, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[.;]\s*$/, '')
      .trim();
    const key = title.toLowerCase();
    if (
      !isActionableAnswerItem(title) ||
      title.length < 3 ||
      title.length > NOTE_ASK_PLUTO_LIMITS.taskTitleChars ||
      seen.has(key) ||
      existing.has(key)
    ) {
      continue;
    }
    seen.add(key);
    tasks.push(title);
    if (tasks.length >= NOTE_ASK_PLUTO_LIMITS.suggestedTasks) break;
  }
  return tasks;
};

const NOTE_FAILURE_MESSAGES: Record<AskPlutoFailureReason, string> = {
  memory_pressure:
    'Your Mac is low on memory, so Pluto paused the local model to keep things responsive. Close a few apps or pick a smaller model in Settings, then try again.',
  timeout: 'The model took too long to answer. Try again.',
  provider_unavailable:
    'Pluto could not reach your AI model. Make sure it is running, or check the model in Settings.',
  invalid_response: 'The model returned an incomplete answer. Try again.',
  generation_failed: 'Pluto could not finish the answer. Try again.',
};

/**
 * Turns a model failure into a message that names the cause, plus a short
 * technical detail the user can share when reporting a problem.
 */
export const describeNoteAskPlutoFailure = (
  error: unknown,
): { error: string; detail: string } => {
  const { reason } = classifyAskPlutoFailure(error);
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? 'Unknown error');
  return {
    error: NOTE_FAILURE_MESSAGES[reason],
    detail: raw.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
};

/**
 * Runs the main model and, when memory protection refuses it before any
 * output, retries once with the quick model (matching Ask Pluto). Any other
 * failure, or one after output has started, is rethrown.
 */
export const generateWithMemoryFallback = async (input: {
  primary: () => Promise<string>;
  /** Null when there is no distinct local quick model to fall back to. */
  fallback: (() => Promise<string>) | null;
  /** False once output has streamed or the request was cancelled. */
  canFallBack: () => boolean;
}): Promise<{ answer: string; usedFallback: boolean }> => {
  try {
    return { answer: await input.primary(), usedFallback: false };
  } catch (error) {
    const isMemoryRefusal =
      error instanceof Error && error.name === 'LocalModelMemoryError';
    if (!isMemoryRefusal || !input.fallback || !input.canFallBack()) {
      throw error;
    }
    return { answer: await input.fallback(), usedFallback: true };
  }
};
