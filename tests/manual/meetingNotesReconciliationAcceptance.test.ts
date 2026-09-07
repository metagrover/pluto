import { beforeAll, describe, expect, it } from 'vitest';
import {
  PHI_NOTES_EXPERIMENT_DIGEST,
  PHI_NOTES_EXPERIMENT_MODEL,
} from '../../electron/llm/meetingNotesTypes';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { meetingNotesEditorCases } from './fixtures/meetingNotesEditorCases';

const suite =
  process.env.RUN_MEETING_NOTES_PROVIDER_BENCHMARK === '1'
    ? describe
    : describe.skip;
const seeds = process.env.MEETING_NOTES_ACCEPTANCE_SEED
  ? [Number(process.env.MEETING_NOTES_ACCEPTANCE_SEED)]
  : [41, 42, 43];
const model = PHI_NOTES_EXPERIMENT_MODEL;
// Opt-in diagnostic profile only; production settings and the baseline stay fixed.
const thinking = process.env.MEETING_NOTES_RECONCILIATION_THINKING === '1';
const outputTokens = thinking ? 8192 : 2048;
const requestTimeoutMs = thinking ? 600_000 : 180_000;

const run = async (
  segments: Array<{ speaker: string; text: string }>,
  seed: number,
) => {
  const source = createNotesSource(JSON.stringify({ segments }));
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: model,
    ollama_seed: seed,
    ollama_structured_thinking: thinking,
  });
  const started = Date.now();
  const analysis = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
    sourceFirstReconciliation: true,
    compactWriterContract: true,
    contextTokens: 16_384,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  console.log(
    JSON.stringify({
      reconciliationAcceptance: {
        model,
        thinking,
        seed,
        latencyMs: Date.now() - started,
        pipelineVersion: analysis.generation_metadata?.pipeline_version,
      },
    }),
  );
  return analysis;
};

suite('source-only reconciliation real-provider acceptance', () => {
  beforeAll(async () => {
    const readJson = async (path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:11434/api/${path}`, {
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`benchmark_metadata_http_${response.status}`);
      return response.json();
    };
    const [version, tags, details] = await Promise.all([
      readJson('version'),
      readJson('tags'),
      readJson('show', { model }),
    ]);
    const installed = tags.models.find(
      (entry: { name: string }) => entry.name === model,
    );
    if (!installed) throw new Error('benchmark_model_not_installed');
    if (installed.digest !== PHI_NOTES_EXPERIMENT_DIGEST)
      throw new Error('benchmark_model_digest_mismatch');
    console.log(
      JSON.stringify({
        reconciliationBenchmark: {
          model,
          digest: installed.digest,
          runtime: version.version,
          details: details.details,
          inheritedParameters: details.parameters ?? null,
          request: {
            endpoint: '/api/chat',
            format: 'json',
            contextTokens: 16384,
            outputTokens,
            temperature: 0.1,
            thinking,
            timeoutMs: requestTimeoutMs,
            threads: 8,
            seeds,
          },
        },
      }),
    );
  });
  for (const fixture of meetingNotesEditorCases) {
    it.each(seeds)(
      `${fixture.id} (seed %i)`,
      async (seed) => {
        fixture.assertAnalysis(await run(fixture.segments, seed));
      },
      requestTimeoutMs + 30_000,
    );
  }

  it.each(seeds)(
    'withdrawal and qualified promise across topics (seed %i)',
    async (seed) => {
      const analysis = await run(
        [
          {
            speaker: 'Ava',
            text: 'I will send the integration checklist to Ben by Friday.',
          },
          {
            speaker: 'Ben',
            text: 'If legal approves, I can draft the announcement.',
          },
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
        ],
        seed,
      );
      expect(analysis.all_action_items).toHaveLength(1);
      expect(analysis.all_action_items[0]).toMatchObject({
        assignee: 'Dana',
        due: expect.stringMatching(/Wednesday/i),
        text: expect.stringMatching(/FAQ/i),
      });
      expect(analysis.all_action_items[0]!.text).toMatch(/after.*audit/i);
      expect(analysis.all_decisions).toHaveLength(0);
      expect(analysis.overview).toMatch(/checklist/i);
      expect(analysis.overview).toMatch(
        /withdraw|retract|take[n]? back|cancel|not.*send/i,
      );
      expect(analysis.overview).toMatch(/announcement/i);
      expect(analysis.overview).toMatch(/legal/i);
      expect(analysis.overview).toMatch(/migration/i);
      expect(analysis.overview).not.toMatch(/\bR\d+\b/);
      expect(analysis.overview).not.toMatch(
        /Ava will send the integration checklist/i,
      );
    },
    requestTimeoutMs + 30_000,
  );

  it.each(seeds)(
    'reassigned task and past work holdout (seed %i)',
    async (seed) => {
      const analysis = await run(
        [
          {
            speaker: 'Rina',
            text: 'I already uploaded the old survey results yesterday.',
          },
          {
            speaker: 'Sol',
            text: 'I can prepare a fresh summary if someone needs it.',
          },
          {
            speaker: 'Rina',
            text: 'No need for that summary. Could you instead email the raw responses to Amara on Monday?',
          },
          {
            speaker: 'Sol',
            text: 'Yes, I will email those responses to Amara on Monday, provided the consent check passes.',
          },
          {
            speaker: 'Amara',
            text: 'I am receiving them, not sending them. There is no summary assignment.',
          },
        ],
        seed,
      );
      expect(analysis.all_action_items).toHaveLength(1);
      expect(analysis.all_action_items[0]).toMatchObject({
        assignee: 'Sol',
        due: expect.stringMatching(/Monday/i),
      });
      expect(analysis.all_action_items[0]!.text).toMatch(/email|send/i);
      expect(analysis.all_action_items[0]!.text).toMatch(/responses/i);
      expect(analysis.all_action_items[0]!.text).toMatch(/Amara/i);
      expect(analysis.all_action_items[0]!.text).toMatch(
        /(?:provided|if|after|once|subject to).*consent|consent.*(?:pass|approv)/i,
      );
      expect(analysis.all_action_items[0]!.text).not.toMatch(/summary/i);
      expect(analysis.all_decisions).toHaveLength(0);
      expect(analysis.overview).toMatch(/Rina.*(?:uploaded|upload|shared)/i);
      expect(analysis.overview).toMatch(/summary/i);
    },
    requestTimeoutMs + 30_000,
  );
});
