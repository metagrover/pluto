import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';
import type {
  NotesSource,
  SourceSpan,
} from '../../electron/llm/meetingNotesTypes';

export type ScoredVisibleNotesBlock = {
  path: string;
  kind:
    | 'point'
    | 'action'
    | 'decision'
    | 'question'
    | 'aggregate_action'
    | 'aggregate_decision'
    | 'supporting_prose';
  text: string;
  owner: string | null;
  due: string | null;
  inlineEvidence: string | null;
  provenanceValid: boolean;
  resolvedEvidence: string | null;
  sourceSegments: number[];
};

const normalize = (value: string): string =>
  value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();

const resolveSpans = (
  source: NotesSource,
  spans: readonly SourceSpan[],
): { evidence: string; segments: Set<number> } | null => {
  if (!spans.length) return null;
  const evidence: string[] = [];
  const segments = new Set<number>();
  for (const span of spans) {
    const segment = source.segments.find(
      (entry) => entry.index === span.segment,
    );
    if (
      !segment ||
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end <= span.start ||
      span.end > segment.text.length
    ) {
      return null;
    }
    evidence.push(segment.text.slice(span.start, span.end));
    segments.add(segment.index);
  }
  return { evidence: evidence.join('\n'), segments };
};

export const visibleBlocks = (
  analysis: AnalysisDocumentV3,
  source: NotesSource,
): ScoredVisibleNotesBlock[] => {
  const provenance = analysis.generation_metadata?.source_provenance;
  const revisionMatches = provenance?.source_revision === source.revision;
  const blocks: ScoredVisibleNotesBlock[] = [];
  const add = (
    path: string,
    kind: ScoredVisibleNotesBlock['kind'],
    text: string,
    owner: string | null = null,
    due: string | null = null,
    inlineEvidence: string | null = null,
  ) => {
    const metadata = provenance?.blocks[path];
    const resolved = metadata ? resolveSpans(source, metadata.sources) : null;
    const requiresInlineEvidence =
      kind === 'action' ||
      kind === 'decision' ||
      kind === 'aggregate_action' ||
      kind === 'aggregate_decision';
    const inlineEvidenceMatches = requiresInlineEvidence
      ? inlineEvidence !== null &&
        resolved !== null &&
        normalize(inlineEvidence) === normalize(resolved.evidence)
      : inlineEvidence === null;
    blocks.push({
      path,
      kind,
      text,
      owner,
      due,
      inlineEvidence,
      provenanceValid: Boolean(
        revisionMatches &&
          metadata?.id.trim() &&
          resolved &&
          inlineEvidenceMatches,
      ),
      resolvedEvidence: resolved?.evidence ?? null,
      sourceSegments: resolved ? [...resolved.segments] : [],
    });
  };

  add('overview', 'supporting_prose', analysis.overview);
  analysis.topics.forEach((topic, topicIndex) => {
    add(`topic:${topicIndex}:title`, 'supporting_prose', topic.title);
    if (topic.summary.trim()) {
      add(`topic:${topicIndex}:summary`, 'point', topic.summary);
    }
    topic.key_points.forEach((point, pointIndex) =>
      add(`topic:${topicIndex}:point:${pointIndex}`, 'point', point.text),
    );
    topic.action_items.forEach((action, actionIndex) =>
      add(
        `topic:${topicIndex}:action:${actionIndex}`,
        'action',
        action.text,
        action.assignee ?? null,
        action.due ?? null,
        action.evidence ?? null,
      ),
    );
    topic.decisions.forEach((decision, decisionIndex) =>
      add(
        `topic:${topicIndex}:decision:${decisionIndex}`,
        'decision',
        decision.text,
        decision.decided_by ?? null,
        null,
        decision.evidence ?? null,
      ),
    );
    topic.open_questions.forEach((question, questionIndex) =>
      add(
        `topic:${topicIndex}:question:${questionIndex}`,
        'question',
        question,
      ),
    );
  });
  analysis.all_action_items.forEach((action, actionIndex) =>
    add(
      `all_action_items:${actionIndex}`,
      'aggregate_action',
      action.text,
      action.assignee ?? null,
      action.due ?? null,
      action.evidence ?? null,
    ),
  );
  analysis.all_decisions.forEach((decision, decisionIndex) =>
    add(
      `all_decisions:${decisionIndex}`,
      'aggregate_decision',
      decision.text,
      decision.decided_by ?? null,
      null,
      decision.evidence ?? null,
    ),
  );
  if (analysis.recent_win) {
    add('recent_win:win', 'supporting_prose', analysis.recent_win.win);
    add(
      'recent_win:why_it_counts',
      'supporting_prose',
      analysis.recent_win.why_it_counts,
    );
  }
  return blocks;
};
