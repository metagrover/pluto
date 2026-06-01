import type {
  ExtractionPriorityHints,
  InternalSignalDocument,
} from './provider';

/** @deprecated Use getStructuredAnalysisPrompt for v3 pipeline */
export const getSummaryPrompt = (
  transcript: string,
  userNotes?: string,
): string => {
  return `You are a rigorous meeting analyst producing high-fidelity user-facing notes for Pluto.

Your job is to help someone who missed the meeting understand:
- what this conversation was really about,
- what changed,
- what still needs follow-through,
- and what remains uncertain.

Analyze this transcript${userNotes ? ' and user notes' : ''} and produce polished, natural-language output.

Non-negotiable requirements:
- Use only transcript${userNotes ? ' and user-note' : ''} details. Never invent facts, owners, decisions, or deadlines.
- Keep technical meaning exact. Do not flip problem/solution, attack/defense, cause/effect, shipped/planned, or agreed/questioned.
- Treat the transcript as the source of truth. User notes may sharpen emphasis but must not override clear transcript evidence.
- If the discussion is exploratory, say that. Do not convert brainstorming, questions, or suggestions into decisions.
- If content is mostly monologue, interview, demo, or media consumption, reflect that instead of fabricating team consensus.
- Distinguish clearly between:
  - explicit decisions already made,
  - proposals or recommendations,
  - and unresolved questions or dependencies.
- Prefer concrete language over generic business-summary wording.
- Do not include internal taxonomies or field labels in user text (forbidden: "Observation:", "Why it matters:", "Supporting detail:", "Evidence:", "Pluto use:").
- Output only these four sections, in order, with markdown headings.

Quality bar:
- The Summary should explain the real purpose and outcome of the meeting, not just restate the topic.
- Key Points should capture the most important developments, disagreements, constraints, risks, and follow-ups.
- Action Items should include only explicit committed next steps with named owners when clearly stated.
- Decisions should include only explicit decisions or already-implemented choices. Questions, preferences, and tentative ideas do not count.
- If an important issue was raised but not resolved, include it in Key Points rather than Decisions.

Write exactly:

## Summary
- 2-3 concise sentences.
- Explain the core discussion, the practical outcome, and any major unresolved thread if one exists.

## Key Points
- 4-6 bullets.
- Each bullet should be one coherent, specific statement in natural prose.
- Prefer bullets that answer: what mattered, why it mattered, and what constraint or implication emerged.
- No inline meta labels.

## Action Items
- Use checkbox bullets only: - [ ] ...
- Include only explicit committed next steps.
- Include owner and timing only if clearly stated in the transcript.
- If none, write: - [ ] No concrete action items were explicitly committed.

## Decisions
- List explicit decisions and implemented choices only.
- If a decision was deferred or still under debate, do not include it here.
- If none, write: - No explicit decisions were made.

${userNotes ? `\nUser Notes (high-priority context):\n${userNotes}\n` : ''}

Transcript:
${transcript}`;
};

/** @deprecated Use getStructuredAnalysisPrompt for v3 pipeline */
export const getSummaryRepairPrompt = (
  transcript: string,
  invalidOutput: string,
  userNotes?: string,
): string => {
  return `Repair this draft analysis into Pluto's required structure.

Rules:
- Preserve factual meaning from draft/transcript${userNotes ? '/notes' : ''}; do not invent.
- Keep technical meaning exact and preserve the difference between decisions, proposals, and unresolved questions.
- Remove internal field labels and formatting noise.
- Keep natural prose bullets with specific content, not vague summary filler.
- Keep only explicit committed next steps in Action Items.
- Keep only explicit decisions or already-implemented choices in Decisions.
- Return only the corrected markdown with the required sections.

Required sections in order:
## Summary
## Key Points
## Action Items
## Decisions

Draft to repair:
${invalidOutput}

${userNotes ? `User Notes:\n${userNotes}\n` : ''}Transcript:
${transcript}`;
};

