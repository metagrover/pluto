import type {
  KnowledgeDoc,
  KnowledgeDocScopeType,
} from '../../api/knowledgeDocs';
import type { KnowledgeProjectHealthCard } from '../../api/knowledgeWorkspace';

export type KnowledgeSectionKey =
  | 'decisions'
  | 'topic_evolution'
  | 'open_risks'
  | 'signals';

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

export interface KnowledgeDependencySuggestion {
  source_name: string;
  target_name: string;
  relationship: 'depends_on' | 'blocked_by' | 'owns' | 'impacts';
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

export interface StructuredKnowledgeDoc {
  schema_version: number;
  scope: {
    type: KnowledgeDocScopeType;
    title: string;
  };
  chapters: KnowledgeChapter[];
  dependency_suggestions: KnowledgeDependencySuggestion[];
}

export interface KnowledgeDocGroup {
  scopeType: KnowledgeDocScopeType;
  label: string;
  docs: KnowledgeDoc[];
}

export type KnowledgeBriefLaneId =
  | 'priorities'
  | 'risks'
  | 'patterns'
  | 'dependencies';

export interface KnowledgeBriefLane {
  id: KnowledgeBriefLaneId;
  label: string;
  description: string;
  items: KnowledgeStatement[];
}

export interface KnowledgeBrief {
  isCompiled: boolean;
  headline: string;
  lanes: KnowledgeBriefLane[];
}

export type ProjectRadarSeverity = 'critical' | 'watch' | 'steady';

export interface ActiveProjectRadarItem {
  id: string;
  title: string;
  label: string;
  severity: ProjectRadarSeverity;
  reasons: string[];
}

export const SECTION_LABELS: Record<KnowledgeSectionKey, string> = {
  decisions: 'Decisions',
  topic_evolution: 'Topic Evolution',
  open_risks: 'Open Risks',
  signals: 'Signals',
};

export const SECTION_DESCRIPTIONS: Record<KnowledgeSectionKey, string> = {
  decisions: 'Durable choices Pluto found across the source meetings.',
  topic_evolution: 'Themes whose meaning or direction changed over time.',
  open_risks: 'Unresolved risks, blockers, and unclear commitments.',
  signals: 'Patterns worth keeping in working memory.',
};

const GROUP_LABELS: Record<KnowledgeDocScopeType, string> = {
  global: 'Workspace Memory',
  project: 'Project Docs',
  person_context: 'People',
  team_tracker: 'Team Trackers',
};

const GROUP_ORDER: KnowledgeDocScopeType[] = [
  'global',
  'project',
  'person_context',
  'team_tracker',
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const parseCitations = (value: unknown): KnowledgeCitation[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((citation) => ({
      meeting_id: asString(citation.meeting_id),
      quote: asString(citation.quote),
    }))
    .filter((citation) => citation.meeting_id || citation.quote);
};

const parseStatements = (value: unknown): KnowledgeStatement[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((statement, index) => ({
    id: asString(statement.id) || `statement-${index}`,
    text: asString(statement.text),
    why_it_matters: asString(statement.why_it_matters),
    citations: parseCitations(statement.citations),
  }));
};

export const parseStructuredKnowledgeDoc = (
  doc: KnowledgeDoc | null | undefined,
): StructuredKnowledgeDoc | null => {
  if (!doc?.structured_json) return null;

  try {
    const parsed = JSON.parse(doc.structured_json) as unknown;
    if (!isObject(parsed)) return null;

    const scope = isObject(parsed.scope) ? parsed.scope : {};
    const chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const dependencySuggestions = Array.isArray(parsed.dependency_suggestions)
      ? parsed.dependency_suggestions
      : [];

    return {
      schema_version:
        typeof parsed.schema_version === 'number' ? parsed.schema_version : 1,
      scope: {
        type: (asString(scope.type) || doc.scope_type) as KnowledgeDocScopeType,
        title: asString(scope.title) || doc.title,
      },
      chapters: chapters.filter(isObject).map((chapter, index) => ({
        chapter_id: asString(chapter.chapter_id) || `chapter-${index}`,
        title: asString(chapter.title) || doc.title,
        decisions: parseStatements(chapter.decisions),
        topic_evolution: parseStatements(chapter.topic_evolution),
        open_risks: parseStatements(chapter.open_risks),
        signals: parseStatements(chapter.signals),
      })),
      dependency_suggestions: dependencySuggestions
        .filter(isObject)
        .map((suggestion) => ({
          source_name: asString(suggestion.source_name),
          target_name: asString(suggestion.target_name),
          relationship: asString(
            suggestion.relationship,
          ) as KnowledgeDependencySuggestion['relationship'],
          why: asString(suggestion.why),
          citations: parseCitations(suggestion.citations),
        }))
        .filter(
          (suggestion) =>
            suggestion.source_name &&
            suggestion.target_name &&
            suggestion.relationship,
        ),
    };
  } catch {
    return null;
  }
};

export const getSectionStatements = (
  structuredDoc: StructuredKnowledgeDoc | null,
  section: KnowledgeSectionKey,
): KnowledgeStatement[] => {
  if (!structuredDoc) return [];
  return structuredDoc.chapters.flatMap((chapter) => chapter[section]);
};

export const deriveKnowledgeDigest = (
  doc: KnowledgeDoc | null | undefined,
  maxItems = 4,
): string[] => {
  if (!doc) return [];
  const structured = parseStructuredKnowledgeDoc(doc);
  if (structured) {
    const orderedSections: KnowledgeSectionKey[] = [
      'decisions',
      'topic_evolution',
      'open_risks',
      'signals',
    ];
    const items = orderedSections.flatMap((section) =>
      getSectionStatements(structured, section).map((item) => item.text),
    );
    const structuredDigest = items
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems);
    if (structuredDigest.length > 0) return structuredDigest;
  }

  if (!doc.rendered_content) return [];
  return doc.rendered_content
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, '')
        .replace(/^#+\s+/, ''),
    )
    .filter(
      (line) =>
        line &&
        !/^auto-synthesized/i.test(line) &&
        line !== doc.title &&
        line !== 'No citation-backed context is available yet.',
    )
    .slice(0, maxItems);
};

