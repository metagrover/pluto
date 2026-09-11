/**
 * Analysis Document V3 — Parser, Validator, Fallback, and Markdown Renderer
 *
 * Handles parsing raw JSON from LLM output into validated AnalysisDocumentV3,
 * generating fallback documents when analysis fails, and rendering v3 documents
 * as readable markdown for export/copy.
 */

import type {
  ActionItemV3,
  AnalysisDocumentV3,
  AnalysisErrorCategory,
  AnalysisGenerationMetadata,
  AnalysisQualityV3,
  DecisionV3,
  MeetingTerminologyArtifactV1,
  MeetingType,
  NotesSourceProvenance,
  RecentWinV3,
  TopicPoint,
  TopicSection,
} from './analysisTypes';

const VALID_MEETING_TYPES: MeetingType[] = [
  'one_on_one',
  'team_sync',
  'brainstorm',
  'presentation',
  'general',
];

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseErrorCategories = (value: unknown): AnalysisErrorCategory[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is AnalysisErrorCategory => typeof item === 'string',
  );
};

const parseTerminologyArtifact = (
  raw: unknown,
): MeetingTerminologyArtifactV1 | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    !asString(record.generatedAt) ||
    !asString(record.provider) ||
    !asString(record.model) ||
    !asString(record.policyVersion) ||
    !Array.isArray(record.proposals)
  ) {
    return undefined;
  }
  const proposals = record.proposals.flatMap((rawProposal) => {
    if (!rawProposal || typeof rawProposal !== 'object') return [];
    const proposal = rawProposal as Record<string, unknown>;
    const confidence = asString(proposal.confidence);
    const status = asString(proposal.status);
    if (
      !['high', 'medium', 'low'].includes(confidence) ||
      !['applied', 'proposed', 'confirmed', 'rejected', 'preserved'].includes(
        status,
      )
    ) {
      return [];
    }
    return [
      {
        rawForms: asStringArray(proposal.rawForms),
        preferredTerm:
          typeof proposal.preferredTerm === 'string'
            ? proposal.preferredTerm.trim() || null
            : null,
        segmentIndexes: Array.isArray(proposal.segmentIndexes)
          ? proposal.segmentIndexes.filter(
              (value): value is number =>
                Number.isInteger(value) && Number(value) >= 0,
            )
          : [],
        confidence:
          confidence as MeetingTerminologyArtifactV1['proposals'][number]['confidence'],
        signals: asStringArray(proposal.signals).filter((signal) =>
          [
            'repeated_context',
            'known_person',
            'known_entity',
            'spoken_definition',
            'variant_consistency',
          ].includes(signal),
        ) as MeetingTerminologyArtifactV1['proposals'][number]['signals'],
        status:
          status as MeetingTerminologyArtifactV1['proposals'][number]['status'],
      },
    ];
  });
  return {
    schemaVersion: 1,
    generatedAt: asString(record.generatedAt),
    provider: asString(record.provider),
    model: asString(record.model),
    policyVersion: asString(record.policyVersion),
    proposals,
  };
};

const parseSourceProvenance = (
  raw: unknown,
): NotesSourceProvenance | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (
    record.schema_version !== 1 ||
    !asString(record.source_revision) ||
    !record.blocks ||
    typeof record.blocks !== 'object' ||
    Array.isArray(record.blocks)
  ) {
    return undefined;
  }
  const blocks = Object.entries(
    record.blocks as Record<string, unknown>,
  ).flatMap(([path, rawBlock]) => {
    if (!rawBlock || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) {
      return [];
    }
    const block = rawBlock as Record<string, unknown>;
    if (
      !asString(block.id) ||
      !Array.isArray(block.sources) ||
      block.sources.length === 0
    ) {
      return [];
    }
    const sources = block.sources.flatMap((rawSource) => {
      if (
        !rawSource ||
        typeof rawSource !== 'object' ||
        Array.isArray(rawSource)
      ) {
        return [];
      }
      const source = rawSource as Record<string, unknown>;
      if (
        !Number.isInteger(source.segment) ||
        !Number.isInteger(source.start) ||
        !Number.isInteger(source.end) ||
        (source.start as number) < 0 ||
        (source.end as number) <= (source.start as number)
      ) {
        return [];
      }
      return [
        {
          segment: source.segment as number,
          start: source.start as number,
          end: source.end as number,
        },
      ];
    });
    return sources.length === block.sources.length
      ? [[path, { id: asString(block.id), sources }] as const]
      : [];
  });
  return blocks.length === Object.keys(record.blocks).length
    ? {
        schema_version: 1,
        source_revision: asString(record.source_revision),
        blocks: Object.fromEntries(blocks),
      }
    : undefined;
};

