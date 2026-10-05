import { containsPersonReference } from '../src/utils/evidenceText';
import { parsePersonProfile } from '../src/utils/personProfile';
import type { KnowledgeChunkSourceMeeting } from './knowledgeChunking';
import {
  type KnowledgeV2Document,
  type KnowledgeV2EvidenceEntry,
  type KnowledgeV2Stream,
  buildDeterministicKnowledgeV2Document,
} from './knowledgeV2';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const getPersonKnowledgeChunkPrompt = (
  name: string,
  sources: KnowledgeChunkSourceMeeting[],
  corrections: Array<{ originalClaim: string; correctedText: string }> = [],
): string => `Write a comprehensive, carefully synthesized dossier about ${name} from these dated conversations. Return only valid JSON in this shape:
{"topics":[{"title":"specific area of work","read":"factual account of their contribution","citations":[{"meeting_id":"exact id","quote":"exact substring from evidence"}]}],"profile":[{"section":"overview","title":"","summary":"a coherent account of this person in the available context","citations":[{"meeting_id":"exact id","quote":"exact substring from evidence"}]}]}

Rules:
- Use only the evidence below. A quote must support the whole claim, not merely contain the same topic. Do not infer a formal title, ownership, leadership, attendance, personality, or relationship closeness.
- Profile sections: overview, responsibilities, shared_context, priorities, collaboration, evolution, next_conversation, unknowns. Omit sections without supporting evidence. Keep up to 16 profile claims; one overview of 2–4 sentences and up to three focused claims per other section. Do not repeat the same information across sections.
- Synthesize connected observations into readable prose, rather than copying excerpts or listing meeting summaries. Distinguish completed contributions, plans, requests, and unresolved questions. An intention is not completed work.
- shared_context describes explicitly evidenced collaboration and decisions involving this person. Mentioned people are not automatically collaborators. Do not invent the user's relationship to them.
- collaboration uses explicitly stated preferences or repeated observed behavior; name observed patterns as observations. Do not turn one request into a permanent trait.
- evolution explains dated changes, preserving historical decisions and naming a replacement only when stated. Do not resolve contradictions silently.
- next_conversation may suggest returning to an evidenced unresolved question. Label suggestions as suggestions; do not invent a scheduled meeting, deadline, or new commitment.
- unknowns names evidenced unresolved issues, not a checklist of missing personal information. Never infer private or sensitive attributes.
- Each profile claim needs exact person-specific citations. Every cited quote must explicitly refer to ${name} or their first name, including possessive forms; use multiple citations for claims spanning conversations.
- Every topic needs a quote that explicitly refers to ${name} or their first name. Copy quotes verbatim.
- Keep at most four topics and two citations per topic. Prefer repeated work, then recent concrete contributions. Profile claims may cite up to four sources.
- A topic may have one source; Pluto will distinguish one-off work from recurring work later.
- Make titles specific. The read should explain what the person did, not offer a generic label.
- Dates are historical observations, not proof that an old status is still current. Use past tense for older work. Say "last discussed" for unresolved historical status; absence of completion is not proof something remains undone.
- Output JSON only, without markdown or extra fields.

User corrections (do not repeat corrected claims; these are not evidence):
${
  corrections.length > 0
    ? corrections
        .slice(0, 12)
        .map(
          (correction) =>
            `- Replace "${correction.originalClaim}" with "${correction.correctedText}" only when supported by evidence.`,
        )
        .join('\n')
    : '(none)'
}

Evidence (newest first):
${sources
  .map(
    (source) =>
      `- id: ${source.id}${source.occurred_at ? ` (${source.occurred_at})` : ''}\n  title: ${source.title}\n  evidence: ${source.evidence}`,
  )
  .join('\n')}`;

