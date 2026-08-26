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
  return `Analyze the following meeting text (which may be a raw transcript or a markdown summary) and generate a concise, descriptive meeting title (max 5-7 words).

The title should:
- Capture the main topic or purpose
- Prefer sustained work topics over brief rapport, greetings, schedule chatter, travel, health, or family check-ins unless those personal topics are the main sustained subject
- If a one-on-one covers several work topics, use the dominant work topic or a neutral one-on-one title
- Be professional and clear
- Not include quotes or special characters
- Be in title case

Only output the title and nothing else.

Text:
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
  claimCorrections?: Array<{
    originalClaim: string;
    correctedText: string;
  }>;
}): string => {
  const {
    scopeType,
    scopeTitle,
    sourceMeetings,
    previousStructuredJson,
    claimCorrections = [],
  } = params;

  const sourcesBlock = sourceMeetings
    .map((meeting) => {
      const occurred = meeting.occurred_at ? ` (${meeting.occurred_at})` : '';
      return `- id: ${meeting.id}${occurred}\n  title: ${meeting.title}\n  evidence: ${meeting.evidence}`;
    })
    .join('\n');

  const scopeGuidance = getScopeGuidance(scopeType);
  const correctionBlock = claimCorrections.length
    ? claimCorrections
        .slice(0, 12)
        .map(
          (correction, index) =>
            `${index + 1}. Do not repeat "${correction.originalClaim}"; the user corrected it to "${correction.correctedText}".`,
        )
        .join('\n')
    : '(none)';

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

User correction constraints:
${correctionBlock}
Corrections suppress contradicted claims, but are not meeting evidence and cannot be used as a citation or to create a new uncited item.

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
  claimCorrections?: Array<{
    originalClaim: string;
    correctedText: string;
  }>;
}): string => {
  const {
    scopeType,
    scopeTitle,
    chunkDocuments,
    previousStructuredJson,
    claimCorrections = [],
  } = params;
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

User correction constraints:
${
  claimCorrections.length
    ? claimCorrections
        .slice(0, 12)
        .map(
          (correction, index) =>
            `${index + 1}. Do not repeat "${correction.originalClaim}"; the user corrected it to "${correction.correctedText}".`,
        )
        .join('\n')
    : '(none)'
}
Corrections suppress contradicted claims, but are not meeting evidence and cannot be used as a citation or to create a new uncited item.

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

export const STRUCTURED_EXTRACTION_POLICY = `Classification policy:
- Settled decision: retain only when a participant explicitly agrees to, selects, approves, rejects, declares, or resolves a concrete path. An explicit rejection is itself a decision and must not be omitted; when a participant rejects one option and states what the group will keep or do, extract exactly one decision describing the accepted path using the wording of the resolving clause. Options, preferences, recommendations, predictions, and unresolved or conditional exploration are not decisions.
- Generic rejection pattern: "We rejected option A. We will keep option B." produces exactly one decision whose text reuses "We will keep option B" and whose evidence quotes the resolving clause. Do not copy this example into output.
- Committed action: retain only when a participant explicitly commits to concrete follow-through, accepts a request, receives an explicit assignment, or a mandated follow-up is clearly stated. Mentions of work, possible tasks, questions, suggestions, and hypothetical next steps are not actions.
- Proposal or recommendation: keep in the topic summary or key points, never in decisions or action items unless the transcript later records explicit agreement or commitment.
- Open question: extract ONLY questions or threads that remain genuinely UNRESOLVED at the end of the meeting. If a question was asked and then answered or settled during the discussion, DO NOT extract it as an open question.
- Discussion context: keep factual or exploratory material in summaries and key points without creating a commitment.
- Phrase user-facing fields with the lightest useful compression. Preserve distinctive transcript vocabulary and word order instead of substituting synonyms or abstract business language.
- Tentative targets, forecasts, recommendations, and possible consequences must remain explicitly tentative. Never restate them as commitments, scheduled work, policy, or certain outcomes.
- Never silently replace or expand an ambiguous internal term. Preserve the transcript wording unless repeated context or user notes confirm the correction; otherwise omit the inferred expansion.
- In the overview, topic title, and topic summary, name the distinctive system, program, or subject and state the concrete primary outcome. Do not replace a named outcome with abstractions such as "the approach", "the order", or "the plan".
- Write decision and action text as a bare verb phrase without conversational framing such as "we decided to", "the team will", or "I will". Reuse the evidence clause's distinctive nouns and verbs instead of synonym-heavy paraphrase. Keep deadlines in the due field rather than repeating them in action text.
- Remove conversational framing from key points. Keep at most 4 unique, critical key points per topic. When a key point comes from one identifiable transcript turn, set speaker to that turn's exact speaker label; use null only for a synthesis across turns or genuinely unclear attribution.
- Every retained decision and action must include a short verbatim transcript evidence slice that directly states the extracted claim, not merely a nearby agreement or rejection cue. Quote enough adjacent transcript lines to support the full claim when its subject and resolution are split across turns. If no exact evidence slice exists, omit the settled item.
- Set \`recent_win\` only for a concrete positive event supported by a short verbatim transcript evidence slice: praise or recognition received, delivered work, a launch or milestone completed, closed business such as a deal, account, contract, renewal, or sale, revenue won, or a comparably specific success. Both \`win\` and \`why_it_counts\` must be directly supported by that evidence; do not infer unstated impact. Ordinary participation, meeting counts, app usage, plans, commitments, and expected future outcomes are not wins. Use null when no supported positive event exists.
- Assignee, decider, due date, and rationale fields must be null unless the same evidence slice directly supports them.`;

