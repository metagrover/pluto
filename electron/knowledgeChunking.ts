export type KnowledgeScope = {
  type: string;
  title: string;
};

export interface KnowledgeChunkSourceMeeting {
  id: string;
  title: string;
  occurred_at: string | null;
  evidence: string;
}

export interface KnowledgeCitation {
  meeting_id: string;
  quote: string;
}

export interface KnowledgeStatement {
  id: string;
  text: string;
  why_it_matters: string;
  citations: KnowledgeCitation[];
}

export type KnowledgeDependencyRelationship =
  | 'depends_on'
  | 'blocked_by'
  | 'owns'
  | 'impacts';

export interface KnowledgeDependencySuggestion {
  source_name: string;
  target_name: string;
  relationship: KnowledgeDependencyRelationship;
  why: string;
  citations: KnowledgeCitation[];
}

export interface KnowledgeChapter {
  chapter_id: string;
  title: string;
  decisions: KnowledgeStatement[];
  topic_evolution: KnowledgeStatement[];
  open_risks: KnowledgeStatement[];
  signals: KnowledgeStatement[];
}

export interface KnowledgeStructuredDocument {
  schema_version: number;
  scope: KnowledgeScope;
  chapters: KnowledgeChapter[];
  dependency_suggestions: KnowledgeDependencySuggestion[];
}

export interface KnowledgeSourceChunk {
  index: number;
  label: string;
  sourceMeetings: KnowledgeChunkSourceMeeting[];
}

type SectionKey = 'decisions' | 'topic_evolution' | 'open_risks' | 'signals';

const SECTION_KEYS: SectionKey[] = [
  'decisions',
  'topic_evolution',
  'open_risks',
  'signals',
];

const MAX_MERGED_SECTION_ITEMS = 15;
const MAX_MERGED_DEPENDENCIES = 30;
const MIN_LLM_MERGE_STATEMENT_RETENTION = 0.75;
const MIN_LLM_MERGE_CITATION_RETENTION = 0.75;
const MAX_DETERMINISTIC_ITEMS_PER_SECTION = 8;

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

export const buildKnowledgeSourceChunks = (
  sourceMeetings: KnowledgeChunkSourceMeeting[],
  maxMeetingsPerChunk: number,
): KnowledgeSourceChunk[] => {
  const chunkSize = Math.max(1, maxMeetingsPerChunk);
  const totalChunks = Math.ceil(sourceMeetings.length / chunkSize);
  const chunks: KnowledgeSourceChunk[] = [];

  for (let start = 0; start < sourceMeetings.length; start += chunkSize) {
    const index = chunks.length;
    chunks.push({
      index,
      label: `Chunk ${index + 1} of ${totalChunks}`,
      sourceMeetings: sourceMeetings.slice(start, start + chunkSize),
    });
  }

  return chunks;
};

export const splitKnowledgeSourceChunk = (
  chunk: KnowledgeSourceChunk,
): KnowledgeSourceChunk[] => {
  if (chunk.sourceMeetings.length <= 1) return [chunk];
  const midpoint = Math.ceil(chunk.sourceMeetings.length / 2);
  return [
    {
      index: chunk.index,
      label: `${chunk.label} retry 1`,
      sourceMeetings: chunk.sourceMeetings.slice(0, midpoint),
    },
    {
      index: chunk.index,
      label: `${chunk.label} retry 2`,
      sourceMeetings: chunk.sourceMeetings.slice(midpoint),
    },
  ].filter((retry) => retry.sourceMeetings.length > 0);
};

const emptyChapter = (): KnowledgeChapter => ({
  chapter_id: 'compiled',
  title: 'Compiled Knowledge',
  decisions: [],
  topic_evolution: [],
  open_risks: [],
  signals: [],
});

