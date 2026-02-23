import type {
  ExtractionPriorityHints,
  InternalSignalDocument,
} from './provider';

export const getSummaryPrompt = (
  transcript: string,
  userNotes?: string,
): string => {
  return `You are a rigorous conversation analyst producing user-facing meeting analysis for Pluto.

Analyze this transcript${userNotes ? ' and user notes' : ''} and produce polished, natural-language output.

Non-negotiable requirements:
- Use only transcript${userNotes ? ' and user-note' : ''} details. Never invent facts.
- Keep technical meaning exact (do not flip problem/solution, attack/defense, or cause/effect).
- Do not include internal taxonomies or field labels in user text (forbidden: "Observation:", "Why it matters:", "Supporting detail:", "Evidence:", "Pluto use:").
- If content is mostly monologue/interview/video, reflect that instead of fabricating team consensus.
- Distinguish implemented choices already made from future commitments.
- Output only these four sections, in order, with markdown headings.

Write exactly:

## Summary
- 2-3 concise sentences, direct and specific.

## Key Points
- 4-6 bullets.
- Each bullet should be natural prose in one coherent statement.
- No inline meta labels.

## Action Items
- Use checkbox bullets only: - [ ] ...
- Include only explicit committed next steps.
- If none, write: - [ ] No concrete action items were explicitly committed.

## Decisions
- List explicit decisions and implemented choices.
- If none, write: - No explicit decisions were made.

${userNotes ? `\nUser Notes (high-priority context):\n${userNotes}\n` : ''}

Transcript:
${transcript}`;
};

export const getSummaryRepairPrompt = (
  transcript: string,
  invalidOutput: string,
  userNotes?: string,
): string => {
  return `Repair this draft analysis into Pluto's required structure.

Rules:
- Preserve factual meaning from draft/transcript${userNotes ? '/notes' : ''}; do not invent.
- Remove internal field labels and formatting noise.
- Keep natural prose bullets (no "Observation:" style prefixes).
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

export const getTitlePrompt = (transcript: string): string => {
  return `Analyze this conversation transcript and generate a concise, descriptive meeting title (max 5-7 words).

The title should:
- Capture the main topic or purpose
- Be professional and clear
- Not include quotes or special characters
- Be in title case

Respond with ONLY the title, nothing else.

Transcript:
${transcript.substring(0, 1000)}`;
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
