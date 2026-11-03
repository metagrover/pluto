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
    meeting: z.enum(['none', 'last', 'first', 'all']).default('none'),
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
    meeting: { type: 'string', enum: ['none', 'last', 'first', 'all'] },
    one_on_one: { type: 'boolean' },
    timeframe: { type: 'string' },
    reply: { type: 'string' },
  },
};

// What Pluto can actually do. Conversation and help replies are written from
// this, so they stay accurate and can go deeper when asked.
const PRODUCT_BRIEF = `Pluto is a local-first Mac meeting-notes app: it records and transcribes meetings on the Mac and writes notes with decisions, actions and topics. Chat can answer questions about past meetings with citations; find and count meetings by person, project, title or date; summarize a person's or project's work and help prepare; track Tasks and commitments (overdue, due soon, open; create or complete); read the connected calendar; and draft emails, Slack messages or updates from the notes. Notes stay on the Mac unless a cloud model is configured; meetings marked confidential are kept out of chat. Setup: record from the sidebar button (needs microphone and system-audio permission); ChatGPT and Claude connections are in Settings → Advanced; the calendar is in Settings → Meetings.`;

const ROUTES_GUIDE = `Routes: conversation = greetings, thanks, small talk, Pluto's capabilities, or follow-ups about the conversation itself (e.g. "tell me more" after a conversation reply). help = using, setting up or troubleshooting Pluto. meetings = anything answered from meeting notes (decisions, people, projects, status, summaries, comparisons, priorities, drafts from meetings). schedule = upcoming calendar events. tasks = lists of overdue, due or open tasks and commitments. count = how many meetings, calls or 1:1s. task_action = create, complete, reopen or change a task.`;

const RULES = `Fields: relation = new_topic | follow_up (depends on earlier turns) | expansion (more on the last answer) | acknowledgment (thanks, agreement). question = the latest message rewritten to stand alone: replace pronouns and references ("it", "those", "the one before") with the person, project, meeting, date or topic they mean; keep the user's intent; for drafts keep recipient and format. people = people the question is about, not the user. meeting = last | first | all when it points at someone's meetings ("my last 1:1 with X"), else none; one_on_one = true for 1:1s. timeframe = the period in the user's words, else empty. task = draft (writing a message), comparison, analysis (assessment, risks, advice) or lookup. reply = only for conversation and help: one to five warm, specific sentences from the brief, never meeting facts; empty otherwise. Never answer meeting questions yourself.`;

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

export const buildAskPlutoPlanPrompt = ({
  question,
  turns,
  now = new Date(),
  priorSources = [],
}: {
  question: string;
  turns: readonly AskPlutoConversationTurn[];
  now?: Date;
  priorSources?: readonly string[];
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
${priorSources.length ? `Previous answer drew on: ${priorSources.slice(0, 6).join('; ')}\n` : ''}Latest message: ${clip(question.trim(), 600)}
JSON:`;
};

export const parseAskPlutoPlan = (raw: string): AskPlutoTurnPlan | null => {
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
        : relation === 'expansion'
          ? 'reuse'
          : 'fresh',
    retrievalQuery: plan.question,
    answerQuery: plan.question,
    ...(legacy.priorQuestion ? { priorQuestion: legacy.priorQuestion } : {}),
  };
};
