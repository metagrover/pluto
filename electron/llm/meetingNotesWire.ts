import type { SourceSpan } from './meetingNotesTypes';

const spanKey = (span: SourceSpan) =>
  `${span.segment}:${span.start}:${span.end}`;

/** Request-local aliases are a lossless wire encoding, never inferred evidence.
 * All decoded references still pass the pipeline's exact span/allowed-source checks. */
export const createNotesWireRequest = (prompt: string, spans: SourceSpan[]) => {
  const byLabel = new Map(spans.map((span, index) => [`R${index}`, span]));
  const bySpan = new Map(
    spans.map((span, index) => [spanKey(span), `R${index}`]),
  );
  const encoded = prompt
    .replace(
      /BEGIN SOURCE DATA\n([\s\S]*?)\nEND SOURCE DATA/g,
      (_packet, data: string) => {
        const rows = data
          .split('\n')
          .filter(Boolean)
          .map((row) => {
            const parsed = JSON.parse(row) as {
              descriptor: SourceSpan;
              speaker: unknown;
              text: string;
            };
            return JSON.stringify({
              descriptor: bySpan.get(spanKey(parsed.descriptor)),
              segment: parsed.descriptor.segment,
              speaker: parsed.speaker,
              text: parsed.text,
            });
          });
        return `BEGIN SOURCE DATA\n${rows.join('\n')}\nEND SOURCE DATA`;
      },
    )
    .replace(
      /\{"segment":(\d+),"start":(\d+),"end":(\d+)\}/g,
      (raw, segment, start, end) => {
        const label = bySpan.get(`${segment}:${start}:${end}`);
        // The prompt's illustrative descriptor is not a factual citation.
        return label
          ? JSON.stringify(label)
          : raw === '{"segment":0,"start":0,"end":1}' && spans.length
            ? '"R0"'
            : raw;
      },
    );
  const decodeValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(decodeValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (key !== 'sources' || !Array.isArray(entry))
          return [key, decodeValue(entry)];
        return [
          key,
          entry.map((reference) => {
            if (typeof reference !== 'string') return reference;
            const span = byLabel.get(reference);
            if (!span) throw new Error('unknown_source_reference');
            return { ...span };
          }),
        ];
      }),
    );
  };
  return {
    prompt: `Source descriptors are opaque labels such as R0. Use sources:["R0"] and copy the labels from SOURCE DATA. Never write or calculate character offsets. Each label resolves to an exact original source span.\n${encoded}`,
    decode: (raw: string): string => {
      try {
        return JSON.stringify(decodeValue(JSON.parse(raw)));
      } catch {
        return raw;
      } // Preserve failed payload for the existing single repair.
    },
  };
};
