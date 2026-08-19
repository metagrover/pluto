import type {
  AnalysisDocument,
  AnalysisDocumentV3,
  TopicSection,
  UserEditsMap,
} from '../types';
import { applyUserEdit } from './analysisDocument';

export type MeetingNotesSectionKind =
  | 'decisions'
  | 'actions'
  | 'scratchpad'
  | 'current_read'
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
}

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

const toBlock = ({
  id,
  path,
  text,
  editsMap,
  authorship = 'ai',
  ...metadata
}: {
  id: string;
  path?: string;
  text: string;
  editsMap: UserEditsMap;
  authorship?: MeetingNotesAuthorship;
  speaker?: string;
  assignee?: string;
  due?: string;
  evidence?: string;
  transcriptRange?: [number, number];
  completed?: boolean;
}): MeetingNotesBlock => ({
  id,
  path,
  text: path ? applyUserEdit(text, path, editsMap) : text,
  originalText: text,
  authorship,
  edited: Boolean(path && editsMap[path]),
  ...metadata,
});

const uniqueBlocks = (blocks: MeetingNotesBlock[]): MeetingNotesBlock[] => {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = normalizeForComparison(block.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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
): MeetingNotesSection[] => {
  const sections: MeetingNotesSection[] = [];

  if (doc.all_decisions.length > 0) {
    sections.push({
      id: 'decisions',
      kind: 'decisions',
      title: 'Decisions',
      blocks: doc.all_decisions.map((decision, index) =>
        toBlock({
          id: `decision-${index}`,
          path: `all_decisions:${index}`,
          text: decision.text,
          editsMap,
          speaker: decision.decided_by,
          evidence: decision.evidence,
        }),
      ),
    });
  }

  if (doc.all_action_items.length > 0) {
    sections.push({
      id: 'actions',
      kind: 'actions',
      title: 'Next steps',
      blocks: doc.all_action_items.map((item, index) =>
        toBlock({
          id: `action-${index}`,
          path: `all_action_items:${index}`,
          text: item.text,
          editsMap,
          assignee: item.assignee,
          due: item.due,
          evidence: item.evidence,
          completed:
            editsMap[`completion:all_action_items:${index}`]?.edited === 'true',
        }),
      ),
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
      title: 'Current read',
      blocks: [
        toBlock({
          id: 'overview',
          path: 'overview',
          text: doc.overview,
          editsMap,
        }),
      ],
    });
  }

  const openQuestionBlocks: MeetingNotesBlock[] = [];
  for (const group of groupTopics(doc.topics)) {
    const topicIndex = group.entries[0].index;
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
          }),
        ),
      ]),
    );

    if (discussionBlocks.length > 0) {
      sections.push({
        id: `topic-${topicIndex}`,
        kind: 'discussion',
        title: applyUserEdit(
          group.title,
          `topic:${topicIndex}:title`,
          editsMap,
        ),
        titlePath: `topic:${topicIndex}:title`,
        titleOriginal: group.title,
        transcriptRange: group.transcriptRange,
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
): MeetingNotesSection[] => {
  const sections: MeetingNotesSection[] = [];
  if (doc.decisions.length > 0) {
    sections.push({
      id: 'decisions',
      kind: 'decisions',
      title: 'Decisions',
      blocks: doc.decisions.map((text, index) =>
        toBlock({
          id: `v2-decision-${index}`,
          path: `v2:decision:${index}`,
          text,
          editsMap,
        }),
      ),
    });
  }
  if (doc.action_items.length > 0) {
    sections.push({
      id: 'actions',
      kind: 'actions',
      title: 'Next steps',
      blocks: doc.action_items.map((text, index) =>
        toBlock({
          id: `v2-action-${index}`,
          path: `v2:action:${index}`,
          text,
          editsMap,
          completed:
            editsMap[`completion:v2:action:${index}`]?.edited === 'true',
        }),
      ),
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
      title: 'Current read',
      blocks: doc.summary.map((text, index) =>
        toBlock({
          id: `v2-summary-${index}`,
          path: `v2:summary:${index}`,
          text,
          editsMap,
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
}: {
  v2: AnalysisDocument | null;
  v3: AnalysisDocumentV3 | null;
  userNotes: string;
  editsMap: UserEditsMap;
}): MeetingNotesDocumentModel => {
  const sections = v3
    ? buildV3Sections(v3, editsMap)
    : v2
      ? buildV2Sections(v2, editsMap)
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

  return { sections, hasAnalysis: Boolean(v2 || v3) };
};