const parseGenerationMetadata = (
  raw: unknown,
): AnalysisGenerationMetadata | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const provider = asString(record.provider);
  const model = asString(record.model);
  const generationPath = asString(record.generation_path);
  const promptVersion = asString(record.prompt_version);
  const generatedAt = asString(record.generated_at);
  if (
    !provider ||
    !model ||
    !generationPath ||
    !promptVersion ||
    !generatedAt
  ) {
    return undefined;
  }

  const terminology = parseTerminologyArtifact(record.terminology);
  const sourceProvenance = parseSourceProvenance(record.source_provenance);
  const rawHierarchy =
    record.hierarchy && typeof record.hierarchy === 'object'
      ? (record.hierarchy as Record<string, unknown>)
      : null;
  const hierarchy =
    rawHierarchy &&
    ['depth', 'nodes', 'max_depth', 'max_nodes'].every(
      (key) =>
        Number.isSafeInteger(rawHierarchy[key]) &&
        (rawHierarchy[key] as number) >= 0,
    ) &&
    (rawHierarchy.depth as number) <= (rawHierarchy.max_depth as number) &&
    (rawHierarchy.nodes as number) <= (rawHierarchy.max_nodes as number)
      ? {
          depth: rawHierarchy.depth as number,
          nodes: rawHierarchy.nodes as number,
          max_depth: rawHierarchy.max_depth as number,
          max_nodes: rawHierarchy.max_nodes as number,
        }
      : undefined;
  const rawGenerationOptions =
    record.generation_options && typeof record.generation_options === 'object'
      ? (record.generation_options as Record<string, unknown>)
      : null;
  const generationOptions = rawGenerationOptions
    ? {
        ...(typeof rawGenerationOptions.structured_thinking === 'boolean'
          ? {
              structured_thinking: rawGenerationOptions.structured_thinking,
            }
          : {}),
        ...(Number.isSafeInteger(rawGenerationOptions.seed)
          ? { seed: rawGenerationOptions.seed as number }
          : {}),
      }
    : null;
  return {
    provider: provider as AnalysisGenerationMetadata['provider'],
    model,
    generation_path:
      generationPath as AnalysisGenerationMetadata['generation_path'],
    prompt_version: promptVersion,
    generated_at: generatedAt,
    error_categories: parseErrorCategories(record.error_categories),
    ...(generationOptions && Object.keys(generationOptions).length > 0
      ? { generation_options: generationOptions }
      : {}),
    ...(terminology ? { terminology } : {}),
    ...(record.pipeline_version === 'writer-audit-v1' ||
    record.pipeline_version === 'writer-editor-v1' ||
    record.pipeline_version === 'writer-editor-bounded-v1'
      ? { pipeline_version: record.pipeline_version }
      : {}),
    ...(record.mode === 'direct' || record.mode === 'hierarchical'
      ? { mode: record.mode }
      : {}),
    ...(record.audit_status === 'complete'
      ? { audit_status: 'complete' as const }
      : {}),
    ...(Number.isSafeInteger(record.audit_change_count) &&
    (record.audit_change_count as number) >= 0
      ? { audit_change_count: record.audit_change_count as number }
      : {}),
    ...(sourceProvenance ? { source_provenance: sourceProvenance } : {}),
    ...(hierarchy ? { hierarchy } : {}),
  };
};