export const getValueSignalsPrompt = (
  transcript: string,
  summary?: string,
): string => {
  return `You are extracting hidden internal signals for Pluto's backend graph/connectivity systems.

Goal:
- Capture compact, reusable signal metadata for continuity, accountability, and decision impact.
- Output is internal JSON only (never user-facing phrasing).

Rules:
- Use only transcript${summary ? ' and summary' : ''} details.
- Keep each signal concrete and specific.
- Avoid duplicates and near-duplicates.
- Do not invent tasks, owners, or deadlines.
- If a category has no strong signal, return an empty array for it.
- Core signal arrays: max 3 items each.
- Free-form tags: normalize to lowercase kebab-case, dedupe, max 8.
- Confidence must be between 0 and 1.

Return valid JSON only in this exact shape:
{
  "continuity": ["string"],
  "accountability_risks": ["string"],
  "decision_impacts": ["string"],
  "extra_tags": [{"tag": "string", "confidence": 0.0}]
}

Signal definitions:
- continuity: durable context to carry forward (projects, constraints, unresolved themes, operating principles).
- accountability_risks: missing ownership/timing, single-threaded execution risk, weak disclosure workflow, or other execution risks.
- decision_impacts: explicit decisions/implemented choices with meaningful downstream impact.
- extra_tags: high-signal topical labels that can help backend ranking and connectivity.

${summary ? `Summary context:\n${summary}\n\n` : ''}Transcript:
${transcript}`;
};

export const getSpeakerIdentityPrompt = (transcript: string): string => {
  return `Analyze this conversation transcript and identify who the OTHER person is (not "You").

Look for:
- Names mentioned in introductions or conversation
- Context clues about who they are
- Any identifying information

If you can identify the other person, respond with ONLY their first name (e.g., "Sarah" or "John").
If you cannot identify them with confidence, respond with exactly: "Unknown"

Transcript:
${transcript}`;
};

export const buildRepresentativeTitleTranscript = (
  transcript: string,
  maxChars = 2400,
): string => {
  const normalized = transcript.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const excerptBudget = Math.floor(maxChars / 3);
  const middleStart = Math.max(
    0,
    Math.floor(normalized.length / 2 - excerptBudget / 2),
  );
  const closingStart = Math.max(0, normalized.length - excerptBudget);

  return [
    `Opening:\n${normalized.slice(0, excerptBudget).trim()}`,
    `Middle:\n${normalized
      .slice(middleStart, middleStart + excerptBudget)
      .trim()}`,
    `Closing:\n${normalized.slice(closingStart).trim()}`,
  ].join('\n\n[...]\n\n');
};

export const getTitlePrompt = (transcript: string): string => {
  return `Analyze this conversation transcript and generate a concise, descriptive meeting title (max 5-7 words).

The title should:
- Capture the main topic or purpose
- Prefer sustained work topics over brief rapport, greetings, schedule chatter, travel, health, or family check-ins unless those personal topics are the main sustained subject
- If a one-on-one covers several work topics, use the dominant work topic or a neutral one-on-one title
- Be professional and clear
- Not include quotes or special characters
- Be in title case

Respond with ONLY the title, nothing else.

Transcript:
${buildRepresentativeTitleTranscript(transcript)}`;
};

