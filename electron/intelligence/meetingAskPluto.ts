import type {
  MeetingAskPlutoCitation,
  MeetingAskPlutoLiveContext,
  MeetingAskPlutoResponse,
  MeetingAskPlutoScope,
  MeetingAskPlutoTurn,
} from '../../src/types/askPluto';
import type { TrustStatus } from '../../src/utils/trustStatus';
import type { PersistedMeeting } from '../db';
import type { MidFrontmatter } from './intelligenceTypes';
import type { MeetingAskPlutoAssistanceRoute } from './meetingAskPlutoAssistance';
import {
  buildMeetingNotesEvidenceDocument,
  resolveSavedMeetingEvidencePolicy,
} from './meetingNotesEvidence';

export const MEETING_ASK_PLUTO_TURN_LIMIT = 6;
export const MEETING_ASK_PLUTO_TURN_CHAR_LIMIT = 1200;
const MEETING_ASK_PLUTO_EVIDENCE_LIMIT = 18;
const LIVE_MEETING_ASK_PLUTO_EVIDENCE_LIMIT = 34;
const LIVE_MEETING_ASK_PLUTO_TRANSCRIPT_LIMIT = 24;
const SAVED_MEETING_TRANSCRIPT_EVIDENCE_LIMIT = 5;

export interface MeetingAskPlutoEvidenceItem {
  id: string;
  kind:
    | 'transcript'
    | 'note'
    | 'overview'
    | 'decision'
    | 'action_item'
    | 'entity'
    | 'attention';
  meetingId: string;
  title: string;
  text: string;
  quote?: string;
}

export interface MeetingAskPlutoContext {
  status: 'ready' | 'unavailable';
  scope: MeetingAskPlutoScope;
  trustStatus: TrustStatus;
  boundary: string;
  statusNote: string;
  evidenceItems: MeetingAskPlutoEvidenceItem[];
}

export interface MeetingAskPlutoContextEntity {
  id: string;
  type: string;
  name: string;
  mention_count?: number;
  context?: string | null;
}

export interface MeetingAskPlutoAttentionItem {
  id: string;
  kind?: string;
  status?: string;
  reason?: string;
}

interface TranscriptSegmentLike {
  speaker?: unknown;
  start?: unknown;
  end?: unknown;
  text?: unknown;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const parseJsonObject = <T>(value: unknown): T | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
};

const buildScope = (meeting: Pick<PersistedMeeting, 'id' | 'title'>) => ({
  type: 'meeting' as const,
  meetingId: String(meeting.id),
  title: meeting.title || 'Untitled Session',
});

const buildLiveScope = (context: MeetingAskPlutoLiveContext) => ({
  type: 'live_meeting' as const,
  meetingId: 'active-recording',
  title: context.title || 'Meeting',
});

const isLiveOrProvisional = (meeting: Partial<PersistedMeeting>) =>
  meeting.transcript_status === 'provisional' ||
  meeting.transcript_status === 'validating' ||
  meeting.transcript_status === 'needs_attention';

const addEvidence = (
  evidenceItems: MeetingAskPlutoEvidenceItem[],
  item: MeetingAskPlutoEvidenceItem,
  limit = MEETING_ASK_PLUTO_EVIDENCE_LIMIT,
) => {
  if (evidenceItems.length >= limit) return;
  if (!item.text.trim()) return;
  evidenceItems.push(item);
};

const transcriptSegmentsFromJson = (transcriptJson: unknown) => {
  const parsed = parseJsonObject<{ segments?: TranscriptSegmentLike[] }>(
    transcriptJson,
  );
  if (!parsed || !Array.isArray(parsed.segments)) return [];
  return parsed.segments
    .map((segment, index) => {
      const text = asString(segment.text);
      if (!text) return null;
      const speaker = asString(segment.speaker) ?? 'Speaker';
      const start = typeof segment.start === 'number' ? segment.start : null;
      const end = typeof segment.end === 'number' ? segment.end : null;
      const time =
        start !== null && end !== null
          ? ` (${Math.round(start)}s-${Math.round(end)}s)`
          : '';
      return {
        id: `transcript-${index}`,
        text: `${speaker}${time}: ${text}`,
        quote: text,
      };
    })
    .filter((segment): segment is { id: string; text: string; quote: string } =>
      Boolean(segment),
    );
};