export const compileKnowledgeBrief = (
  doc: KnowledgeDoc | null | undefined,
): KnowledgeBrief => {
  const structured = parseStructuredKnowledgeDoc(doc);
  const emptyLanes: KnowledgeBriefLane[] = [
    {
      id: 'priorities',
      label: 'What matters now',
      description: 'Signals and decisions that should shape attention.',
      items: [],
    },
    {
      id: 'risks',
      label: 'Risks to watch',
      description: 'Failure modes, blockers, and unresolved commitments.',
      items: [],
    },
    {
      id: 'patterns',
      label: 'Patterns changing',
      description: 'How themes are evolving across conversations.',
      items: [],
    },
    {
      id: 'dependencies',
      label: 'Cross-project links',
      description: 'Potential dependencies and impact paths Pluto inferred.',
      items: [],
    },
  ];

  if (!structured) {
    return {
      isCompiled: false,
      headline: 'No reliable compiled brief yet.',
      lanes: emptyLanes,
    };
  }

  const signals = getSectionStatements(structured, 'signals');
  const decisions = getSectionStatements(structured, 'decisions');
  const risks = getSectionStatements(structured, 'open_risks');
  const patterns = getSectionStatements(structured, 'topic_evolution');
  const dependencies =
    structured?.dependency_suggestions.map((suggestion, index) => ({
      id: `dependency-${index}`,
      text: `${suggestion.source_name} ${suggestion.relationship.replace(
        /_/g,
        ' ',
      )} ${suggestion.target_name}`,
      why_it_matters: suggestion.why,
      citations: suggestion.citations,
    })) || [];
  const lanes: KnowledgeBriefLane[] = [
    {
      id: 'priorities',
      label: 'What matters now',
      description: 'Signals and decisions that should shape attention.',
      items: [...signals, ...decisions],
    },
    {
      id: 'risks',
      label: 'Risks to watch',
      description: 'Failure modes, blockers, and unresolved commitments.',
      items: risks,
    },
    {
      id: 'patterns',
      label: 'Patterns changing',
      description: 'How themes are evolving across conversations.',
      items: patterns,
    },
    {
      id: 'dependencies',
      label: 'Cross-project links',
      description: 'Potential dependencies and impact paths Pluto inferred.',
      items: dependencies,
    },
  ];
  const hasCompiledItems = lanes.some((lane) => lane.items.length > 0);

  return {
    isCompiled: hasCompiledItems,
    headline:
      signals[0]?.text ||
      decisions[0]?.text ||
      risks[0]?.text ||
      patterns[0]?.text ||
      'No reliable compiled brief yet.',
    lanes,
  };
};

