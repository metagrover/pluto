import { NOTES_EXPERIMENTS_ENABLED } from './meetingNotesExperiments';
import type { SourceSpan } from './meetingNotesTypes';

const spanKey = (span: SourceSpan) =>
  `${span.segment}:${span.start}:${span.end}`;

/** Request-local aliases are a lossless wire encoding, never inferred evidence.
 * All decoded references still pass the pipeline's exact span/allowed-source checks. */
export const createNotesWireRequest = (
  prompt: string,
  spans: SourceSpan[],
  compactSourceSpeakers = false,
  sourceParagraphs = false,
) => {
  const byLabel = new Map(spans.map((span, index) => [`R${index}`, [span]]));
  const bySpan = new Map(
    spans.map((span, index) => [spanKey(span), `R${index}`]),
  );
  const encoded = prompt
    .replace(
      /BEGIN SOURCE DATA\n([\s\S]*?)\nEND SOURCE DATA/g,
      (_packet, data: string) => {
        if (NOTES_EXPERIMENTS_ENABLED && sourceParagraphs) {
          const groups: Array<{
            turns: Array<{ speaker: unknown; text: string }>;
            spans: SourceSpan[];
            chars: number;
          }> = [];
          for (const line of data.split('\n').filter(Boolean)) {
            const row = JSON.parse(line) as {
              descriptor: SourceSpan;
              speaker: unknown;
              text: string;
            };
            const span = spans.find(
              (entry) => spanKey(entry) === spanKey(row.descriptor),
            );
            if (!span) throw new Error('unknown_source_reference');
            const last = groups.at(-1);
            if (
              last &&
              last.spans.at(-1)!.segment + 1 === span.segment &&
              last.spans.length < 12 &&
              last.chars + row.text.length <= 600
            ) {
              last.turns.push({ speaker: row.speaker, text: row.text });
              last.spans.push(span);
              last.chars += row.text.length;
            } else
              groups.push({
                turns: [{ speaker: row.speaker, text: row.text }],
                spans: [span],
                chars: row.text.length,
              });
          }
          byLabel.clear();
          const rows = groups.map((group, index) => {
            const label = `P${index}`;
            byLabel.set(label, group.spans);
            for (const span of group.spans) bySpan.set(spanKey(span), label);
            const dialogue: Array<{
              speaker: unknown;
              text: string;
              spans: SourceSpan[];
            }> = [];
            for (const [turnIndex, turn] of group.turns.entries()) {
              const prior = dialogue.at(-1);
              if (
                prior &&
                turn.speaker != null &&
                turn.speaker !== 'Them' &&
                turn.speaker !== 'Unknown' &&
                prior.speaker === turn.speaker
              ) {
                prior.text += ` ${turn.text}`;
                prior.spans.push(group.spans[turnIndex]);
              } else
                dialogue.push({ ...turn, spans: [group.spans[turnIndex]] });
            }
            return JSON.stringify([
              label,
              dialogue
                .map((turn, turnIndex) => {
                  const turnLabel = `${label}.${turnIndex}`;
                  byLabel.set(turnLabel, turn.spans);
                  return `${turnLabel} ${JSON.stringify(turn.speaker)}: ${turn.text}`;
                })
                .join('\n'),
            ]);
          });
          return `BEGIN SOURCE DATA\n${rows.join('\n')}\nEND SOURCE DATA`;
        }
        const rows = data
          .split('\n')
          .filter(Boolean)
          .map((row) => {
            const parsed = JSON.parse(row) as {
              descriptor: SourceSpan;
              speaker: unknown;
              text: string;
            };
            return JSON.stringify([
              bySpan.get(spanKey(parsed.descriptor)),
              parsed.speaker,
              parsed.text,
            ]);
          });
        if (NOTES_EXPERIMENTS_ENABLED && compactSourceSpeakers) {
          const speakers: unknown[] = [];
          const turns = rows.map((row) => {
            const [label, speaker, text] = JSON.parse(row);
            let index = speakers.indexOf(speaker);
            if (index < 0) {
              index = speakers.length;
              speakers.push(speaker);
            }
            return `${label} ${index} ${JSON.stringify(text)}`;
          });
          return `BEGIN SOURCE DATA\n${JSON.stringify({ speakers })}\n${turns.join('\n')}\nEND SOURCE DATA`;
        }
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
            ? NOTES_EXPERIMENTS_ENABLED && sourceParagraphs
              ? '"P0"'
              : '"R0"'
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
          entry.flatMap((reference) => {
            if (typeof reference !== 'string') return [reference];
            const references = byLabel.get(reference);
            if (!references) throw new Error('unknown_source_reference');
            return references.map((span) => ({ ...span }));
          }),
        ];
      }),
    );
  };
  return {
    sourceLabels: [...byLabel.keys()],
    prompt: `Return one-line minified JSON: no indentation, formatting newlines, or whitespace outside string values. Preserve spaces within text. ${NOTES_EXPERIMENTS_ENABLED && sourceParagraphs ? 'SOURCE DATA rows are [blockLabel, chronological dialogue]. Each dialogue line begins with its precise turn label, such as P0.0, followed by its exact speaker and words. Unknown speakers retain separate turn lines. Cite precise turn labels for actions and decisions, selecting the actual accepting or deciding turn and only necessary supporting context. Block labels such as P0 organize the dialogue; copy precise turn labels into all sources arrays.' : NOTES_EXPERIMENTS_ENABLED && compactSourceSpeakers ? 'SOURCE DATA starts with a speakers dictionary. Subsequent lines are descriptor speakerIndex JSON-quoted-text (for example R0 0 "Exact words"). speakerIndex selects the exact name or null from speakers. Each row is a separate original source turn; preserve order and boundaries. Use the actual speaker name for owners, never its index.' : 'SOURCE DATA rows are JSON arrays [descriptor, speaker, text].'} Source descriptors are opaque labels such as ${NOTES_EXPERIMENTS_ENABLED && sourceParagraphs ? 'P0.0' : 'R0'}. Use sources:["${NOTES_EXPERIMENTS_ENABLED && sourceParagraphs ? 'P0.0' : 'R0'}"] and copy the labels from SOURCE DATA. Never write or calculate character offsets. Each label resolves to ${NOTES_EXPERIMENTS_ENABLED && sourceParagraphs ? 'the exact original fragments in that speaker turn' : 'an exact original source span'}.\n${encoded}`,
    decode: (raw: string): string => {
      try {
        return JSON.stringify(decodeValue(JSON.parse(raw)));
      } catch {
        return raw;
      } // Preserve failed payload for the existing single repair.
    },
  };
};