const deriveContextTrustStatus = ({
  meeting,
  evidenceItems,
  mid,
}: {
  meeting: PersistedMeeting;
  evidenceItems: MeetingAskPlutoEvidenceItem[];
  mid: MidFrontmatter | null;
}): TrustStatus => {
  if (evidenceItems.length === 0) return 'needs_review';
  if (isLiveOrProvisional(meeting)) return 'weak_evidence';
  if (meeting.transcript_status === 'validated' && mid) return 'grounded';
  return 'inferred';
};

export const normalizeMeetingAskPlutoTurns = (
  turns: MeetingAskPlutoTurn[] | undefined,
): MeetingAskPlutoTurn[] => {
  if (!Array.isArray(turns)) return [];
  return turns
    .filter(
      (turn) =>
        (turn.role === 'user' || turn.role === 'assistant') &&
        turn.content.trim(),
    )
    .slice(-MEETING_ASK_PLUTO_TURN_LIMIT)
    .map((turn) => ({
      role: turn.role,
      content: turn.content.trim().slice(0, MEETING_ASK_PLUTO_TURN_CHAR_LIMIT),
      ...(turn.citationIds?.length
        ? { citationIds: turn.citationIds.slice(0, 8) }
        : {}),
    }));
};

export const buildMeetingAskPlutoContext = ({
  meeting,
  query,
  entities = [],
  attentionItems = [],
}: {
  meeting: PersistedMeeting;
  query: string;
  entities?: MeetingAskPlutoContextEntity[];
  attentionItems?: MeetingAskPlutoAttentionItem[];
}): MeetingAskPlutoContext => {
  const scope = buildScope(meeting);
  const evidenceItems: MeetingAskPlutoEvidenceItem[] = [];
  const mid = parseJsonObject<MidFrontmatter>(meeting.mid_json);
  const notesDocument = buildMeetingNotesEvidenceDocument(meeting);
  const evidencePolicy = resolveSavedMeetingEvidencePolicy(
    query,
    notesDocument.hasUsableNotes,
  );
  const transcriptEvidenceItems = transcriptSegmentsFromJson(
    meeting.transcript_json,
  )
    .slice(-SAVED_MEETING_TRANSCRIPT_EVIDENCE_LIMIT)
    .map((segment) => ({
      id: segment.id,
      kind: 'transcript' as const,
      meetingId: scope.meetingId,
      title: 'Transcript',
      text: segment.text,
      quote: segment.quote,
    }));

  if (notesDocument.notesText) {
    addEvidence(evidenceItems, {
      id: 'meeting-notes',
      kind: 'note',
      meetingId: scope.meetingId,
      title: 'Meeting notes',
      text: notesDocument.notesText.slice(0, 2400),
    });
  }

  const decisions = notesDocument.decisionsText.split('\n').filter(Boolean);
  for (const [index, decision] of decisions.slice(0, 3).entries()) {
    addEvidence(evidenceItems, {
      id: `decision-${index}`,
      kind: 'decision',
      meetingId: scope.meetingId,
      title: 'Decision',
      text: decision,
    });
  }

  const actions = notesDocument.actionItemsText.split('\n').filter(Boolean);
  for (const [index, action] of actions.slice(0, 3).entries()) {
    addEvidence(evidenceItems, {
      id: `action-${index}`,
      kind: 'action_item',
      meetingId: scope.meetingId,
      title: 'Action item',
      text: action,
    });
  }

  for (const entity of entities.slice(0, 1)) {
    addEvidence(evidenceItems, {
      id: `entity-${entity.id}`,
      kind: 'entity',
      meetingId: scope.meetingId,
      title: `${entity.type}: ${entity.name}`,
      text: entity.context || `${entity.name} was mentioned in this meeting.`,
    });
  }

  for (const item of attentionItems.slice(0, 1)) {
    addEvidence(evidenceItems, {
      id: `attention-${item.id}`,
      kind: 'attention',
      meetingId: scope.meetingId,
      title: item.kind ? `Attention: ${item.kind}` : 'Attention item',
      text: item.reason || item.status || 'Meeting attention item.',
    });
  }

  const includeTranscript = evidencePolicy !== 'notes_only';
  const boundedEvidenceItems = includeTranscript
    ? [
        ...evidenceItems.slice(
          0,
          MEETING_ASK_PLUTO_EVIDENCE_LIMIT -
            SAVED_MEETING_TRANSCRIPT_EVIDENCE_LIMIT,
        ),
        ...transcriptEvidenceItems,
      ]
    : evidenceItems.slice(0, MEETING_ASK_PLUTO_EVIDENCE_LIMIT);
  const trustStatus =
    evidencePolicy === 'transcript_fallback'
      ? 'weak_evidence'
      : deriveContextTrustStatus({
          meeting,
          evidenceItems: boundedEvidenceItems,
          mid,
        });
  const status = boundedEvidenceItems.length > 0 ? 'ready' : 'unavailable';
  const statusNote =
    evidencePolicy === 'transcript_exact'
      ? 'This answer may use bounded transcript evidence for an exact-wording request.'
      : evidencePolicy === 'transcript_fallback'
        ? 'Meeting notes are unavailable, so this answer may use weak transcript evidence.'
        : isLiveOrProvisional(meeting)
          ? 'This answer uses live or provisional meeting notes.'
          : status === 'ready'
            ? 'This answer is scoped to saved meeting notes.'
            : 'No notes or structured meeting evidence is available yet.';

  return {
    status,
    scope,
    trustStatus,
    boundary:
      'Only use evidence from this meeting supplied below. Saved meeting notes are authoritative unless the request explicitly asks for exact wording or the notes are unavailable. Do not use any other meeting, project, person, or global memory unless the user explicitly asks to broaden scope.',
    statusNote,
    evidenceItems: boundedEvidenceItems,
  };
};