export const groupKnowledgeDocs = (
  docs: KnowledgeDoc[],
): KnowledgeDocGroup[] => {
  return GROUP_ORDER.map((scopeType) => ({
    scopeType,
    label: GROUP_LABELS[scopeType],
    docs: docs
      .filter((doc) => doc.scope_type === scopeType)
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
  })).filter((group) => group.docs.length > 0);
};

export const compileActiveProjectRadar = (
  docs: KnowledgeDoc[],
  projectCards: KnowledgeProjectHealthCard[],
): ActiveProjectRadarItem[] => {
  const projectDocs = docs.filter((doc) => doc.scope_type === 'project');
  const docsById = new Map(projectDocs.map((doc) => [doc.id, doc]));
  const cardItems = projectCards.map((card) => {
    const doc = docsById.get(card.doc_id);
    const reasons = [
      card.open_blockers > 0
        ? `${card.open_blockers} blocker${card.open_blockers === 1 ? '' : 's'}`
        : '',
      card.dependency_count > 0
        ? `${card.dependency_count} dependenc${
            card.dependency_count === 1 ? 'y' : 'ies'
          }`
        : '',
      card.recent_changes > 0
        ? `${card.recent_changes} recent change${
            card.recent_changes === 1 ? '' : 's'
          }`
        : '',
      card.staleness_days > 7 ? `${card.staleness_days}d stale` : '',
      doc?.status === 'failed' ? 'synthesis failed' : '',
      doc?.status === 'stale' ? 'doc stale' : '',
    ].filter(Boolean);

    const severity: ProjectRadarSeverity =
      card.open_blockers > 0 || doc?.status === 'failed'
        ? 'critical'
        : card.dependency_count > 0 ||
            card.staleness_days > 7 ||
            doc?.status === 'stale'
          ? 'watch'
          : 'steady';

    const label =
      severity === 'critical'
        ? 'Needs attention'
        : severity === 'watch'
          ? card.staleness_days > 7 || doc?.status === 'stale'
            ? 'Getting stale'
            : 'Watch'
          : 'Steady';

    return {
      id: card.doc_id,
      title: card.title || doc?.title || 'Untitled project',
      label,
      severity,
      reasons: reasons.length > 0 ? reasons : ['No blockers surfaced'],
    };
  });

  const cardDocIds = new Set(projectCards.map((card) => card.doc_id));
  const docOnlyItems = projectDocs
    .filter((doc) => !cardDocIds.has(doc.id))
    .filter((doc) => doc.status !== 'inactive')
    .map((doc) => {
      const severity: ProjectRadarSeverity =
        doc.status === 'failed'
          ? 'critical'
          : doc.status === 'stale'
            ? 'watch'
            : 'steady';
      return {
        id: doc.id,
        title: doc.title,
        label:
          severity === 'critical'
            ? 'Needs attention'
            : severity === 'watch'
              ? 'Getting stale'
              : 'Steady',
        severity,
        reasons: [formatDocStatus(doc.status)],
      };
    });

  const severityRank: Record<ProjectRadarSeverity, number> = {
    critical: 0,
    watch: 1,
    steady: 2,
  };

  return [...cardItems, ...docOnlyItems].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity],
  );
};

export const formatDocStatus = (status: KnowledgeDoc['status']): string => {
  return status.replace(/_/g, ' ');
};

export const formatRelativeKnowledgeTime = (
  value: string | null | undefined,
): string => {
  if (!value) return 'Never synthesized';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'Unknown freshness';

  const diffMs = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};
