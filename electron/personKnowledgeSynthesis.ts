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
): string => `Describe what ${name} has done in these conversations. Return only valid JSON in this compact shape:
{"topics":[{"title":"specific area of work","read":"one factual sentence about ${name}'s capacity and contribution","citations":[{"meeting_id":"exact id","quote":"exact substring from evidence"}]}]}

Rules:
- Use only the evidence below. Do not infer a formal title, ownership, or leadership.
- Every topic needs a quote that begins with ${name} or their first name. Copy quotes verbatim.
- Keep at most four topics and two citations per topic. Prefer repeated work, then recent concrete contributions.
- A topic may have one source; Pluto will distinguish one-off work from recurring work later.
- Make titles specific. The read should explain what the person did, not offer a generic label.
- Use past tense for work older than 14 days. Avoid unsourced current-status claims.
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
  const firstName = name.split(' ')[0].toLocaleLowerCase();
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
          !normalizedQuote.startsWith(`${firstName} `)
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

  return {
    ...baseline,
    active_streams: streams,
    evidence_index: evidence,
    current_read: {
      ...baseline.current_read,
      headline: '',
      supporting_bullets: [],
      source_count: new Set(evidence.map((item) => item.meeting_id)).size,
    },
  };
};