export const getEntitiesPrompt = (
  transcript: string,
  context?: {
    summary?: string;
    valueSignals?: InternalSignalDocument;
    priorityHints?: ExtractionPriorityHints;
  },
): string => {
  const valueSignals = context?.valueSignals;
  const priorityHints = context?.priorityHints;
  const hasSignals =
    !!valueSignals &&
    (valueSignals.continuity.length > 0 ||
      valueSignals.accountability_risks.length > 0 ||
      valueSignals.decision_impacts.length > 0 ||
      valueSignals.extra_tags.length > 0);
  const hasHints =
    !!priorityHints &&
    (priorityHints.prioritized_terms.length > 0 ||
      Object.keys(priorityHints.relationship_bias || {}).length > 0);

  const contextBlock = [
    context?.summary?.trim()
      ? `Summary context (auxiliary, do not treat as new facts):\n${context.summary.trim()}`
      : '',
    hasSignals
      ? `Value-gain signals (auxiliary prioritization hints, not standalone evidence):
- Continuity: ${valueSignals?.continuity.join(' | ') || 'none'}
- Accountability risks: ${valueSignals?.accountability_risks.join(' | ') || 'none'}
- Decision impacts: ${valueSignals?.decision_impacts.join(' | ') || 'none'}
- Extra tags: ${valueSignals?.extra_tags.map((item) => `${item.tag}:${item.confidence.toFixed(2)}`).join(' | ') || 'none'}`
      : '',
    hasHints
      ? `Deterministic extraction hints:
- Prioritized terms: ${priorityHints?.prioritized_terms.join(' | ') || 'none'}
- Relationship bias: ${
          Object.entries(priorityHints?.relationship_bias || {})
            .map(([k, v]) => `${k}:${v}`)
            .join(' | ') || 'none'
        }`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return `You are an expert at extracting graph-ready structured information from meeting transcripts for Pluto's knowledge graph.

Goal:
- Convert raw conversation into durable entities and relationships that remain useful across future meetings.
- Prefer precision and canonical naming over volume.

Analyze the following transcript and extract:

1. **People**: Names of people mentioned or participating (include any role/title if mentioned)
2. **Topics**: Main subjects discussed (rate importance as high/medium/low)
3. **Action Items**: Tasks, follow-ups, or commitments made (include who is responsible and any deadline)
4. **Decisions**: Explicit decisions or conclusions reached (include rationale if given)
5. **Projects**: Project names or work streams mentioned

6. **Relationships**: Connections between entities (e.g., "Person works on Project", "Decision impacts Topic")

Rules:
- Only include entities that are clearly mentioned or implied
- If summary/signals context is provided, use it only to prioritize what to extract from transcript text; never invent entities not grounded in the transcript
- Use canonical names:
  - People: prefer full names when available (e.g., "Sarah Chen" over "Sarah")
  - Projects/topics: keep wording consistent and specific (avoid vague labels like "the project")
- Resolve pronouns/nicknames to the canonical entity only when confidence is high; otherwise omit
- For action items, "assignee" should be a name if mentioned, otherwise omit
- For due dates, use the exact phrase from the transcript (e.g., "by Friday", "next week")
- Be conservative - only extract what's clearly present, don't infer too much
- For relationships, include only high-confidence links where both source and target are identifiable entities in the transcript
- Put a short evidence phrase in relationship "context" when available
- IMPORTANT: When extracting relationships, valid types are: 'works_on', 'impacts', 'relates_to', 'involved_in', 'produced', 'assigned_to'

Respond with valid JSON in this exact format:
{
  "people": [{"name": "string", "role": "string or omit"}],
  "topics": [{"name": "string", "importance": "high|medium|low"}],
  "action_items": [{"description": "string", "assignee": "string or omit", "due_date": "string or omit"}],
  "decisions": [{"description": "string", "rationale": "string or omit"}],
  "projects": [{"name": "string", "context": "string or omit"}],
  "relationships": [{"source": "string", "target": "string", "relationship": "string", "context": "string or omit"}]
}

${contextBlock ? `${contextBlock}\n\n` : ''}Transcript:
${transcript}`;
};

type KnowledgePromptSourceMeeting = {
  id: string;
  title: string;
  occurred_at: string | null;
  evidence: string;
};

const getScopeGuidance = (scopeType: string): string => {
  switch (scopeType) {
    case 'team_tracker':
      return `Focus on TEAM dynamics:
- Track recurring themes, blockers, and wins across standups/syncs.
- Highlight who is working on what and ownership patterns.
- Surface cross-cutting risks that affect multiple team members.
- Capture evolving team priorities and shifts in direction.`;
    case 'person_context':
      return `Focus on RELATIONSHIP context:
- Capture all meaningful topics discussed with this person across meetings.
- Track commitments, action items, and follow-ups involving them.
- Note their perspectives, concerns, and recurring themes.
- Surface useful context for preparing future 1-on-1s or check-ins.`;
    case 'project':
      return `Focus on PROJECT trajectory:
- Track decisions, milestones, and evolving requirements.
- Surface open risks, blockers, and dependency patterns.
- Capture topic evolution and how the project scope has shifted.`;
    default:
      return '';
  }
};

export const getKnowledgeDocumentPrompt = (params: {
  scopeType: string;
  scopeTitle: string;
  sourceMeetings: KnowledgePromptSourceMeeting[];
  previousStructuredJson?: string | null;
}): string => {
  const { scopeType, scopeTitle, sourceMeetings, previousStructuredJson } =
    params;

  const sourcesBlock = sourceMeetings
    .map((meeting) => {
      const occurred = meeting.occurred_at ? ` (${meeting.occurred_at})` : '';
      return `- id: ${meeting.id}${occurred}\n  title: ${meeting.title}\n  evidence: ${meeting.evidence}`;
    })
    .join('\n');

  const scopeGuidance = getScopeGuidance(scopeType);

  return `You are an expert at producing strict, citation-grounded knowledge documents for Pluto.

Non-negotiable requirements:
- Use ONLY the provided meeting evidence. Never invent facts.
- Every statement MUST include citations with meeting_id + quote.
- quote MUST be a verbatim substring of the cited meeting's evidence.
- Output MUST be valid JSON only (no markdown fences, no commentary).

You are generating a structured knowledge document for this scope:
- scope.type: ${scopeType}
- scope.title: ${scopeTitle}
${scopeGuidance ? `\n${scopeGuidance}\n` : ''}
Available meeting evidence (newest first):
${sourcesBlock || '(none)'}

${
  previousStructuredJson?.trim()
    ? `Previous structured document JSON (may be empty/invalid; use as a hint for stability when updating):\n${previousStructuredJson}`
    : 'No previous structured document is provided.'
}

Return JSON in this exact shape:
{
  "schema_version": 2,
  "scope": { "type": "global|project|person_context|team_tracker", "title": "string" },
  "current_read": {
    "headline": "string",
    "supporting_bullets": ["string"],
    "freshness": "fresh|aging|stale|unknown",
    "source_count": 0,
    "cited_item_count": 0,
    "cited_meeting_count": 0,
    "trust_message": "string",
    "evidence_quality": {"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}
  },
  "active_streams": [
    {
      "id": "string",
      "title": "string",
      "domain": "work|personal|travel|research|routine|unknown",
      "status": "string",
      "current_read": "string",
      "last_touched_at": "string|null",
      "source_count": 0,
      "open_follow_up_count": 0,
      "decision_count": 0,
      "unresolved_question_count": 0,
      "pinned": false,
      "evidence_quality": {"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}
    }
  ],
  "needs_attention": [{"id":"string","title":"string","summary":"string","kind":"decision|follow_up|risk|blocker|dependency|open_question|pattern|reference_context|stale_context|low_confidence","severity":"needs_attention|watch|steady","why_now":"string","stream_ids":["string"],"citations":[{"meeting_id":"string","quote":"string"}],"evidence_quality":{"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}}],
  "patterns": [{"id":"string","title":"string","summary":"string","kind":"pattern","severity":"needs_attention|watch|steady","why_now":"string","stream_ids":["string"],"citations":[{"meeting_id":"string","quote":"string"}],"evidence_quality":{"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}}],
  "risks_and_unknowns": [{"id":"string","title":"string","summary":"string","kind":"risk|blocker|dependency|open_question|stale_context","severity":"needs_attention|watch|steady","why_now":"string","stream_ids":["string"],"citations":[{"meeting_id":"string","quote":"string"}],"evidence_quality":{"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}}],
  "evidence_index": [{"id":"string","meeting_id":"string","meeting_title":"string","captured_at":"string|null","quote":"string","stream_ids":["string"],"item_ids":["string"],"mode":"direct|inferred","confidence":0.0}],
  "source_quality_summary": {"included_count":0,"excluded_count":0,"weak_count":0,"records":[]},
  "change_summary": {"generated_at":"string","added_count":0,"removed_count":0,"updated_count":0,"notable_changes":["string"]}
}

Quality bar:
- Extract a living second-brain brief: current read, active streams, needs attention, patterns, risks, and evidence.
- Current Read headline must synthesize across the scope. Never use a raw source summary as the headline.
- Promote patterns only when supported by repeated evidence, breadth across sources, or explicit recurring-language in the evidence.
- Classify before ranking. Split routine follow-ups from risks and blockers; do not label all unresolved work as risk.
- Include meaningful work, personal, travel, research, and routine context when evidence supports it. Do not exclude domains globally.
- Rank by importance, recency, breadth, explicitness, and citation quality.
- Optimize for durable dashboard context: project direction, repeated signals, active risks, decisions with downstream impact, and cross-meeting changes.
- Do not rewrite action items as imperatives. Describe the underlying committed context instead of saying "Commit to...", "Research...", or "Follow up...".
- Avoid making a single narrow meeting sound like the current read for the whole scope. If evidence is narrow, keep the statement specific to that meeting/topic.
- Avoid generic phrasing ("It is important..."). Be concrete.
- Keep citations tight (short quotes that clearly support the statement).
`;
};

export const getKnowledgeDocumentMergePrompt = (params: {
  scopeType: string;
  scopeTitle: string;
  chunkDocuments: Array<{ label: string; structuredJson: string }>;
  previousStructuredJson?: string | null;
}): string => {
  const { scopeType, scopeTitle, chunkDocuments, previousStructuredJson } =
    params;
  const chunksBlock = chunkDocuments
    .map(
      (chunk) =>
        `## ${chunk.label}\n${chunk.structuredJson || '{"chapters":[],"dependency_suggestions":[]}'}`,
    )
    .join('\n\n');

  return `You are an expert at producing strict, citation-grounded knowledge documents for Pluto.

Your job is to merge already-cited chunk documents into one concise knowledge document.

Non-negotiable requirements:
- Use ONLY the provided chunk documents. Never invent facts.
- Preserve citation meeting_id and quote values exactly as they appear.
- Do not introduce new meeting_id values.
- Every statement MUST include citations with meeting_id + quote.
- Output MUST be valid JSON only (no markdown fences, no commentary).

You are generating a structured knowledge document for this scope:
- scope.type: ${scopeType}
- scope.title: ${scopeTitle}

Chunk documents:
${chunksBlock || '(none)'}

${
  previousStructuredJson?.trim()
    ? `Previous structured document JSON (use as a hint for stable wording when appropriate):\n${previousStructuredJson}`
    : 'No previous structured document is provided.'
}

Return JSON in this exact shape:
{
  "schema_version": 2,
  "scope": { "type": "global|project|person_context|team_tracker", "title": "string" },
  "current_read": {"headline":"string","supporting_bullets":["string"],"freshness":"fresh|aging|stale|unknown","source_count":0,"cited_item_count":0,"cited_meeting_count":0,"trust_message":"string","evidence_quality":{"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}},
  "active_streams": [{"id":"string","title":"string","domain":"work|personal|travel|research|routine|unknown","status":"string","current_read":"string","last_touched_at":"string|null","source_count":0,"open_follow_up_count":0,"decision_count":0,"unresolved_question_count":0,"pinned":false,"evidence_quality":{"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}}],
  "needs_attention": [{"id":"string","title":"string","summary":"string","kind":"decision|follow_up|risk|blocker|dependency|open_question|pattern|reference_context|stale_context|low_confidence","severity":"needs_attention|watch|steady","why_now":"string","stream_ids":["string"],"citations":[{"meeting_id":"string","quote":"string"}],"evidence_quality":{"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}}],
  "patterns": [{"id":"string","title":"string","summary":"string","kind":"pattern","severity":"needs_attention|watch|steady","why_now":"string","stream_ids":["string"],"citations":[{"meeting_id":"string","quote":"string"}],"evidence_quality":{"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}}],
  "risks_and_unknowns": [{"id":"string","title":"string","summary":"string","kind":"risk|blocker|dependency|open_question|stale_context","severity":"needs_attention|watch|steady","why_now":"string","stream_ids":["string"],"citations":[{"meeting_id":"string","quote":"string"}],"evidence_quality":{"mode":"direct|inferred","confidence":0.0,"cited_meeting_count":0,"source_count":0,"last_reinforced_at":"string|null","freshness":"fresh|aging|stale|unknown"}}],
  "evidence_index": [{"id":"string","meeting_id":"string","meeting_title":"string","captured_at":"string|null","quote":"string","stream_ids":["string"],"item_ids":["string"],"mode":"direct|inferred","confidence":0.0}],
  "source_quality_summary": {"included_count":0,"excluded_count":0,"weak_count":0,"records":[]},
  "change_summary": {"generated_at":"string","added_count":0,"removed_count":0,"updated_count":0,"notable_changes":["string"]}
}

Quality bar:
- Combine overlapping or duplicate items across chunks, and resolve contradictions.
- Preserve item classifications, evidence_quality, stream_ids, evidence_index entries, source_quality_summary counts, and citation meeting_id + quote values exactly when possible.
- CRITICAL: You are acting as a lossless aggregator! You MUST copy over EVERY distinct active stream, needs_attention item, pattern, risk/unknown, and evidence entry from the chunks into the final JSON unless combining true duplicates.
- You may output up to 15 distinct items per array. Be exhaustive and comprehensive without repeating duplicates.
- Preserve concrete project, person, and risk names.
`;
};

export const getEntitySummaryPrompt = (params: {
  entityName: string;
  entityType: string;
  sources: Array<{ id: string; title: string; evidence: string }>;
}): string => {
  const { entityName, entityType, sources } = params;

  const sourcesBlock = sources
    .map(
      (source) =>
        `- id: ${source.id}\n  title: ${source.title}\n  evidence: ${source.evidence}`,
    )
    .join('\n');

  return `You are generating a concise, citation-grounded summary for a single entity in Pluto's knowledge graph.

Entity:
- name: ${entityName}
- type: ${entityType}

Rules:
- Use ONLY the provided evidence snippets. Never invent facts.
- Output MUST be valid JSON only.
- Write 3-8 short sentences. Each sentence should be directly supported by cited sources.

Available evidence snippets:
${sourcesBlock || '(none)'}

Return JSON in this exact shape:
{
  "sentences": [
    { "text": "string", "source_meeting_ids": ["string"] }
  ]
}
`;
};

// =============================================
// v3 Structured Analysis Prompts
// =============================================

/**
 * Single-pass structured analysis prompt for cloud providers.
 * Returns a complete AnalysisDocumentV3 as JSON.
 */
export const getStructuredAnalysisPrompt = (
  transcript: string,
  userNotes?: string,
): string => {
  const userNotesBlock = userNotes
    ? `\nUser Notes (the user took these during the meeting — incorporate relevant notes as emphasis within the matching topic's key points, setting from_user_notes to true):\n${userNotes}\n`
    : '';

  return `You are a rigorous meeting analyst for Pluto. Produce a structured JSON document that reads like well-organized meeting notes.

Analyze this transcript${userNotes ? ' and user notes' : ''} and produce a JSON object with this exact schema:

{
  "overview": "2-3 sentence summary — if you read nothing else, what was this meeting about and what happened?",
  "topics": [
    {
      "title": "Short descriptive title for this discussion topic",
      "summary": "2-4 sentence digest of what was discussed under this topic",
      "key_points": [
        { "text": "specific insight or statement", "speaker": "Name or null", "from_user_notes": false }
      ],
      "decisions": [
        { "text": "what was decided", "decided_by": "Name or null", "rationale": "why, if stated" }
      ],
      "action_items": [
        { "text": "task description", "assignee": "Name or null", "due": "natural language deadline or null" }
      ],
      "open_questions": ["unresolved thread or question"],
      "transcript_range": [startSegmentIndex, endSegmentIndex]
    }
  ],
  "all_action_items": [{"text": "task", "assignee": "Name or null", "due": "deadline or null", "topic": "parent topic title"}],
  "all_decisions": [{"text": "decision", "decided_by": "Name or null", "rationale": "why or null"}],
  "meeting_type": "one_on_one | team_sync | brainstorm | presentation | general"
}

Rules:
- Identify distinct discussion topics chronologically from the transcript.
- For each topic, extract speaker-attributed key points, decisions (with who decided), action items (with assignee and due date), and open questions.
- Map each topic to approximate transcript segment index ranges.
- Use only transcript${userNotes ? ' and user-note' : ''} details. Never invent facts, owners, decisions, or deadlines.
- Keep technical meaning exact. Do not flip problem/solution, cause/effect, shipped/planned, or agreed/questioned.
- Treat the transcript as source of truth. User notes sharpen emphasis but do not override.
- Brief rapport and personal check-ins may be included as minor context, but Do not make them major topics or lead the overview when most of the meeting is work-focused.
- If a personal topic is sustained, produces follow-up, or is the clear purpose of the meeting, represent it normally.
- If discussion is exploratory, say that. Do not convert brainstorming into decisions.
- Distinguish between explicit decisions, proposals/recommendations, and unresolved questions.
- Only mark something as a decision when the transcript shows explicit resolution language such as "decided", "agreed", "approved", "we will", "let's do that", or another clear commitment to a chosen path.
- Do not treat brainstorming, options, preferences, concerns, or tentative recommendations as decisions.
- Only include an action item when the transcript shows an explicit commitment or assignment such as "I'll", "we'll", "I will", "can you", "please", or another direct ownership signal.
- If the task is mentioned without a clear owner or timing, keep the task text but leave owner and due fields null.
- Roll up all action items and decisions into the top-level arrays.
- Classify the meeting type.

Return valid JSON only. No markdown fences, no commentary.
${userNotesBlock}
Transcript:
${transcript}`;
};

export const getStructuredAnalysisRepairPrompt = (
  transcript: string,
  invalidOutput: string,
  userNotes?: string,
): string => {
  const userNotesBlock = userNotes
    ? `\nUser Notes (context only; do not override transcript evidence):\n${userNotes}\n`
    : '';

  return `Repair this meeting analysis JSON for Pluto.

Return valid JSON only in the same schema as the original structured analysis task.

Rules:
- Preserve only facts supported by the transcript${userNotes ? ' and user notes' : ''}.
- Keep technical meaning exact.
- Brief rapport and personal check-ins may be included as minor context, but Do not make them major topics or lead the overview when most of the meeting is work-focused.
- If a personal topic is sustained, produces follow-up, or is the clear purpose of the meeting, represent it normally.
- Only mark something as a decision when the transcript shows explicit resolution language.
- Only include an action item when the transcript shows an explicit commitment or assignment.
- Keep unresolved questions out of decisions.
- Do not add commentary, markdown fences, or explanation.

Broken JSON to repair:
${invalidOutput}
${userNotesBlock}
Transcript:
${transcript}`;
};

/**
 * Topic segmentation prompt for multi-pass (Ollama) pipeline.
 * Pass 1: identify distinct discussion topics with segment ranges.
 */
export const getTopicSegmentationPrompt = (transcript: string): string => {
  return `You are a meeting topic segmenter. Read the transcript and identify distinct discussion topics in chronological order.

Return valid JSON only in this exact shape:
{
  "topics": [
    { "title": "Short descriptive title", "start_segment": 0, "end_segment": 15 }
  ]
}

Rules:
- Each topic should represent a coherent discussion thread.
- Use segment indices (0-based, line numbers in the transcript) to mark the approximate start and end.
- If the meeting has a single topic throughout, return one topic covering all segments.
- Keep titles concise and descriptive (3-8 words).
- Do not invent topics. Only identify what's clearly discussed.

Return valid JSON only. No markdown fences, no commentary.

Transcript:
${transcript}`;
};

/**
 * Per-topic analysis prompt for multi-pass (Ollama) pipeline.
 * Pass 2: analyze a single topic slice of the transcript.
 */
export const getTopicAnalysisPrompt = (
  topicTitle: string,
  transcriptSlice: string,
  userNotes?: string,
): string => {
  const userNotesBlock = userNotes
    ? `\nUser Notes (incorporate relevant notes as emphasis, setting from_user_notes to true):\n${userNotes}\n`
    : '';

  return `You are a meeting analyst. Analyze this transcript slice for the topic "${topicTitle}".

Return valid JSON only in this exact shape:
{
  "summary": "2-4 sentence digest of this topic's discussion",
  "key_points": [
    { "text": "specific insight", "speaker": "Name or null", "from_user_notes": false }
  ],
  "decisions": [
    { "text": "what was decided", "decided_by": "Name or null", "rationale": "why or null" }
  ],
  "action_items": [
    { "text": "task description", "assignee": "Name or null", "due": "deadline or null" }
  ],
  "open_questions": ["unresolved question"]
}

Rules:
- Use only the transcript text provided. Never invent facts.
- Speaker attribution: use name when clearly identifiable, null otherwise.
- Only include explicit decisions, not proposals or suggestions.
- Only include an action item when there is an explicit commitment or assignment.
- Explicit commitment examples: "I'll", "we'll", "I will", "can you", "please do", "let me take".
- If owner or due date is not directly supported by the transcript, leave that field null.
- Use explicit commitment language to distinguish real follow-through from brainstorming; do not turn suggestions, ideas, or hypothetical work into action items.
- If discussion is exploratory, reflect that in the summary.

Return valid JSON only. No markdown fences, no commentary.
${userNotesBlock}
Transcript slice:
${transcriptSlice}`;
};

export const getFollowUpDraftsPrompt = (params: {
  meetingTitle: string;
  overview?: string[];
  participants?: string[];
  actionItems: string[];
  decisions: string[];
  customPrompt?: string;
}): string => {
  const {
    meetingTitle,
    overview,
    participants,
    actionItems,
    decisions,
    customPrompt,
  } = params;
  const overviewBullets =
    overview
      ?.map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `- ${item}`)
      .join('\n') || '- None recorded';
  const participantBullets =
    participants?.length && participants.length > 0
      ? participants.map((participant) => `- ${participant}`).join('\n')
      : '- None recorded';

  return `You are an expert communications assistant. Generate three distinct follow-up drafts based on the meeting details below.

Meeting: ${meetingTitle}
Overview:
${overviewBullets}
Participants:
${participantBullets}
Decisions:
${decisions.map((d) => `- ${d}`).join('\n') || '- None recorded'}
Action Items:
${actionItems.map((a) => `- ${a}`).join('\n') || '- None recorded'}

${customPrompt ? `Additional Instruction: ${customPrompt}\n` : ''}

Generate exactly three drafts:
1. "Client Recap Email": Professional, polished, suitable for external stakeholders.
2. "Internal Summary": Action-oriented, concise, suitable for the immediate team.
3. "Slack Update": Casual but informative, using emoji and bolding where appropriate.

Rules:
- Output MUST be valid JSON only.
- Do not include placeholders like "[Your Name]" if you can avoid it, or use "The Pluto Team".
- Ensure the tone matches the specified audience for each draft.
- Use participant names only when they appear in the participant list or action/decision evidence.
- If participant context is missing, keep the draft generic rather than inventing attendees or recipients.

Return JSON in this exact shape:
{
  "drafts": [
    { "title": "Client Recap Email", "content": "string" },
    { "title": "Internal Summary", "content": "string" },
    { "title": "Slack Update", "content": "string" }
  ]
}
`;
};
