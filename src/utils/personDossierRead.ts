interface PersonReadStream {
  id: string;
  title: string;
  current_read: string;
}

export const PERSON_CONTEXT_SYNTHESIS_VERSION = 10;

export const isCurrentPersonDossier = (
  status: string | null | undefined,
  version: number | null | undefined,
): boolean =>
  status === 'up_to_date' &&
  typeof version === 'number' &&
  version >= PERSON_CONTEXT_SYNTHESIS_VERSION;

interface PersonReadEvidence {
  meeting_id: string;
  meeting_title: string;
  captured_at?: string | null;
  quote: string;
  stream_ids: string[];
}

const citationId =
  /\s*\([^)]*[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}[^)]*\)/gi;
const observedWork =
  /\b(?:working|worked|building|built|developing|developed|implementing|implemented|leading|led|managing|managed|optimizing|optimized|reviewing|reviewed|investigating|addressing|running|advising|advised|responsible for|owns|owned)\b/i;
const genericTitleWords = new Set([
  'and',
  'work',
  'strategy',
  'planning',
  'preparation',
  'coordination',
  'optimization',
  'development',
  'management',
  'support',
]);
const connectiveWords = new Set([
  'and',
  'are',
  'for',
  'from',
  'has',
  'into',
  'the',
  'their',
  'they',
  'this',
  'was',
  'were',
  'with',
]);

const topicWords = (text: string): Set<string> =>
  new Set(
    (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => {
      if (word.length > 4 && word.endsWith('ies')) {
        return `${word.slice(0, -3)}y`;
      }
      return word.length > 4 ? word.replace(/s$/u, '') : word;
    }),
  );

const recurringTopicSources = <T extends PersonReadEvidence>(
  title: string,
  sources: T[],
  minAnchorLength: number,
): T[] => {
  const anchors = [...topicWords(title)].filter(
    (word) => word.length >= minAnchorLength && !genericTitleWords.has(word),
  );
  return (
    anchors
      .map((anchor) =>
        sources.filter((source) => topicWords(source.quote).has(anchor)),
      )
      .filter(
        (matches) =>
          new Set(matches.map((source) => source.meeting_id)).size >= 2,
      )
      .sort((a, b) => b.length - a.length)[0] ?? []
  );
};

export const cleanPersonReadText = (text: string): string =>
  text
    .replace(citationId, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\.{2,}/g, '.')
    .trim();

const sourceBackedRead = (
  read: string,
  sources: PersonReadEvidence[],
): string | null => {
  const clean = cleanPersonReadText(read);
  if (!clean || clean.length > 240) return null;
  const sourceWords = new Set(
    sources.flatMap((source) => [...topicWords(source.quote)]),
  );
  const claimWords = [...topicWords(clean)].filter(
    (word) => word.length >= 3 && !connectiveWords.has(word),
  );
  return claimWords.length > 0 &&
    claimWords.every((word) => sourceWords.has(word))
    ? clean
    : null;
};

/** Only recurring, named work may describe a person's operating capacity. */
export const buildPersonDossierRead = <T extends PersonReadEvidence>(
  name: string,
  streams: PersonReadStream[],
  evidence: T[],
) => {
  const recurring = streams
    .map((stream) => {
      const directSources = evidence.filter((item) =>
        item.stream_ids.includes(stream.id),
      );
      const matchedSources = recurringTopicSources(
        stream.title,
        directSources.length >= 2 ? directSources : evidence,
        directSources.length >= 2 ? 3 : 5,
      );
      const sources = Array.from(
        new Map(matchedSources.map((item) => [item.meeting_id, item])).values(),
      ).sort(
        (a, b) =>
          (Date.parse(b.captured_at ?? '') || 0) -
          (Date.parse(a.captured_at ?? '') || 0),
      );
      return {
        id: stream.id,
        title: cleanPersonReadText(stream.title),
        read: sourceBackedRead(stream.current_read, sources),
        detail: cleanPersonReadText(
          sources.find((source) => observedWork.test(source.quote))?.quote ??
            stream.current_read,
        ),
        sources,
      };
    })
    .filter(
      (stream) =>
        stream.sources.length >= 2 &&
        stream.title &&
        stream.sources.some((source) => observedWork.test(source.quote)),
    )
    .sort((a, b) => b.sources.length - a.sources.length)
    .slice(0, 3);
  const topic = recurring[0]?.title.replace(/\b[A-Z][a-z]+\b/g, (word) =>
    word.toLocaleLowerCase(),
  );
  return {
    headline:
      recurring.length === 1 && recurring[0]?.read
        ? recurring[0].read
        : topic
          ? `${name} has worked on ${topic} across multiple conversations.`
          : null,
    workstreams: recurring,
  };
};