export type MeetingNotesTemplate =
  | 'auto'
  | 'one_on_one'
  | 'team_sync'
  | 'customer_call'
  | 'interview'
  | 'project_kickoff';

const getTemplateGuidance = (template: MeetingNotesTemplate = 'auto') => {
  const guidance: Record<MeetingNotesTemplate, string> = {
    auto: 'Auto: infer the meeting shape and use only the sections that add signal.',
    one_on_one:
      '1:1: emphasize priorities, feedback, support needed, growth, and follow-ups.',
    team_sync:
      'Team sync: emphasize progress, blockers, decisions, owners, and next steps.',
    customer_call:
      'Customer call: emphasize customer needs, pain points, evidence, commitments, and follow-ups.',
    interview:
      'Interview: emphasize the candidate or subject evidence, examples, strengths, concerns, and follow-ups.',
    project_kickoff:
      'Project kickoff: emphasize goals, scope, milestones, owners, risks, and next steps.',
  };
  return `Notes template — ${guidance[template] || guidance.auto}`;
};

/**
 * Single-pass structured analysis prompt for cloud providers.
 * Returns a complete AnalysisDocumentV3 as JSON.
 */
export const getStructuredAnalysisPrompt = (
  transcript: string,
  userNotes?: string,
  template: MeetingNotesTemplate = 'auto',
): string => {
  const userNotesBlock = userNotes
    ? `\nUser Notes (the user took these during the meeting — incorporate relevant notes as emphasis within the matching topic's key points, setting from_user_notes to true):\n${userNotes}\n`
    : '';

  return `**Role:** You are a Chief of Staff specializing in executive meeting synthesis. Your goal is to distill raw transcripts into concise, high-signal intelligence that focuses strictly on outcomes, facts, and commitments.

CRITICAL INSTRUCTIONS:
1. ALWAYS output a \`_coverage_check\` string first listing only distinct topic labels and duplicate candidates. Do not include reasoning or transcript quotes.
2. NEVER repeat the same point multiple times. Each key point MUST be unique.
3. DO NOT quote the transcript verbatim as a key point. Synthesize the meaning.
4. A topic should have at most 4 key points. If there are fewer than 4 distinct points, just output those. Do not pad.

${STRUCTURED_EXTRACTION_POLICY}

${getTemplateGuidance(template)}

Analyze this transcript${userNotes ? ' and user notes' : ''} and produce a JSON object with this exact schema:

{
  "_coverage_check": "Distinct topic labels and duplicate candidates only; no reasoning or transcript quotes.",
  "overview": "A 3-sentence executive summary stating the meeting's purpose and primary outcome. Must be factual and objective.",
  "topics": [
    {
      "title": "Short descriptive title for this discussion topic",
      "summary": "A 1-sentence factual TLDR of the outcome. No filler.",
      "key_points": [
        { "text": "High-signal bullet point. Answer: what mattered, why it mattered, what constraint emerged. No fluff. MAX 4 UNIQUE POINTS.", "speaker": "Name or null", "from_user_notes": false }
      ],
      "decisions": [
        { "text": "what was decided", "decided_by": "Name or null", "rationale": "why, if stated or null", "evidence": "required short verbatim quote from transcript" }
      ],
      "action_items": [
        { "text": "task description", "assignee": "Name or null", "due": "natural language deadline or null", "evidence": "required short verbatim quote from transcript" }
      ],
      "open_questions": ["unresolved thread or question"],
      "transcript_range": [startSegmentIndex, endSegmentIndex]
    }
  ],
  "all_action_items": [{"text": "task", "assignee": "Name or null", "due": "deadline or null", "topic": "parent topic title", "evidence": "required short verbatim quote from transcript"}],
  "all_decisions": [{"text": "decision", "decided_by": "Name or null", "rationale": "why or null", "evidence": "required short verbatim quote from transcript"}],
  "recent_win": {"win": "concise positive outcome", "why_it_counts": "specific impact", "evidence": "required short verbatim quote from transcript"} or null,
  "meeting_type": "one_on_one | team_sync | brainstorm | presentation | general"
}

**Constraints:**
1. **Perspective Constraint:** NEVER use play-by-play language (e.g., "The team discussed", "Speaker A mentioned", "The speaker outlines"). Describe the final state of reality, system states, and outcomes directly.
   - BAD: "The speaker outlines two technical goals regarding API performance."
   - GOOD: "The primary technical goals are achieving sub-second API performance and migrating to the S3 domain."
2. **Signal Constraint:** Ignore small talk, filler, and exploratory brainstorming unless it results in a concrete constraint or decision. Treat the transcript as the source of truth. User notes sharpen emphasis but do not override facts.
   - Brief rapport and personal check-ins may be included as minor context. Do not make them major topics or lead the overview when the meeting is work-focused.
3. **Resolution Constraint:** If a task lacks an owner or date, leave those fields null. Do not hallucinate them. Extract ONLY questions or threads that remain genuinely UNRESOLVED at the end of the meeting. If a question was asked and then answered or settled during the discussion, DO NOT extract it as an open question.
4. **Document Shape:** Produce 3 to 6 coherent sections for a substantive meeting, using fewer when the meeting is narrow. Merge repeated threads, spelling variants, and later refinements into the same section. Never report how many topics were covered. Omit housekeeping such as screen sharing, greetings, tool setup, outages, and access mechanics unless it materially changed an outcome or remains a blocker.
5. **General Rules:** Organize the sections in the order that best explains the meeting, not as a chronological play-by-play. Roll up all action items and decisions into the top-level arrays. Preserve exact acronym definitions and technical terms. Omit empty sections.

**Output Format:**
Return valid JSON only. No markdown fences, no commentary.
${userNotesBlock}
Transcript:
${transcript}`;
};