export const compilePersonKnowledgeChunk = (
  name: string,
  chunkIndex: number,
  sources: KnowledgeChunkSourceMeeting[],
  response: unknown,
): KnowledgeV2Document => {
  const scope = { type: 'person_context' as const, title: name };
  const baseline = buildDeterministicKnowledgeV2Document(scope, sources);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const supportedCitation = (meetingId: string, quote: string) => {
    const normalized = quote.trim().toLocaleLowerCase();
    return (
      quote.trim().length >= 12 &&
      sourceById
        .get(meetingId)
        ?.evidence.toLocaleLowerCase()
        .includes(normalized) &&
      containsPersonReference(quote, name)
    );
  };
  const profile = parsePersonProfile(
    isRecord(response) ? response.profile : null,
  ).flatMap((claim) => {
    const citations = claim.citations.filter((citation) =>
      supportedCitation(citation.meeting_id, citation.quote),
    );
    return citations.length === claim.citations.length
      ? [{ ...claim, citations }]
      : [];
  });
  const topics =
    isRecord(response) && Array.isArray(response.topics)
      ? response.topics.slice(0, 4)
      : [];
  const streams: KnowledgeV2Stream[] = [];
  const evidence: KnowledgeV2EvidenceEntry[] = [];

  for (const [topicIndex, rawTopic] of topics.entries()) {
    if (!isRecord(rawTopic)) continue;
    const title =
      typeof rawTopic.title === 'string' ? rawTopic.title.trim() : '';
    const read = typeof rawTopic.read === 'string' ? rawTopic.read.trim() : '';
    if (!title || title.length > 100 || !Array.isArray(rawTopic.citations))
      continue;
    const streamId = `person-${chunkIndex}-${topicIndex}`;
    const citations = rawTopic.citations
      .slice(0, 2)
      .flatMap((rawCitation): KnowledgeV2EvidenceEntry[] => {
        if (!isRecord(rawCitation)) return [];
        const meetingId = rawCitation.meeting_id;
        const quote = rawCitation.quote;
        if (typeof meetingId !== 'string' || typeof quote !== 'string')
          return [];
        const source = sourceById.get(meetingId);
        const cleanQuote = quote.trim();
        const normalizedQuote = cleanQuote.toLocaleLowerCase();
        if (
          !source ||
          cleanQuote.length < 12 ||
          !source.evidence.toLocaleLowerCase().includes(normalizedQuote) ||
          !containsPersonReference(quote, name)
        )
          return [];
        return [
          {
            id: `${streamId}-${meetingId}`,
            meeting_id: meetingId,
            meeting_title: source.title,
            captured_at: source.occurred_at,
            quote: cleanQuote,
            stream_ids: [streamId],
            item_ids: [],
            mode: 'direct',
            confidence: 0.8,
          },
        ];
      });
    if (citations.length === 0) continue;
    evidence.push(...citations);
    const dates = citations
      .map((citation) => citation.captured_at)
      .filter((date): date is string => Boolean(date))
      .sort();
    const sourceCount = new Set(
      citations.map((citation) => citation.meeting_id),
    ).size;
    const lastTouchedAt = dates.at(-1) ?? null;
    streams.push({
      id: streamId,
      title,
      domain: 'work',
      status: 'active',
      current_read: read || citations[0].quote,
      last_touched_at: lastTouchedAt,
      source_count: sourceCount,
      open_follow_up_count: 0,
      decision_count: 0,
      unresolved_question_count: 0,
      pinned: false,
      evidence_quality: {
        mode: 'direct',
        confidence: 0.8,
        cited_meeting_count: sourceCount,
        source_count: sourceCount,
        last_reinforced_at: lastTouchedAt,
        freshness: 'unknown',
      },
    });
  }

  for (const [index, claim] of profile.entries()) {
    for (const citation of claim.citations) {
      const source = sourceById.get(citation.meeting_id)!;
      if (
        evidence.some(
          (entry) =>
            entry.meeting_id === source.id && entry.quote === citation.quote,
        )
      )
        continue;
      evidence.push({
        id: `profile-${chunkIndex}-${index}-${source.id}`,
        meeting_id: source.id,
        meeting_title: source.title,
        captured_at: source.occurred_at,
        quote: citation.quote,
        stream_ids: [],
        item_ids: [],
        mode: 'direct',
        confidence: 0.8,
      });
    }
  }

  return {
    ...baseline,
    person_profile: profile,
    active_streams: streams,
    evidence_index: evidence,
    current_read: {
      ...baseline.current_read,
      headline:
        profile.find((claim) => claim.section === 'overview')?.summary ?? '',
      supporting_bullets: [],
      source_count: new Set(evidence.map((item) => item.meeting_id)).size,
    },
  };
};