const clipText = (value: string, maxChars: number): string => {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trim()}...`;
};

const cleanEvidenceItem = (value: string): string =>
  value
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\[[ x]\]\s+/i, '')
    .replace(/^Implemented choice:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const isNonDecision = (value: string): boolean =>
  /\bno explicit decisions?\b|\bnone\b/i.test(value);

const isLowValueSignal = (value: string): boolean =>
  /^(notes excerpt|recovered from|the meeting opened with|the conversation revolves)\b/i.test(
    value,
  );

const labelPattern = (label: string): RegExp =>
  new RegExp(
    `${label}:\\s*([\\s\\S]*?)(?=\\n(?:Summary|Key points|Action items|Decisions|Notes summary|Notes highlights|Notes action items|Notes decisions|Continuity signals|Accountability risks|Decision impacts|Signal tags|Entity hints|Entity mention contexts|Transcript highlights|Context snippet|Transcript excerpt|User notes):|$)`,
    'i',
  );

const extractEvidenceItems = (evidence: string, label: string): string[] => {
  const match = evidence.match(labelPattern(label));
  if (!match?.[1]) return [];
  return match[1]
    .split(/\s+\|\s+|\n+/)
    .map(cleanEvidenceItem)
    .filter((item) => item.length >= 18);
};

const pushDeterministicStatement = (
  target: KnowledgeStatement[],
  seen: Set<string>,
  meeting: KnowledgeChunkSourceMeeting,
  text: string,
  why: string,
): void => {
  if (target.length >= MAX_DETERMINISTIC_ITEMS_PER_SECTION) return;
  const cleaned = clipText(cleanEvidenceItem(text), 180);
  const key = normalizeText(cleaned);
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push({
    id: `${meeting.id}-${target.length + 1}`,
    text: cleaned.endsWith('.') ? cleaned : `${cleaned}.`,
    why_it_matters: why,
    citations: [
      {
        meeting_id: meeting.id,
        quote: cleaned,
      },
    ],
  });
};

export const buildDeterministicKnowledgeDocument = (
  scope: KnowledgeScope,
  sourceMeetings: KnowledgeChunkSourceMeeting[],
): KnowledgeStructuredDocument => {
  const chapter = emptyChapter();
  const seen = new Set<string>();

  for (const meeting of sourceMeetings) {
    const decisions = [
      ...extractEvidenceItems(meeting.evidence, 'Decisions'),
      ...extractEvidenceItems(meeting.evidence, 'Notes decisions'),
      ...extractEvidenceItems(meeting.evidence, 'Decision impacts'),
    ].filter((decision) => !isNonDecision(decision));
    for (const decision of decisions) {
      pushDeterministicStatement(
        chapter.decisions,
        seen,
        meeting,
        decision,
        `Captured from ${meeting.title} as durable decision context.`,
      );
    }

    const risks = [
      ...extractEvidenceItems(meeting.evidence, 'Action items'),
      ...extractEvidenceItems(meeting.evidence, 'Notes action items'),
      ...extractEvidenceItems(meeting.evidence, 'Accountability risks'),
    ];
    for (const risk of risks) {
      pushDeterministicStatement(
        chapter.open_risks,
        seen,
        meeting,
        risk,
        `Captured from ${meeting.title} as follow-up or unresolved work.`,
      );
    }

    const signals = [
      ...extractEvidenceItems(meeting.evidence, 'Key points'),
      ...extractEvidenceItems(meeting.evidence, 'Notes highlights'),
      ...extractEvidenceItems(meeting.evidence, 'Continuity signals'),
      ...extractEvidenceItems(meeting.evidence, 'Summary'),
      ...extractEvidenceItems(meeting.evidence, 'Notes summary'),
    ].filter((signal) => !isLowValueSignal(signal));
    for (const signal of signals) {
      pushDeterministicStatement(
        chapter.signals,
        seen,
        meeting,
        signal,
        `Captured from ${meeting.title} as recurring context for this knowledge scope.`,
      );
    }
  }

  const hasItems = SECTION_KEYS.some((section) => chapter[section].length > 0);

  return {
    schema_version: 1,
    scope,
    chapters: hasItems ? [chapter] : [],
    dependency_suggestions: [],
  };
};

const appendUniqueStatements = (
  target: KnowledgeStatement[],
  source: KnowledgeStatement[],
  seen: Set<string>,
): void => {
  for (const item of source) {
    const key = normalizeText(item.text);
    if (!key || seen.has(key)) continue;
    target.push(item);
    seen.add(key);
    if (target.length >= MAX_MERGED_SECTION_ITEMS) break;
  }
};

const dependencyKey = (suggestion: KnowledgeDependencySuggestion): string =>
  [
    suggestion.source_name,
    suggestion.relationship,
    suggestion.target_name,
    suggestion.why,
  ]
    .map(normalizeText)
    .join('|');

export const mergeChunkStructuredDocuments = (
  scope: KnowledgeScope,
  chunkDocuments: KnowledgeStructuredDocument[],
): KnowledgeStructuredDocument => {
  const chapter = emptyChapter();
  const seenBySection = new Map<SectionKey, Set<string>>();
  for (const section of SECTION_KEYS) {
    seenBySection.set(section, new Set<string>());
  }

  for (const doc of chunkDocuments) {
    for (const sourceChapter of doc.chapters) {
      for (const section of SECTION_KEYS) {
        appendUniqueStatements(
          chapter[section],
          sourceChapter[section],
          seenBySection.get(section) || new Set<string>(),
        );
      }
    }
  }

  const dependencySeen = new Set<string>();
  const dependencies: KnowledgeDependencySuggestion[] = [];
  for (const doc of chunkDocuments) {
    for (const suggestion of doc.dependency_suggestions) {
      const key = dependencyKey(suggestion);
      if (!key || dependencySeen.has(key)) continue;
      dependencies.push(suggestion);
      dependencySeen.add(key);
      if (dependencies.length >= MAX_MERGED_DEPENDENCIES) break;
    }
  }

  const hasItems = SECTION_KEYS.some((section) => chapter[section].length > 0);

  return {
    schema_version: 1,
    scope,
    chapters: hasItems ? [chapter] : [],
    dependency_suggestions: dependencies,
  };
};

const countStatements = (doc: KnowledgeStructuredDocument): number =>
  doc.chapters.reduce(
    (sum, chapter) =>
      sum +
      chapter.decisions.length +
      chapter.topic_evolution.length +
      chapter.open_risks.length +
      chapter.signals.length,
    0,
  );

const countCitedMeetings = (doc: KnowledgeStructuredDocument): number => {
  const meetingIds = new Set<string>();
  for (const chapter of doc.chapters) {
    for (const section of SECTION_KEYS) {
      for (const statement of chapter[section]) {
        for (const citation of statement.citations) {
          const meetingId = citation.meeting_id.trim();
          if (meetingId) meetingIds.add(meetingId);
        }
      }
    }
  }
  for (const suggestion of doc.dependency_suggestions) {
    for (const citation of suggestion.citations) {
      const meetingId = citation.meeting_id.trim();
      if (meetingId) meetingIds.add(meetingId);
    }
  }
  return meetingIds.size;
};

const retentionIsAcceptable = (
  candidateCount: number,
  fallbackCount: number,
  minimumRatio: number,
): boolean => {
  if (fallbackCount === 0) return candidateCount === 0;
  return candidateCount / fallbackCount >= minimumRatio;
};

export const chooseKnowledgeMergeResult = (
  fallbackMerged: KnowledgeStructuredDocument,
  llmMerged: KnowledgeStructuredDocument,
): KnowledgeStructuredDocument => {
  const fallbackStatementCount = countStatements(fallbackMerged);
  const llmStatementCount = countStatements(llmMerged);
  const fallbackCitedMeetingCount = countCitedMeetings(fallbackMerged);
  const llmCitedMeetingCount = countCitedMeetings(llmMerged);

  const preservedStatements = retentionIsAcceptable(
    llmStatementCount,
    fallbackStatementCount,
    MIN_LLM_MERGE_STATEMENT_RETENTION,
  );
  const preservedCitations = retentionIsAcceptable(
    llmCitedMeetingCount,
    fallbackCitedMeetingCount,
    MIN_LLM_MERGE_CITATION_RETENTION,
  );

  return preservedStatements && preservedCitations ? llmMerged : fallbackMerged;
};
