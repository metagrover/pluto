import { describe, expect, it } from 'vitest';
import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import {
  createNotesSource,
  resolveSourceSpan,
} from '../../electron/llm/meetingNotesSource';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { OLLAMA_GENERAL_MODEL } from '../../src/utils/ollamaModels';
import { meetingNotesEditorCases } from './fixtures/meetingNotesEditorCases';

const suite =
  process.env.RUN_MEETING_NOTES_PROVIDER_BENCHMARK === '1'
    ? describe
    : describe.skip;
const model = process.env.OLLAMA_BENCHMARK_MODEL || OLLAMA_GENERAL_MODEL;
const seeds = process.env.MEETING_NOTES_ACCEPTANCE_SEED
  ? [Number(process.env.MEETING_NOTES_ACCEPTANCE_SEED)]
  : [41, 42, 43];
const segments = [
  {
    speaker: 'Ava',
    text: 'I will send the integration checklist to Ben by Friday.',
  },
  { speaker: 'Ben', text: 'If legal approves, I can draft the announcement.' },
  {
    speaker: 'Casey',
    text: 'Next quarter the team may explore a migration, but that is not a current commitment.',
  },
  {
    speaker: 'Dana',
    text: 'The research discussion has no assignments or decisions today.',
  },
  {
    speaker: 'Ava',
    text: 'I take back my earlier checklist commitment. The source data is incomplete, so no one should send it Friday.',
  },
  {
    speaker: 'Dana',
    text: 'After the final audit, I will publish the reviewed FAQ to Elena by Wednesday.',
  },
];

const run = async (
  sourceSegments: typeof segments,
  seed: number,
): Promise<AnalysisDocumentV3> => {
  const source = createNotesSource(
    JSON.stringify({ segments: sourceSegments }),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: model,
    ollama_seed: seed,
    ollama_structured_thinking: false,
  });
  const transport = provider as unknown as {
    generateResumableAnalysisText: (
      request: Record<string, unknown>,
    ) => Promise<string>;
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 270_000);
  const started = Date.now();
  const stages: string[] = [];
  try {
    const result = await generateMeetingNotes({
      source,
      context: {
        userNotes: '',
        template: 'auto',
        trustedUserTerms: [],
        entityHints: [],
      },
      provider: 'ollama',
      model,
      contextTokens: 16384,
      signal: controller.signal,
      reviewProtocol: 'editor',
      generate: async (request) => {
        stages.push(request.task);
        const wire = createNotesWireRequest(
          request.prompt,
          request.sourceSpans ?? [],
        );
        const raw = await transport.generateResumableAnalysisText({
          prompt: wire.prompt,
          task: request.task,
          jsonMode: true,
          signal: request.signal,
          notesBudget: {
            contextTokens: request.contextTokens,
            outputTokens: request.outputTokens,
          },
        });
        if (process.env.CAPTURE_MEETING_NOTES_ACCEPTANCE_FAILURE === '1')
          console.log(JSON.stringify({ seed, task: request.task, raw }));
        return wire.decode(raw);
      },
    });
    for (const block of Object.values(
      result.generation_metadata?.source_provenance?.blocks ?? {},
    )) {
      for (const span of block.sources)
        expect(resolveSourceSpan(source, span).trim()).not.toBe('');
    }
    console.log(
      JSON.stringify({
        editorAcceptance: {
          seed,
          latencyMs: Date.now() - started,
          stages,
          analysis: result,
        },
      }),
    );
    return result;
  } finally {
    clearTimeout(timer);
  }
};

suite('source-based editor real-provider acceptance', () => {
  for (const fixture of meetingNotesEditorCases) {
    it.each(seeds)(
      `${fixture.id} (seed %i)`,
      async (seed) => {
        fixture.assertAnalysis(await run(fixture.segments, seed));
      },
      300_000,
    );
  }
  it.each(seeds)(
    'retains discussion and the current qualified commitment (seed %i)',
    async (seed) => {
      const result = await run(segments, seed);
      const visible = [
        result.overview,
        ...result.topics.flatMap((t) => [
          t.title,
          t.summary,
          ...t.key_points.map((p) => p.text),
          ...t.open_questions,
        ]),
      ].join(' ');
      expect(result.all_action_items).toHaveLength(1);
      expect(result.all_action_items[0]).toMatchObject({
        assignee: 'Dana',
        due: expect.stringMatching(/Wednesday/i),
        text: expect.stringMatching(/FAQ/i),
      });
      expect(result.all_action_items[0]?.text).toMatch(/after.*audit/i);
      expect(result.all_decisions).toHaveLength(0);
      expect(visible).toMatch(/checklist/i);
      expect(visible).toMatch(
        /withdraw|retract|take[n]? back|cancel|not.*send/i,
      );
      expect(visible).toMatch(/announcement/i);
      expect(visible).toMatch(/legal/i);
      expect(visible).toMatch(/migration/i);
      expect(visible).not.toMatch(/\bR\d+\b/);
      expect(visible).not.toMatch(/Ava will send the integration checklist/i);
    },
    300_000,
  );
});