const parseTopicPoint = (raw: unknown): TopicPoint | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const text = asString(record.text);
  if (!text) return null;
  const point: TopicPoint = { text };
  if (typeof record.speaker === 'string' && record.speaker.trim()) {
    point.speaker = record.speaker.trim();
  }
  if (record.from_user_notes === true) {
    point.from_user_notes = true;
  }
  return point;
};

const parseDecisionV3 = (raw: unknown): DecisionV3 | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const text = asString(record.text);
  if (!text) return null;
  const decision: DecisionV3 = { text };
  if (typeof record.decided_by === 'string' && record.decided_by.trim()) {
    decision.decided_by = record.decided_by.trim();
  }
  if (typeof record.rationale === 'string' && record.rationale.trim()) {
    decision.rationale = record.rationale.trim();
  }
  if (typeof record.evidence === 'string' && record.evidence.trim()) {
    decision.evidence = record.evidence.trim();
  }
  return decision;
};

const parseActionItemV3 = (raw: unknown): ActionItemV3 | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const text = asString(record.text);
  if (!text) return null;
  const item: ActionItemV3 = { text };
  if (typeof record.assignee === 'string' && record.assignee.trim()) {
    item.assignee = record.assignee.trim();
  }
  if (typeof record.due === 'string' && record.due.trim()) {
    item.due = record.due.trim();
  }
  if (typeof record.topic === 'string' && record.topic.trim()) {
    item.topic = record.topic.trim();
  }
  if (typeof record.evidence === 'string' && record.evidence.trim()) {
    item.evidence = record.evidence.trim();
  }
  return item;
};

export const parseRecentWinV3 = (raw: unknown): RecentWinV3 | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const win = asString(record.win);
  const whyItCounts = asString(record.why_it_counts);
  const evidence = asString(record.evidence);
  if (!win || !whyItCounts || !evidence) return undefined;
  return { win, why_it_counts: whyItCounts, evidence };
};

const parseTopicSection = (raw: unknown): TopicSection | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const title = asString(record.title);
  if (!title) return null;

  const summary = asString(record.summary);

  const key_points = Array.isArray(record.key_points)
    ? record.key_points
        .map(parseTopicPoint)
        .filter((p): p is TopicPoint => p !== null)
    : [];
  const decisions = Array.isArray(record.decisions)
    ? record.decisions
        .map(parseDecisionV3)
        .filter((d): d is DecisionV3 => d !== null)
    : [];
  const action_items = Array.isArray(record.action_items)
    ? record.action_items
        .map(parseActionItemV3)
        .filter((a): a is ActionItemV3 => a !== null)
    : [];
  const open_questions = asStringArray(record.open_questions);

  const section: TopicSection = {
    title,
    summary,
    key_points,
    decisions,
    action_items,
    open_questions,
  };

  if (
    Array.isArray(record.transcript_range) &&
    record.transcript_range.length === 2 &&
    typeof record.transcript_range[0] === 'number' &&
    typeof record.transcript_range[1] === 'number'
  ) {
    section.transcript_range = [
      record.transcript_range[0],
      record.transcript_range[1],
    ];
  }

  return section;
};

const parseMeetingType = (value: unknown): MeetingType => {
  if (
    typeof value === 'string' &&
    VALID_MEETING_TYPES.includes(value as MeetingType)
  ) {
    return value as MeetingType;
  }
  return 'general';
};

/**
 * Parse a raw JSON string into a validated AnalysisDocumentV3.
 * Returns null if the input is empty, malformed, or missing required fields.
 */
