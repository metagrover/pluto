// One planning step per Ask Pluto turn.
//
// Routing used to be decided by dozens of independent phrase patterns, each
// unaware of what the others or the previous turn did ("tell me more" after a
// capability answer searched meetings and found nothing). The planner reads
// the latest message with the recent dialogue once and returns a structured
// plan: which source answers it, a standalone version of the question, and
// the people, meeting and period it refers to. Conversation and product-help
// turns carry their reply in the same call. Evidence answers still run
// through retrieval, grounding, citation and privacy checks; the planner only
// decides what to look up. Any failure falls back to the existing routing.

import { z } from 'zod';

import type { AskPlutoConversationTurn } from '../../src/types/askPlutoQuery';
import type {
  AskPlutoConversationRelation,
  AskPlutoConversationResolution,
  AskPlutoResearchTask,
} from './askPlutoConversation';
import { parseMeetingReference } from './askPlutoQuestionFrame';
import type { ConversationTurnMode } from './conversationController';

export const ASK_PLUTO_PLAN_ROUTES = [
  'conversation',
  'help',
  'meetings',
  'schedule',
  'tasks',
  'count',
  'task_action',
] as const;
export type AskPlutoPlanRoute = (typeof ASK_PLUTO_PLAN_ROUTES)[number];

const planSchema = z
  .object({
    route: z.enum(ASK_PLUTO_PLAN_ROUTES),
    relation: z.enum(['new_topic', 'follow_up', 'expansion', 'acknowledgment']),
    task: z.enum(['lookup', 'analysis', 'comparison', 'draft']),
    question: z.string().trim().min(1).max(600),
    people: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
    meeting: z
      .enum(['none', 'last', 'previous', 'first', 'all'])
      .default('none'),
    one_on_one: z.boolean().default(false),
    timeframe: z.string().trim().max(60).default(''),
    reply: z.string().trim().max(1500).default(''),
  })
  .strict();

export type AskPlutoTurnPlan = z.infer<typeof planSchema>;

export const ASK_PLUTO_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'route',
    'relation',
    'task',
    'question',
    'people',
    'meeting',
    'one_on_one',
    'timeframe',
    'reply',
  ],
  properties: {
    route: { type: 'string', enum: [...ASK_PLUTO_PLAN_ROUTES] },
    relation: {
      type: 'string',
      enum: ['new_topic', 'follow_up', 'expansion', 'acknowledgment'],
    },
    task: {
      type: 'string',
      enum: ['lookup', 'analysis', 'comparison', 'draft'],
    },
    question: { type: 'string' },
    people: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    meeting: {
      type: 'string',
      enum: ['none', 'last', 'previous', 'first', 'all'],
    },
    one_on_one: { type: 'boolean' },
    timeframe: { type: 'string' },
    reply: { type: 'string' },
  },
};

// What Pluto can actually do. Conversation and help replies are written from
// this, so they stay accurate and can go deeper when asked.
const PRODUCT_BRIEF = `Pluto is a local-first Mac meeting-notes app: it records and transcribes meetings on the Mac and writes notes with decisions, actions and topics. Chat can answer questions about past meetings with citations; find and count meetings by person, project, title or date; summarize a person's or project's work and help prepare; track Tasks and commitments (overdue, due soon, open); preview and apply changes to notes, personal tasks and person agendas with Undo (create or append notes, extract linked tasks, create tasks with deadlines, edit/reschedule/complete/reopen tasks, add next-time discussion topics); read the connected calendar; and draft emails, Slack messages or updates from the notes. Notes stay on the Mac unless a cloud model is configured; meetings marked confidential are kept out of chat. Setup: record from the sidebar button (needs microphone and system-audio permission); ChatGPT and Claude connections are in Settings → Advanced; the calendar is in Settings → Meetings.`;

const ROUTES_GUIDE = `Routes: conversation = greetings, thanks, small talk, Pluto's capabilities, or follow-ups about the conversation itself (e.g. "tell me more" after a conversation reply). help = using, setting up or troubleshooting Pluto. meetings = anything answered from meeting notes (decisions, people, projects, status, summaries, comparisons, priorities, drafts from meetings). A bare person, project, acronym or topic is a meeting lookup. schedule = upcoming calendar events. tasks = only an explicit request for a list of overdue, due, slipping or open tasks. What to focus on, priorities or what matters most is meetings with task=analysis, keeping the user's wording. count = how many meetings, calls or 1:1s. task_action = any explicit request to create or append a note, create/extract/edit/reschedule/complete/reopen a personal task, or add an item to a person’s next-time agenda; also a follow-up supplying a target requested by an action clarification. These actions show a preview and require Apply. Drafting an email, Slack message or update always uses meetings with task=draft.`;

