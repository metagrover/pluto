interface PersonReadStream {
  id: string;
  title: string;
  current_read: string;
}

export const PERSON_CONTEXT_SYNTHESIS_VERSION = 15;

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
  /\b(?:working|worked|building|built|developing|developed|implementing|implemented|leading|led|managing|managed|optimizing|optimized|preparing|prepared|review|reviewing|reviewed|investigating|addressing|running|advising|advised|adding|added|identifying|identified|responsible for|owns|owned)\b/i;
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
  'review',
  'reviewed',
  'reviewing',
  'update',
  'updated',
  'updating',
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
const genericEvidenceWords = new Set([
  ...genericTitleWords,
  ...connectiveWords,
  'added',
  'adding',
  'client',
  'current',
  'currently',
  'data',
  'field',
  'identified',
  'identifying',
  'meeting',
  'needed',
  'other',
  'performance',
  'process',
  'project',
  'review',
  'reviewed',
  'recent',
  'share',
  'shared',
  'specific',
  'today',
  'tomorrow',
  'team',
  'worked',
  'working',
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
    (word) => word.length >= minAnchorLength && !genericEvidenceWords.has(word),
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

const recurringDirectSources = <T extends PersonReadEvidence>(
  name: string,
  sources: T[],
): { anchor: string; sources: T[] } | null => {
  const nameWords = topicWords(name);
  const anchors = new Set(
    sources
      .flatMap((source) => [...topicWords(source.quote)])
      .filter(
        (word) =>
          word.length >= 5 &&
          !nameWords.has(word) &&
          !genericEvidenceWords.has(word),
      ),
  );
  return (
    [...anchors]
      .map((anchor) => ({
        anchor,
        sources: sources.filter((source) =>
          topicWords(source.quote).has(anchor),
        ),
      }))
      .filter(
        ({ sources: matches }) =>
          new Set(matches.map((source) => source.meeting_id)).size >= 2,
      )
      .sort((a, b) => b.sources.length - a.sources.length)[0] ?? null
  );
};

const recurringActivityRead = <T extends PersonReadEvidence>(
  name: string,
  evidence: T[],
) => {
  const nameWords = topicWords(name);
  const sources = evidence;
  const anchors = sources
    .slice(0, 1)
    .flatMap((source) =>
      (source.quote.match(/\b[a-z][a-z]+\b/g) ?? [])
        .map((word) => ({ word, topic: [...topicWords(word)][0] }))
        .filter(
          ({ topic }) =>
            topic.length >= 5 &&
            !nameWords.has(topic) &&
            !genericEvidenceWords.has(topic),
        ),
    );
  for (const { word, topic } of anchors) {
    const matches = sources.filter((source) =>
      topicWords(source.quote).has(topic),
    );
    if (
      new Set(matches.map((source) => source.meeting_id)).size < 2 ||
      !matches.some((source) => observedWork.test(source.quote))
    )
      continue;
    const distinct = Array.from(
      new Map(matches.map((source) => [source.meeting_id, source])).values(),
    ).sort(
      (a, b) =>
        (Date.parse(b.captured_at ?? '') || 0) -
        (Date.parse(a.captured_at ?? '') || 0),
    );
    return {
      headline: `Recent conversations show ${name} working on ${word}.`,
      workstreams: [
        {
          id: `recent-${topic}`,
          title: word,
          read: null,
          detail: distinct[0].quote,
          sources: distinct,
        },
      ],
    };
  }
  return null;
};

export const cleanPersonReadText = (text: string): string =>
  text
    .replace(citationId, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\.{2,}/g, '.')
    .trim();

/** Only recurring, named work may describe a person's operating capacity. */
export const buildPersonDossierRead = <T extends PersonReadEvidence>(
  name: string,
  streams: PersonReadStream[],
  evidence: T[],
  recentActivity: PersonReadEvidence[] = [],
) => {
  const recurring = streams
    .map((stream) => {
      const directSources = evidence.filter((item) =>
        item.stream_ids.includes(stream.id),
      );
      const titleSources = recurringTopicSources(
        stream.title,
        directSources.length >= 2 ? directSources : evidence,
        directSources.length >= 2 ? 3 : 5,
      );
      const directTopic =
        titleSources.length === 0 && directSources.length >= 2
          ? recurringDirectSources(name, directSources)
          : null;
      const matchedSources =
        titleSources.length > 0 ? titleSources : (directTopic?.sources ?? []);
      const sources = Array.from(
        new Map(matchedSources.map((item) => [item.meeting_id, item])).values(),
      ).sort(
        (a, b) =>
          (Date.parse(b.captured_at ?? '') || 0) -
          (Date.parse(a.captured_at ?? '') || 0),
      );
      return {
        id: stream.id,
        title: directTopic
          ? `${directTopic.anchor}-related changes`
          : cleanPersonReadText(stream.title),
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
  if (recurring.length === 0) {
    const activityRead = recurringActivityRead(name, recentActivity);
    if (activityRead) return activityRead;
  }
  const topic = recurring[0]?.title.replace(/\b[A-Z][a-z]+\b/g, (word) =>
    word.toLocaleLowerCase(),
  );
  return {
    headline: topic ? `${name} has worked on ${topic}.` : null,
    workstreams: recurring,
  };
};