export const getStructuredAnalysisRepairPrompt = (
  transcript: string,
  invalidOutput: string,
  userNotes?: string,
  template: MeetingNotesTemplate = 'auto',
): string => {
  const userNotesBlock = userNotes
    ? `\nUser Notes (context only; do not override transcript evidence):\n${userNotes}\n`
    : '';

  return `Repair this meeting analysis JSON for Pluto.

${STRUCTURED_EXTRACTION_POLICY}

${getTemplateGuidance(template)}

Return valid JSON only in the same schema as the original structured analysis task.

Rules:
- Preserve only facts supported by the transcript${userNotes ? ' and user notes' : ''}.
- Keep technical meaning exact.
- Brief rapport and personal check-ins may be included as minor context, but Do not make them major topics or lead the overview when most of the meeting is work-focused.
- If a personal topic is sustained, produces follow-up, or is the clear purpose of the meeting, represent it normally.
- Apply the classification policy exactly; repair must not upgrade proposals, questions, or discussion into settled items.
- Do not add commentary, markdown fences, or explanation.

Broken JSON to repair:
${invalidOutput}
${userNotesBlock}
Transcript:
${transcript}`;
};

/**
 * Global editorial prompt for the local multi-pass pipeline.
 * Consolidates independently analyzed transcript windows without changing the
 * canonical transcript or weakening settled-item evidence requirements.
 */