const RULES = `Fields: relation = new_topic | follow_up (depends on earlier turns) | expansion (more on the last answer) | acknowledgment (thanks, agreement). question = the latest message rewritten to stand alone: replace pronouns and references ("it", "those", "the one before") with the person, project, meeting, date or topic they mean; keep the user's scope: earlier citations are clues, not meeting restrictions; for drafts keep recipient and format. people = subjects of the requested facts, excluding the user and draft recipients unless their work is the subject. meeting = last | previous (second most recent, e.g. "the one before" after the last meeting) | first | all for a person's meetings, else none. A request to draft from the preceding discussion does not select a new meeting; one_on_one = true for 1:1s. timeframe = the period in the user's words, else empty. task = draft (writing a message), comparison, analysis (assessment, risks, advice) or lookup. reply = only for conversation and help: one to five warm, specific sentences from the brief, never meeting facts; empty otherwise. Never answer meeting questions yourself.`;

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

export const buildAskPlutoPlanPrompt = ({
  question,
  turns,
  now = new Date(),
}: {
  question: string;
  turns: readonly AskPlutoConversationTurn[];
  now?: Date;
}): string => {
  const dialogue = turns
    .slice(-6)
    .map(
      (turn) =>
        `${turn.role === 'user' ? 'User' : 'Pluto'}: ${clip(turn.content.replace(/\s+/g, ' ').trim(), turn.role === 'user' ? 300 : 500)}`,
    )
    .join('\n');
  // Static instructions first so a local model can reuse its cached prefix.
  return `${PRODUCT_BRIEF}

${ROUTES_GUIDE}

${RULES}

Return JSON with keys route, relation, task, question, people, meeting, one_on_one, timeframe, reply.

Today: ${now.toISOString().slice(0, 10)}
Recent dialogue:
${dialogue || '(none)'}
Latest message: ${clip(question.trim(), 600)}
JSON:`;
};

const FOCUS_QUESTION =
  /\b(?:focus|prioriti[sz]e|priorit(?:y|ies)|on my plate|matters? most|work on next|start with)\b/i;
const DUE_LIST_QUESTION =
  /\b(?:overdue|slipping|past due|late|due|deadlines?)\b/i;

export const parseAskPlutoPlan = (
  raw: string,
  originalQuestion?: string,
): AskPlutoTurnPlan | null => {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = planSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    const plan = parsed.data;
    // Focus and priority questions need the workspace review, not a due list.
    if (
      plan.route === 'tasks' &&
      originalQuestion &&
      FOCUS_QUESTION.test(originalQuestion) &&
      !DUE_LIST_QUESTION.test(originalQuestion)
    ) {
      plan.route = 'meetings';
      plan.task = 'analysis';
      plan.question = originalQuestion.trim().slice(0, 600);
    }
    if (plan.task === 'draft') {
      plan.route = 'meetings';
      // A recipient or a meeting mentioned in the prior answer does not
      // create a new source scope for a draft about that answer.
      if (
        originalQuestion &&
        plan.relation === 'follow_up' &&
        plan.meeting !== 'previous' &&
        !parseMeetingReference(originalQuestion)
      ) {
        plan.meeting = 'none';
        plan.one_on_one = false;
      }
    }
    // A reply is only meaningful for turns answered without evidence.
    if ((plan.route === 'conversation' || plan.route === 'help') && !plan.reply)
      return null;
    return plan;
  } catch {
    return null;
  }
};

const turnModeFor = (plan: AskPlutoTurnPlan): ConversationTurnMode =>
  plan.route === 'conversation'
    ? 'social'
    : plan.route === 'task_action'
      ? 'act'
      : plan.task === 'draft'
        ? 'draft'
        : plan.relation === 'expansion'
          ? 'expand'
          : 'lookup';

// Combine the plan with the existing resolution. Specialised flows the
// planner does not model (omission review, draft revision, retry) keep the
// existing resolution.
export const applyAskPlutoPlan = (
  legacy: AskPlutoConversationResolution,
  plan: AskPlutoTurnPlan,
  hasPriorTurns: boolean,
): AskPlutoConversationResolution => {
  if (
    legacy.relation === 'omission_follow_up' ||
    legacy.answerQuery.startsWith('Revise the previous draft')
  )
    return legacy;
  const relation: AskPlutoConversationRelation = hasPriorTurns
    ? plan.relation
    : 'new_topic';
  const task: AskPlutoResearchTask = plan.task;
  return {
    relation,
    task,
    turnMode: turnModeFor(plan),
    retrievalPolicy:
      plan.route === 'conversation' || plan.route === 'help'
        ? 'none'
        : relation === 'expansion' ||
            (relation === 'follow_up' &&
              task === 'draft' &&
              plan.meeting === 'none')
          ? 'reuse'
          : 'fresh',
    retrievalQuery: plan.question,
    answerQuery: task === 'draft' ? legacy.answerQuery : plan.question,
    ...(legacy.priorQuestion ? { priorQuestion: legacy.priorQuestion } : {}),
  };
};