export const parseAnalysisDocumentV3 = (
  raw: string | null | undefined,
): AnalysisDocumentV3 | null => {
  if (!raw || !raw.trim()) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const title = asString(parsed.title);
  const overview = asString(parsed.overview);
  if (!overview) return null;

  const topics = Array.isArray(parsed.topics)
    ? parsed.topics
        .map(parseTopicSection)
        .filter((t): t is TopicSection => t !== null)
    : [];

  const all_action_items = Array.isArray(parsed.all_action_items)
    ? parsed.all_action_items
        .map(parseActionItemV3)
        .filter((a): a is ActionItemV3 => a !== null)
    : [];

  const all_decisions = Array.isArray(parsed.all_decisions)
    ? parsed.all_decisions
        .map(parseDecisionV3)
        .filter((d): d is DecisionV3 => d !== null)
    : [];

  const meeting_type = parseMeetingType(parsed.meeting_type);
  const recent_win = parseRecentWinV3(parsed.recent_win);

  const qualityRaw =
    parsed.quality && typeof parsed.quality === 'object'
      ? (parsed.quality as Record<string, unknown>)
      : {};

  const quality: AnalysisQualityV3 = {
    format_pass: Boolean(qualityRaw.format_pass),
    retry_count:
      typeof qualityRaw.retry_count === 'number' ? qualityRaw.retry_count : 0,
    fallback_used: Boolean(qualityRaw.fallback_used),
    issues: asStringArray(qualityRaw.issues),
  };

  return {
    analysis_schema_version: 3,
    ...(title ? { title } : {}),
    overview,
    topics,
    all_action_items,
    all_decisions,
    ...(recent_win ? { recent_win } : {}),
    meeting_type,
    quality,
    generation_metadata: parseGenerationMetadata(parsed.generation_metadata),
  };
};

/**
 * Generate a fallback v3 analysis document when LLM analysis fails.
 */
export const fallbackAnalysisDocumentV3 = (
  retryCount = 1,
  issues: string[] = [],
): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview:
    'Conversation captured. Key themes and follow-ups are summarized below.',
  topics: [],
  all_action_items: [],
  all_decisions: [],
  meeting_type: 'general',
  quality: {
    format_pass: false,
    retry_count: retryCount,
    fallback_used: true,
    issues:
      issues.length > 0
        ? issues
        : ['Formatting validation failed; using fallback analysis structure.'],
  },
});

/**
 * Render a v3 analysis document as readable markdown for export/copy.
 */
export const analysisDocumentV3ToMarkdown = (
  doc: AnalysisDocumentV3,
): string => {
  const lines: string[] = [];

  // Overview
  lines.push(doc.overview);
  lines.push('');

  // Topic sections
  for (const topic of doc.topics) {
    lines.push('─────────────────────────────────────────────────');
    lines.push('');
    lines.push(`## ${topic.title}`);
    lines.push('');
    if (topic.summary) {
      lines.push(topic.summary);
      lines.push('');
    }

    for (const point of topic.key_points) {
      const prefix = point.from_user_notes ? '• 📝 ' : '• ';
      const speaker = point.speaker ? `${point.speaker}: ` : '';
      lines.push(`${prefix}${speaker}${point.text}`);
    }

    for (const decision of topic.decisions) {
      const by = decision.decided_by ? ` (${decision.decided_by})` : '';
      lines.push(`• Decision${by}: ${decision.text}`);
    }

    for (const question of topic.open_questions) {
      lines.push(`• ? ${question}`);
    }

    lines.push('');
  }

  // Rolled-up action items
  if (doc.all_action_items.length > 0) {
    lines.push('─────────────────────────────────────────────────');
    lines.push('');
    lines.push('## Action Items');
    lines.push('');
    for (const item of doc.all_action_items) {
      const assignee = item.assignee ? `${item.assignee}: ` : '';
      const due = item.due ? ` (${item.due})` : '';
      lines.push(`- [ ] ${assignee}${item.text}${due}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};
