import type {
  AnalysisDocument,
  AnalysisDocumentV3,
  TopicSection,
  UserEditsMap,
} from '../types';
import { applyUserEdit } from './analysisDocument';
import { projectMeetingNotesSpeakerReferences } from './meetingNotesSpeakerReferences';
import {
  getAnonymousSpeakerDisplayLabel,
  isGenericSpeakerLabel,
} from './speakerReview';

export type MeetingNotesSectionKind =
  | 'outcomes'
  | 'scratchpad'
  | 'current_read'
  | 'review'
  | 'discussion'
  | 'open_questions';

export type MeetingNotesAuthorship = 'human' | 'ai';

export interface MeetingNotesBlock {
  id: string;
  path?: string;
  text: string;
  originalText: string;
  authorship: MeetingNotesAuthorship;
  edited: boolean;
  speaker?: string;
  assignee?: string;
  due?: string;
  evidence?: string;
  transcriptRange?: [number, number];
  completed?: boolean;
  blockType?: 'decision' | 'action' | 'note' | 'paragraph' | 'review';
  nativeContinuation?: {
    parentPath: string;
    id: string;
  };
  nativeContinuations?: NativeMeetingNoteContinuation[];
}

export interface NativeMeetingNoteContinuation {
  id: string;
  text: string;
  completed?: boolean;
}

export const nativeContinuationEditPath = (parentPath: string): string =>
  `native_continuations:${parentPath}`;

export interface MeetingNotesSection {
  id: string;
  kind: MeetingNotesSectionKind;
  title: string;
  titlePath?: string;
  titleOriginal?: string;
  transcriptRange?: [number, number];
  completed?: boolean;
  blocks: MeetingNotesBlock[];
}

export interface MeetingNotesDocumentModel {
  sections: MeetingNotesSection[];
  hasAnalysis: boolean;
}

const normalizeForComparison = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const resolveSpeakerDisplayName = (
  speaker: string | undefined | null,
  displayNames?: Readonly<Record<string, string>>,
): string | undefined => {
  if (!speaker) return undefined;
  if (!displayNames) return speaker;
  const direct = displayNames[speaker]?.trim();
  if (direct) return direct;
  const anonLabel = getAnonymousSpeakerDisplayLabel(speaker);
  const anonDirect = displayNames[anonLabel]?.trim();
  if (anonDirect) return anonDirect;
  const remoteMatch = speaker.match(/^Speaker\s+(\d+)$/i);
  if (remoteMatch) {
    const remoteKey = `Remote Speaker ${remoteMatch[1]}`;
    const remoteDirect = displayNames[remoteKey]?.trim();
    if (remoteDirect) return remoteDirect;
  }
  return speaker;
};

export const applySpeakerDisplayNamesToText = (
  text: string,
  displayNames?: Readonly<Record<string, string>>,
): string => {
  if (!text || !displayNames) return text;
  let result = text;

  for (const [rawSpeaker, rawDisplayName] of Object.entries(displayNames)) {
    const displayName = rawDisplayName?.trim();
    if (!displayName) continue;

    // Handle numbered speakers: "Speaker 1", "Remote Speaker 1"
    const numberMatch =
      rawSpeaker.match(/^Speaker\s+(\d+)$/i) ||
      rawSpeaker.match(/^Remote Speaker\s+(\d+)$/i);
    if (numberMatch) {
      const num = numberMatch[1];
      const pattern = new RegExp(
        `\\b(?:Remote\\s+)?Speaker\\s+${num}\\b`,
        'gi',
      );
      result = result.replace(pattern, displayName);
      continue;
    }

    // Handle "Them" — match when used as speaker label / subject,
    // e.g. at start of sentence, before a colon, or capitalized.
    if (rawSpeaker.trim().toLowerCase() === 'them') {
      result = result
        .replace(/(?:^|(?<=[.!?]\s+))Them\b/g, displayName)
        .replace(/\bThem(?=\s*[:—])/g, displayName);
      continue;
    }

    // Handle "Me" before colon / attribution
    if (rawSpeaker.trim() === 'Me') {
      result = result
        .replace(/(?:^|(?<=[.!?]\s+))Me\b/g, displayName)
        .replace(/\bMe(?=\s*[:—])/g, displayName);
      continue;
    }

    // Direct whole-word replacement for other generic speaker labels
    if (isGenericSpeakerLabel(rawSpeaker)) {
      const pattern = new RegExp(
        `\\b${escapeRegExp(rawSpeaker.trim())}\\b`,
        'gi',
      );
      result = result.replace(pattern, displayName);
    }
  }

  return result;
};