export const getStructuredAnalysisEditorialPrompt = (
  transcript: string,
  draftAnalysisJson: string,
  userNotes?: string,
  template: MeetingNotesTemplate = 'auto',
): string => {
  const userNotesBlock = userNotes
    ? `\nUser notes (high-priority emphasis, not independent evidence):\n${userNotes}\n`
    : '';

  return `You are Pluto's global meeting-notes editor.

CRITICAL INSTRUCTIONS:
1. ALWAYS output a \`_coverage_check\` string first listing only distinct topic labels and duplicate candidates. Do not include reasoning or transcript quotes.
2. NEVER repeat the same point multiple times. Each key point MUST be unique.
3. DO NOT quote the transcript verbatim as a key point. Synthesize the meaning.
4. A topic should have at most 4 key points. If there are fewer than 4 distinct points, just output those. Do not pad.

${STRUCTURED_EXTRACTION_POLICY}

${getTemplateGuidance(template)}

Revise the draft local analysis into one coherent JSON object with this exact schema:

{
  "_coverage_check": "Distinct topic labels and duplicate candidates only; no reasoning or transcript quotes.",
  "overview": "A factual 3-sentence executive summary of purpose, outcomes, commitments, risks, and unresolved blockers.",
  "topics": [
    {
      "title": "Short descriptive outcome-level title",
      "summary": "A concise factual digest of the final state and material constraints.",
      "key_points": [
        { "text": "High-signal fact or constraint. MAX 4 UNIQUE POINTS.", "speaker": "Name or null", "from_user_notes": false }
      ],
      "decisions": [
        { "text": "what was decided", "decided_by": "Name or null", "rationale": "why or null", "evidence": "required short verbatim quote from raw transcript" }
      ],
      "action_items": [
        { "text": "task", "assignee": "Name or null", "due": "deadline or null", "evidence": "required short verbatim quote from raw transcript" }
      ],
      "open_questions": ["genuinely unresolved question or thread"],
      "transcript_range": [startSegmentIndex, endSegmentIndex]
    }
  ],
  "all_action_items": [{"text": "task", "assignee": "Name or null", "due": "deadline or null", "topic": "parent topic title", "evidence": "required short verbatim quote from raw transcript"}],
  "all_decisions": [{"text": "decision", "decided_by": "Name or null", "rationale": "why or null", "evidence": "required short verbatim quote from raw transcript"}],
  "recent_win": {"win": "concise positive outcome", "why_it_counts": "specific impact", "evidence": "required short verbatim quote from raw transcript"} or null,
  "meeting_type": "one_on_one | team_sync | brainstorm | presentation | general"
}

Editorial rules:
- Merge overlapping or duplicate topics created by transcript windows into 3 to 6 coherent outcome-level sections, using fewer for narrow meetings. Do not force unrelated material together.
- Omit housekeeping such as greetings, screen sharing, tool setup, outages, and access mechanics unless it materially changed an outcome or remains a blocker. Never report how many topics were covered.
- Name topics with the transcript's distinctive subject or system plus the outcome or operation; avoid generic process labels.
- Produce a factual 3-sentence executive summary. Never enumerate every topic title.
- Re-scan the raw transcript for explicit assignments, accepted requests, deadlines, and settled decisions omitted by the draft.
- Use meeting-wide terminology consistently only when repeated transcript context strongly supports the interpretation. Treat draft spellings as hypotheses. Preserve the raw wording when ambiguous.
- Never alter quoted evidence. Evidence must remain a short verbatim slice of the raw transcript.
- Preserve uncertainty, conditions, dates, numeric targets, and speaker ambiguity.
- Rebuild the top-level action and decision arrays from the final topics.
- Return the complete JSON object only. Do not include markdown or commentary.
${userNotesBlock}
Raw transcript:
${transcript}

Draft local analysis:
${draftAnalysisJson}`;
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
- Build each title from distinctive transcript nouns plus the outcome or operation. Preserve named systems, products, programs, and technical terms; avoid generic labels such as "Discussion" or "Approach".
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
  template: MeetingNotesTemplate = 'auto',
): string => {
  const userNotesBlock = userNotes
    ? `\nUser Notes (incorporate relevant notes as emphasis, setting from_user_notes to true):\n${userNotes}\n`
    : '';

  return `**Role:** You are a Chief of Staff specializing in executive meeting synthesis. Your goal is to distill raw transcripts into concise, high-signal intelligence that focuses strictly on outcomes, facts, and commitments.
  
CRITICAL INSTRUCTIONS:
1. ALWAYS output a \`_coverage_check\` string first listing only distinct point labels and duplicate candidates. Do not include reasoning or transcript quotes.
2. NEVER repeat the same point multiple times. Each key point MUST be unique.
3. DO NOT quote the transcript verbatim as a key point. Synthesize the meaning.
4. Output at most 4 key points. If there are fewer than 4 distinct points, just output those. Do not pad.

Analyze this transcript slice for the topic "${topicTitle}".

${STRUCTURED_EXTRACTION_POLICY}

${getTemplateGuidance(template)}

Return valid JSON only in this exact shape:
{
  "_coverage_check": "Distinct point labels and duplicate candidates only; no reasoning or transcript quotes.",
  "title": "Short outcome-level topic title",
  "summary": "A 1-sentence factual TLDR of the outcome. No filler.",
  "key_points": [
    { "text": "High-signal bullet point. Answer: what mattered, why it mattered, what constraint emerged. No fluff. MAX 4 UNIQUE POINTS.", "speaker": "Name or null", "from_user_notes": false }
  ],
  "decisions": [
    { "text": "what was decided", "decided_by": "Name or null", "rationale": "why or null", "evidence": "required short verbatim quote from transcript" }
  ],
  "action_items": [
    { "text": "task description", "assignee": "Name or null", "due": "deadline or null", "evidence": "required short verbatim quote from transcript" }
  ],
  "recent_win": {"win": "concise positive outcome", "why_it_counts": "specific impact", "evidence": "required short verbatim quote from transcript"} or null,
  "open_questions": ["unresolved question"]
}

**Constraints:**
1. **Perspective Constraint:** NEVER use play-by-play language (e.g., "The team discussed", "Speaker A mentioned", "The speaker outlines"). Describe the final state of reality, system states, and outcomes directly.
   - BAD: "The speaker outlines two technical goals regarding API performance."
   - GOOD: "The primary technical goals are achieving sub-second API performance and migrating to the S3 domain."
2. **Signal Constraint:** Ignore small talk, filler, and exploratory brainstorming unless it results in a concrete constraint or decision. Treat the transcript as the source of truth. User notes sharpen emphasis but do not override facts.
3. **Resolution Constraint:** If a task lacks an owner or date, leave those fields null. Do not hallucinate them. Extract ONLY questions or threads that remain genuinely UNRESOLVED at the end of the meeting. If a question was asked and then answered or settled during the discussion, DO NOT extract it as an open question.
   - Treat explicit third-person commitments such as "Person will do task by date" as action items only when the same evidence supports the owner and timing.
   - Do not turn suggestions, ideas, possible tasks, or hypothetical work into action items.
   - Preserve dates, conditions, and qualifiers so conditional agreements remain conditional.
4. **General Rules:** Preserve exact acronym definitions and technical terms. Preserve numeric targets and success metrics.

**Output Format:**
Return valid JSON only. No markdown fences, no commentary.
${userNotesBlock}
Transcript slice:
${transcriptSlice}`;
};
