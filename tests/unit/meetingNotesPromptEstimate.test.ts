import { describe, expect, it } from 'vitest';
import {
  estimateNotesTokens,
  partitionNotesSource,
} from '../../electron/llm/meetingNotesBudget';
import { buildNotesEditorPrompt } from '../../electron/llm/meetingNotesEditor';
import {
  createNotesSourcePromptEstimator,
  serializeNotesSourceRow,
} from '../../electron/llm/meetingNotesPromptEstimate';
import {
  buildCompactNotesWriterPrompt,
  buildNotesAuditPrompt,
  buildNotesWriterPrompt,
} from '../../electron/llm/meetingNotesPrompts';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type { SourceSpan } from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';

const texts = [
  'We should ship the onboarding update next week after design review.',
  'Café “quotes” and \\ backslashes \n with a newline and émoji 🎉.',
  '東京のチームが金曜日までに確認します。',
  `${'supercalifragilistic'.repeat(4)} is one long identifier`,
  'Priya: I will own the rollout {"segment":3,"start":0,"end":4} today.',
  'x',
];

const sourceFor = (count: number) =>
  createNotesSource(
    JSON.stringify({
      segments: Array.from({ length: count }, (_, index) => ({
        speaker: index % 3 === 0 ? null : index % 3 === 1 ? `S${index}` : index,
        text: `${texts[index % texts.length]} (${index})`,
      })),
    }),
  );

const fullSpan = (
  source: ReturnType<typeof sourceFor>,
  index: number,
): SourceSpan => ({
  segment: index,
  start: 0,
  end: source.segments[index]!.text.length,
});

const exactTokens = (
  source: ReturnType<typeof sourceFor>,
  buildPrompt: (sourceText: string) => string,
  spans: SourceSpan[],
  wire: boolean,
) => {
  const prompt = buildPrompt(
    spans.map((span) => serializeNotesSourceRow(source, span)).join('\n'),
  );
  return estimateNotesTokens(
    wire ? createNotesWireRequest(prompt, spans).prompt : prompt,
  );
};

const common = (userNotes: string) => ({
  userNotes,
  knownTerms: [{ text: 'Priya', provenance: 'user' as const }],
  template: 'auto' as const,
});

const builders = (userNotes: string) => ({
  writer: {
    wire: false,
    build: (sourceText: string) =>
      `${buildNotesWriterPrompt({ sourceText, ...common(userNotes) })}\n\nRETRY`,
  },
  audit: {
    wire: false,
    build: (sourceText: string) =>
      buildNotesAuditPrompt({ sourceText, draft: {}, ...common(userNotes) }),
  },
  compactWriter: {
    wire: true,
    build: (sourceText: string) =>
      buildCompactNotesWriterPrompt({ sourceText, ...common(userNotes) }),
  },
  compactEditor: {
    wire: true,
    build: (sourceText: string) =>
      buildNotesEditorPrompt({
        sourceText,
        draft: {},
        ...common(userNotes),
        compactDraft: true,
      }),
  },
});

describe('incremental notes prompt estimate', () => {
  for (const userNotes of [
    'Focus on rollout risks.',
    // A descriptor in user text is relabelled per packet; must stay exact.
    'See {"segment":2,"start":0,"end":5} first.',
  ])
    for (const [name, { wire, build }] of Object.entries(builders(userNotes)))
      it(`matches a full prompt rebuild for ${name} (${userNotes})`, () => {
        const source = sourceFor(24);
        const estimate = createNotesSourcePromptEstimator({
          source,
          buildPrompt: build,
          ...(wire ? { wire: {} } : {}),
        });
        const candidates: SourceSpan[][] = [[]];
        for (let start = 0; start < 24; start += 5)
          for (let length = 1; start + length <= 24 && length <= 9; length++)
            candidates.push(
              Array.from({ length }, (_, offset) =>
                fullSpan(source, start + offset),
              ),
            );
        // Partial spans, as produced when one turn is split.
        candidates.push([
          { segment: 1, start: 0, end: 7 },
          { segment: 1, start: 7, end: 20 },
          fullSpan(source, 2),
        ]);
        // Repeated spans share one wire label.
        candidates.push([fullSpan(source, 3), fullSpan(source, 3)]);
        for (const spans of candidates)
          expect(estimate(spans)).toBe(exactTokens(source, build, spans, wire));
      });

  it('stays exact when the one-character first turn is cited later', () => {
    const source = createNotesSource(
      JSON.stringify({
        segments: [{ text: 'a' }, { text: 'Second turn.' }, { text: 'Third.' }],
      }),
    );
    const { build } = builders('').compactWriter;
    const estimate = createNotesSourcePromptEstimator({
      source,
      buildPrompt: build,
      wire: {},
    });
    const spans = [fullSpan(source, 1), fullSpan(source, 0)];
    expect(estimate(spans)).toBe(exactTokens(source, build, spans, true));
  });

  it('plans the same leaves as full prompt rebuilds', () => {
    const source = sourceFor(160);
    const { build } = builders('Rollout').compactWriter;
    const budget = exactTokens(source, build, [], true) + 400;
    let builds = 0;
    const estimate = createNotesSourcePromptEstimator({
      source,
      buildPrompt: (sourceText) => {
        builds++;
        return build(sourceText);
      },
      wire: {},
    });
    let estimated = 0;
    const fast = partitionNotesSource(source, (_packet, spans = []) => {
      estimated++;
      return estimate(spans) <= budget;
    });
    const slow = partitionNotesSource(
      source,
      (_packet, spans = []) =>
        exactTokens(source, build, spans, true) <= budget,
    );
    expect(fast.length).toBeGreaterThan(3);
    expect(fast).toEqual(slow);
    expect(estimated).toBeGreaterThan(160);
    // Only the envelope and its self-check build a prompt; the empty packet is exact.
    expect(builds).toBeLessThanOrEqual(5);
  });
});