const toBlock = ({
  id,
  path,
  text,
  editsMap,
  authorship = 'ai',
  displayNames,
  ...metadata
}: {
  id: string;
  path?: string;
  text: string;
  editsMap: UserEditsMap;
  authorship?: MeetingNotesAuthorship;
  displayNames?: Readonly<Record<string, string>>;
  speaker?: string;
  assignee?: string;
  due?: string;
  evidence?: string;
  transcriptRange?: [number, number];
  completed?: boolean;
  blockType?: 'decision' | 'action' | 'note' | 'paragraph' | 'review';
}): MeetingNotesBlock => {
  const userEdited = Boolean(path && editsMap[path]);
  let blockText = path ? applyUserEdit(text, path, editsMap) : text;
  if (!userEdited && authorship === 'ai' && displayNames) {
    blockText = applySpeakerDisplayNamesToText(blockText, displayNames);
  }
  const speaker = resolveSpeakerDisplayName(metadata.speaker, displayNames);
  const assignee = resolveSpeakerDisplayName(metadata.assignee, displayNames);
  const evidence =
    metadata.evidence && displayNames
      ? applySpeakerDisplayNamesToText(metadata.evidence, displayNames)
      : metadata.evidence;

  return {
    id,
    path,
    text: blockText,
    originalText: text,
    authorship,
    edited: userEdited,
    ...metadata,
    ...(speaker !== undefined ? { speaker } : {}),
    ...(assignee !== undefined ? { assignee } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
  };
};

const uniqueBlocks = (blocks: MeetingNotesBlock[]): MeetingNotesBlock[] => {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = normalizeForComparison(block.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const parseNativeContinuations = (
  parentPath: string | undefined,
  editsMap: UserEditsMap,
): NativeMeetingNoteContinuation[] => {
  if (!parentPath) return [];
  const saved = editsMap[nativeContinuationEditPath(parentPath)]?.edited;
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is NativeMeetingNoteContinuation =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as NativeMeetingNoteContinuation).id === 'string' &&
        typeof (item as NativeMeetingNoteContinuation).text === 'string',
    );
  } catch {
    return [];
  }
};

const expandNativeContinuations = (
  blocks: MeetingNotesBlock[],
  editsMap: UserEditsMap,
): MeetingNotesBlock[] =>
  blocks.flatMap((block) => {
    const continuations = parseNativeContinuations(block.path, editsMap);
    if (continuations.length === 0) return [block];
    const blockWithContinuations = {
      ...block,
      nativeContinuations: continuations,
    };
    return [
      blockWithContinuations,
      ...continuations.map((continuation) => ({
        ...blockWithContinuations,
        id: `${block.id}:continuation:${continuation.id}`,
        path: undefined,
        text: continuation.text,
        originalText: continuation.text,
        authorship: 'human' as const,
        edited: true,
        completed: continuation.completed,
        nativeContinuation: {
          parentPath: block.path!,
          id: continuation.id,
        },
      })),
    ];
  });

interface TopicGroup {
  title: string;
  entries: Array<{ topic: TopicSection; index: number }>;
  transcriptRange?: [number, number];
}

const groupTopics = (topics: TopicSection[]): TopicGroup[] => {
  const groups: TopicGroup[] = [];
  const byTitle = new Map<string, TopicGroup>();

  topics.forEach((topic, index) => {
    const key = normalizeForComparison(topic.title);
    const existing = byTitle.get(key);
    if (!existing) {
      const group: TopicGroup = {
        title: topic.title,
        entries: [{ topic, index }],
        transcriptRange: topic.transcript_range,
      };
      byTitle.set(key, group);
      groups.push(group);
      return;
    }

    existing.entries.push({ topic, index });
    if (topic.transcript_range) {
      existing.transcriptRange = existing.transcriptRange
        ? [
            Math.min(existing.transcriptRange[0], topic.transcript_range[0]),
            Math.max(existing.transcriptRange[1], topic.transcript_range[1]),
          ]
        : topic.transcript_range;
    }
  });

  return groups;
};