export const buildLiveMeetingAskPlutoContext = (
  liveContext: MeetingAskPlutoLiveContext,
): MeetingAskPlutoContext => {
  const scope = buildLiveScope(liveContext);
  const evidenceItems: MeetingAskPlutoEvidenceItem[] = [];

  for (const segment of liveContext.transcript.slice(
    -LIVE_MEETING_ASK_PLUTO_TRANSCRIPT_LIMIT,
  )) {
    const text = asString(segment.text);
    if (!text) continue;
    const seconds = Math.max(0, Math.round(segment.timestampMs / 1_000));
    addEvidence(
      evidenceItems,
      {
        id: `live-transcript-${segment.id}`,
        kind: 'transcript',
        meetingId: scope.meetingId,
        title: segment.confirmed ? 'Live transcript' : 'Provisional transcript',
        text: `${segment.speaker || 'Speaker'} (${seconds}s): ${text}`,
        quote: text,
      },
      LIVE_MEETING_ASK_PLUTO_EVIDENCE_LIMIT,
    );
  }

  const interim = asString(liveContext.interimText);
  if (interim) {
    addEvidence(
      evidenceItems,
      {
        id: 'live-interim',
        kind: 'transcript',
        meetingId: scope.meetingId,
        title: 'Interim transcript',
        text: interim,
        quote: interim,
      },
      LIVE_MEETING_ASK_PLUTO_EVIDENCE_LIMIT,
    );
  }

  const notes = asString(liveContext.notes);
  if (notes) {
    addEvidence(
      evidenceItems,
      {
        id: 'live-notes',
        kind: 'note',
        meetingId: scope.meetingId,
        title: 'Current meeting notes',
        text: notes.slice(0, 1800),
      },
      LIVE_MEETING_ASK_PLUTO_EVIDENCE_LIMIT,
    );
  }

  for (const [index, participant] of liveContext.participants
    .filter((participant) => participant.trim())
    .slice(0, 8)
    .entries()) {
    addEvidence(
      evidenceItems,
      {
        id: `live-participant-${index}`,
        kind: 'entity',
        meetingId: scope.meetingId,
        title: 'Participant',
        text: participant.trim(),
      },
      LIVE_MEETING_ASK_PLUTO_EVIDENCE_LIMIT,
    );
  }

  return {
    status: evidenceItems.length > 0 ? 'ready' : 'unavailable',
    scope,
    trustStatus: evidenceItems.length > 0 ? 'weak_evidence' : 'needs_review',
    boundary:
      'Only use evidence from this active meeting capture. Do not use any saved meeting, project, person, or global memory unless the user explicitly asks to broaden scope.',
    statusNote:
      evidenceItems.length > 0
        ? 'This answer uses live meeting evidence that may still change.'
        : 'No live transcript, notes, or participant evidence is available yet.',
    evidenceItems,
  };
};

