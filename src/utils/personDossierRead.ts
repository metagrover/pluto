interface PersonReadStream {
  id: string;
  title: string;
  current_read: string;
}

interface PersonReadEvidence {
  meeting_id: string;
  meeting_title: string;
  quote: string;
  stream_ids: string[];
}

const citationId =
  /\s*\([^)]*[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}[^)]*\)/gi;
const observedWork =
  /\b(?:working|worked|building|built|developing|developed|implementing|implemented|leading|led|managing|managed|optimizing|optimized|reviewing|reviewed|investigating|addressing|running|advising|advised|responsible for|owns|owned)\b/i;

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
) => {
  const recurring = streams
    .map((stream) => {
      const sources = Array.from(
        new Map(
          evidence
            .filter((item) => item.stream_ids.includes(stream.id))
            .map((item) => [item.meeting_id, item]),
        ).values(),
      );
      return {
        id: stream.id,
        title: cleanPersonReadText(stream.title),
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
    headline: topic
      ? `${name} has worked on ${topic} across multiple conversations.`
      : null,
    workstreams: recurring,
  };
};