const buildV3Sections = (
  doc: AnalysisDocumentV3,
  editsMap: UserEditsMap,
  displayNames?: Readonly<Record<string, string>>,
): MeetingNotesSection[] => {
  const sections: MeetingNotesSection[] = [];

  if (doc.all_decisions.length > 0 || doc.all_action_items.length > 0) {
    sections.push({
      id: 'outcomes',
      kind: 'outcomes',
      title: 'Decisions & next steps',
      blocks: [
        ...doc.all_decisions.map((decision, index) =>
          toBlock({
            id: `decision-${index}`,
            path: `all_decisions:${index}`,
            text: decision.text,
            editsMap,
            speaker: decision.decided_by,
            evidence: decision.evidence,
            completed:
              editsMap[`completion:all_decisions:${index}`]?.edited === 'true',
            blockType: 'decision',
            displayNames,
          }),
        ),
        ...doc.all_action_items.map((item, index) =>
          toBlock({
            id: `action-${index}`,
            path: `all_action_items:${index}`,
            text: item.text,
            editsMap,
            assignee: item.assignee,
            due: item.due,
            evidence: item.evidence,
            completed:
              editsMap[`completion:all_action_items:${index}`]?.edited ===
              'true',
            blockType: 'action',
            displayNames,
          }),
        ),
      ],
    });
  }

  sections.push({
    id: 'scratchpad',
    kind: 'scratchpad',
    title: 'Your notes',
    blocks: [],
  });

  if (doc.overview.trim()) {
    sections.push({
      id: 'current-read',
      kind: 'current_read',
      title: 'Overview',
      blocks: [
        toBlock({
          id: 'overview',
          path: 'overview',
          text: doc.overview,
          editsMap,
          blockType: 'paragraph',
          displayNames,
        }),
      ],
    });
  }

  const proseReviewItems = doc.generation_metadata?.prose_review?.items ?? [];
  if (proseReviewItems.length > 0) {
    sections.push({
      id: 'prose-review',
      kind: 'review',
      title: 'Needs review',
      blocks: proseReviewItems.map((item, index) =>
        toBlock({
          id: `prose-review-${index}`,
          text: `Review unclear wording from “${item.section_title}”`,
          editsMap,
          evidence: item.evidence,
          blockType: 'review',
          displayNames,
        }),
      ),
    });
  }

  const openQuestionBlocks: MeetingNotesBlock[] = [];
  for (const group of groupTopics(doc.topics)) {
    const discussionBlocks = uniqueBlocks(
      group.entries.flatMap(({ topic, index }) => [
        ...(topic.summary
          ? [
              toBlock({
                id: `topic-${index}-summary`,
                path: `topic:${index}:summary`,
                text: topic.summary,
                editsMap,
                transcriptRange: topic.transcript_range,
                displayNames,
              }),
            ]
          : []),
        ...topic.key_points.map((point, pointIndex) =>
          toBlock({
            id: `topic-${index}-point-${pointIndex}`,
            path: `topic:${index}:point:${pointIndex}`,
            text: point.text,
            editsMap,
            speaker: point.speaker,
            authorship: point.from_user_notes ? 'human' : 'ai',
            transcriptRange: topic.transcript_range,
            displayNames,
          }),
        ),
      ]),
    );

    if (discussionBlocks.length > 0) {
      const firstEntry = group.entries[0];
      sections.push({
        id: `topic-${firstEntry.index}`,
        kind: 'discussion',
        title: editsMap[`topic:${firstEntry.index}:title`]
          ? applyUserEdit(
              group.title,
              `topic:${firstEntry.index}:title`,
              editsMap,
            )
          : applySpeakerDisplayNamesToText(group.title, displayNames),
        titleOriginal: firstEntry.topic.title,
        titlePath: `topic:${firstEntry.index}:title`,
        blocks: discussionBlocks,
      });
    }

    group.entries.forEach(({ topic, index }) => {
      topic.open_questions.forEach((question, questionIndex) => {
        openQuestionBlocks.push(
          toBlock({
            id: `topic-${index}-question-${questionIndex}`,
            path: `topic:${index}:question:${questionIndex}`,
            text: question,
            editsMap,
            transcriptRange: topic.transcript_range,
            displayNames,
          }),
        );
      });
    });
  }

  const uniqueQuestions = uniqueBlocks(openQuestionBlocks);
  if (uniqueQuestions.length > 0) {
    sections.push({
      id: 'open-questions',
      kind: 'open_questions',
      title: 'Open questions',
      blocks: uniqueQuestions,
    });
  }

  return sections;
};