export const buildUnavailableMeetingAskPlutoResponse = (
  meeting: Pick<PersistedMeeting, 'id' | 'title'>,
  query: string,
): MeetingAskPlutoResponse => ({
  status: 'unavailable',
  answer: `I can’t answer this meeting yet because Pluto does not have usable transcript, notes, or analysis evidence for “${query.trim()}”.`,
  scope: buildScope(meeting),
  trustStatus: 'needs_review',
  claims: [],
  citations: [],
  rationale:
    'Meeting-scoped Ask Pluto requires at least one meeting evidence item.',
});

export const buildMeetingAskPlutoProviderUnavailableResponse = ({
  scope,
  query,
  error,
}: {
  scope: MeetingAskPlutoScope;
  query: string;
  error: unknown;
}): MeetingAskPlutoResponse => {
  const reason = error instanceof Error ? error.message : 'Unknown model error';
  return {
    status: 'unavailable',
    answer: `I can’t answer “${query.trim()}” from “${scope.title || 'this meeting'}” because the configured answer model is not available right now. Check the selected LLM provider/model, then try again.`,
    scope,
    trustStatus: 'needs_review',
    claims: [],
    citations: [],
    rationale: reason,
  };
};

const buildLiveSnapshotPacket = ({
  context,
  intro,
  rationale,
}: {
  context: MeetingAskPlutoContext;
  intro: string;
  rationale: string;
}): MeetingAskPlutoResponse | null => {
  if (context.scope.type !== 'live_meeting') return null;
  const normalizeTranscriptText = (item: MeetingAskPlutoEvidenceItem) =>
    (item.quote || item.text)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const transcriptItems = context.evidenceItems
    .filter((item) => item.kind === 'transcript')
    .reverse()
    .reduce<MeetingAskPlutoEvidenceItem[]>((items, item) => {
      const normalized = normalizeTranscriptText(item);
      const duplicate = items.some((existing) => {
        const existingNormalized = normalizeTranscriptText(existing);
        return (
          normalized === existingNormalized ||
          existingNormalized.startsWith(`${normalized} `) ||
          normalized.startsWith(`${existingNormalized} `)
        );
      });
      if (!duplicate) items.push(item);
      return items;
    }, [])
    .slice(0, 4)
    .reverse();
  const noteItem = context.evidenceItems.find((item) => item.kind === 'note');
  const participants = context.evidenceItems
    .filter((item) => item.kind === 'entity')
    .map((item) => item.text)
    .slice(0, 4);
  const citedItems = [...transcriptItems, ...(noteItem ? [noteItem] : [])];
  if (citedItems.length === 0 && participants.length === 0) return null;

  const lines = [intro];
  if (transcriptItems.length > 0) {
    lines.push('', ...transcriptItems.map((item) => `- ${item.text}`));
  }
  if (noteItem) {
    lines.push('', `Notes: ${noteItem.text}`);
  }
  if (participants.length > 0) {
    lines.push('', `People in this meeting: ${participants.join(', ')}`);
  }

  const citations: MeetingAskPlutoCitation[] = citedItems.map(
    (item, index) => ({
      id: `citation-${index + 1}`,
      claim: item.text,
      meeting_id: item.meetingId,
      meeting_title: context.scope.title || 'Meeting',
      evidence_span: item.quote || item.text,
      evidence_valid: false,
      trust_status: 'weak_evidence',
    }),
  );
  const answer = lines.join('\n');
  return {
    status: 'answered',
    answer,
    scope: context.scope,
    trustStatus: 'weak_evidence',
    claims: [
      {
        text: answer,
        trustStatus: 'weak_evidence',
        citationIds: citations.map((citation) => citation.id),
      },
    ],
    citations,
    rationale,
  };
};

export const buildLiveMeetingFallbackResponse = ({
  context,
}: {
  context: MeetingAskPlutoContext;
}): MeetingAskPlutoResponse | null =>
  buildLiveSnapshotPacket({
    context,
    intro:
      "I couldn't summarize that reliably yet. Here's the latest transcript I could read:",
    rationale:
      'Returned the frozen live meeting snapshot as a fallback after model generation failed.',
  });