const buildV2Sections = (
  doc: AnalysisDocument,
  editsMap: UserEditsMap,
  displayNames?: Readonly<Record<string, string>>,
): MeetingNotesSection[] => {
  const sections: MeetingNotesSection[] = [];
  if (doc.decisions.length > 0 || doc.action_items.length > 0) {
    sections.push({
      id: 'outcomes',
      kind: 'outcomes',
      title: 'Decisions & next steps',
      blocks: [
        ...doc.decisions.map((text, index) =>
          toBlock({
            id: `v2-decision-${index}`,
            path: `v2:decision:${index}`,
            text,
            editsMap,
            completed:
              editsMap[`completion:v2:decision:${index}`]?.edited === 'true',
            blockType: 'decision',
            displayNames,
          }),
        ),
        ...doc.action_items.map((text, index) =>
          toBlock({
            id: `v2-action-${index}`,
            path: `v2:action:${index}`,
            text,
            editsMap,
            completed:
              editsMap[`completion:v2:action:${index}`]?.edited === 'true',
            blockType: 'action',
            displayNames,
          }),
        ),
      ],
    });
  }

  sections.push({
    id: 'scratchpad',
    kind: 'scratchpad',
    title: 'Your notes',
    blocks: [],
  });

  if (doc.summary.length > 0) {
    sections.push({
      id: 'current-read',
      kind: 'current_read',
      title: 'What was discussed',
      blocks: doc.summary.map((text, index) =>
        toBlock({
          id: `v2-summary-${index}`,
          path: `v2:summary:${index}`,
          text,
          editsMap,
          displayNames,
        }),
      ),
    });
  }
  if (doc.key_points.length > 0) {
    sections.push({
      id: 'discussion-highlights',
      kind: 'discussion',
      title: 'Discussion highlights',
      blocks: doc.key_points.map((text, index) =>
        toBlock({
          id: `v2-point-${index}`,
          path: `v2:point:${index}`,
          text,
          editsMap,
          displayNames,
        }),
      ),
    });
  }
  return sections;
};

export const buildMeetingNotesDocument = ({
  v2,
  v3,
  userNotes,
  editsMap,
  displayNames,
}: {
  v2: AnalysisDocument | null;
  v3: AnalysisDocumentV3 | null;
  userNotes: string;
  editsMap: UserEditsMap;
  displayNames?: Readonly<Record<string, string>>;
}): MeetingNotesDocumentModel => {
  const projectedV3 = v3
    ? projectMeetingNotesSpeakerReferences(v3, displayNames ?? {})
    : null;
  const sections = v3
    ? buildV3Sections(projectedV3!, editsMap, displayNames)
    : v2
      ? buildV2Sections(v2, editsMap, displayNames)
      : [
          {
            id: 'scratchpad',
            kind: 'scratchpad' as const,
            title: 'Your notes',
            blocks: [],
          },
        ];
  const scratchpad = sections.find((section) => section.kind === 'scratchpad');
  if (scratchpad && userNotes.trim()) {
    scratchpad.blocks = [
      toBlock({
        id: 'scratchpad-content',
        text: userNotes,
        editsMap,
        authorship: 'human',
      }),
    ];
  }
  if (scratchpad && sections.at(-1) !== scratchpad) {
    sections.splice(sections.indexOf(scratchpad), 1);
    sections.push(scratchpad);
  }

  return {
    sections: sections.map((section) => ({
      ...section,
      blocks: expandNativeContinuations(section.blocks, editsMap),
    })),
    hasAnalysis: Boolean(v2 || v3),
  };
};