export const buildMeetingAskPlutoPrompt = ({
  query,
  context,
  turns,
  assistanceRoute = { mode: 'general' },
}: {
  query: string;
  context: MeetingAskPlutoContext;
  turns?: MeetingAskPlutoTurn[];
  assistanceRoute?: MeetingAskPlutoAssistanceRoute;
}) => {
  const evidence = context.evidenceItems
    .map(
      (item, index) =>
        `[Evidence ${index + 1}] ${item.title} (${item.kind})\n${item.text}`,
    )
    .join('\n\n');
  const recentTurns = normalizeMeetingAskPlutoTurns(turns)
    .map(
      (turn) =>
        `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}${
          turn.citationIds?.length
            ? `\nCitations: ${turn.citationIds.join(', ')}`
            : ''
        }`,
    )
    .join('\n\n');

  const recallPolicy =
    assistanceRoute.mode === 'recall'
      ? {
          catch_up:
            'Prioritize the latest relevant evidence. Summarize the current discussion in one to three points, ordered from most recent or important. Do not dump transcript lines.',
          fact: 'Give the shortest complete answer and lead with the requested value, normally one sentence. Do not begin with evidence-policy narration or repeat the question. Do not discuss unrelated missing information. Add one brief caveat only when ambiguity or provisional evidence materially changes confidence. Do not present a paraphrase as an exact quote; quote wording only when the evidence contains those words.',
          decision:
            'Report an explicit agreement as a decision. Label unresolved discussion or proposal accurately instead of promoting it to a decision.',
          action:
            'Report an owner or deadline only when the evidence supports it. Describe an action as unassigned or undated when those details are missing.',
        }[assistanceRoute.recallKind]
      : '';
  const assistancePolicy =
    assistanceRoute.mode === 'recall'
      ? `Assistance mode: Recall (${assistanceRoute.recallKind})\n${recallPolicy}\nSay when live evidence is incomplete, provisional, or too noisy to support the requested recall.`
      : 'Assistance mode: General conversation';

  return `You are Pluto, answering inside a single meeting note.

Meeting scope: ${context.scope.title} (${context.scope.meetingId})
Scope boundary: ${context.boundary}
Trust note: ${context.statusNote}

Rules:
1. Answer only from the meeting evidence below.
2. If the evidence does not support the answer, say what is missing.
3. Cite factual claims with [Evidence N].
4. Treat live or provisional transcript as partial evidence.
5. Synthesize across the relevant evidence instead of treating each transcript line as a separate answer.
6. Answer conversationally and directly, matching the depth requested by the user.
7. Do not merely repeat transcript lines. Explain the situation, decisions, open questions, and next steps when relevant.
8. Keep the answer concise unless the user asks for detail.

${assistancePolicy}

Recent turns:
${recentTurns || 'None'}

Question:
${query.trim()}

Meeting evidence:
${evidence || 'None'}`;
};

const extractEvidenceReferences = (answer: string) => {
  const refs = new Set<number>();
  for (const match of answer.matchAll(/\[Evidence\s+(\d+)\]/gi)) {
    refs.add(Number.parseInt(match[1], 10) - 1);
  }
  return [...refs].filter((index) => Number.isFinite(index) && index >= 0);
};

export const buildMeetingAskPlutoResponseFromAnswer = ({
  answerRaw,
  context,
}: {
  answerRaw: string;
  context: MeetingAskPlutoContext;
}): MeetingAskPlutoResponse => {
  if (!answerRaw.trim() && context.scope.type === 'live_meeting') {
    const fallback = buildLiveMeetingFallbackResponse({ context });
    if (fallback) return fallback;
  }
  const evidenceIndexes = extractEvidenceReferences(answerRaw).filter(
    (index) => index < context.evidenceItems.length,
  );
  const citations: MeetingAskPlutoCitation[] = evidenceIndexes.map(
    (index, citationIndex) => {
      const item = context.evidenceItems[index];
      return {
        id: `citation-${citationIndex + 1}`,
        claim: item.text,
        meeting_id: item.meetingId,
        meeting_title: context.scope.title || 'Untitled Session',
        evidence_span: item.quote || item.text,
        evidence_valid: false,
        trust_status: 'needs_review',
      };
    },
  );
  const cleanAnswer = answerRaw.replace(/\[Evidence\s+\d+\]/gi, '').trim();
  const responseTrustStatus = 'needs_review';

  return {
    status: 'answered',
    answer: cleanAnswer,
    scope: context.scope,
    trustStatus: responseTrustStatus,
    claims: cleanAnswer
      ? [
          {
            text: cleanAnswer,
            trustStatus: responseTrustStatus,
            citationIds: citations.map((citation) => citation.id),
          },
        ]
      : [],
    citations,
    rationale: context.statusNote,
  };
};
