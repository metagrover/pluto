import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';
import {
  createNotesSource,
  resolveSourceSpan,
} from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { buildAnalysisTranscriptFromJson } from '../../src/utils/transcript';

const enabled = process.env.RUN_MEETING_NOTES_PROVIDER_BENCHMARK === '1';
const suite = enabled ? describe : describe.skip;
const model = process.env.OLLAMA_BENCHMARK_MODEL?.trim() || 'qwen3.5:9b';
const captureFailure =
  process.env.CAPTURE_MEETING_NOTES_ACCEPTANCE_FAILURE === '1';
const seeds = process.env.MEETING_NOTES_ACCEPTANCE_SEED
  ? [Number(process.env.MEETING_NOTES_ACCEPTANCE_SEED)]
  : [41, 42, 43];

const syntheticSegments = [
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

const transcript = JSON.stringify({ segments: syntheticSegments });
const source = createNotesSource(transcript);
const sourceText = buildAnalysisTranscriptFromJson(transcript);

const evidenceIsGrounded = (evidence?: string): boolean =>
  Boolean(evidence?.trim() && sourceText.includes(evidence.trim()));

const responseDiagnostics = (raw: string) => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const listLength = (key: string) =>
      Array.isArray(parsed[key]) ? parsed[key].length : null;
    const targets = (key: string) =>
      Array.isArray(parsed[key])
        ? parsed[key].map((entry) =>
            entry && typeof entry === 'object' && 'target' in entry
              ? (entry as { target?: unknown }).target
              : null,
          )
        : null;
    return {
      bytes: Buffer.byteLength(raw),
      keys: Object.keys(parsed).sort(),
      changes: listLength('changes'),
      verdicts: listLength('verdicts'),
      dispositions: listLength('dispositions'),
      terminology: listLength('terminology'),
      changeTargets: targets('changes'),
      verdictTargets: targets('verdicts'),
      dispositionTargets: targets('dispositions'),
    };
  } catch {
    return { bytes: Buffer.byteLength(raw), json: 'invalid' as const };
  }
};

suite('v10 synthetic local-provider acceptance', () => {
  it.skipIf(process.env.RUN_MEETING_NOTES_LARGE_ACCEPTANCE !== '1')(
    'preserves a middle commitment and a late reversal across a real hierarchy',
    async () => {
      const background =
        'We compared several options and described their tradeoffs. This discussion does not assign work or settle a decision. ';
      const segments = Array.from({ length: 18 }, (_, index) => ({
        speaker: 'Casey',
        text: `Discussion ${index + 1}. ${background.repeat(24)}`,
      }));
      segments.splice(2, 0, syntheticSegments[0]!);
      segments.splice(10, 0, syntheticSegments[5]!);
      segments.push(syntheticSegments[4]!);
      const largeSource = createNotesSource(JSON.stringify({ segments }));
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: model,
        ollama_seed: 41,
        ollama_structured_thinking: false,
      });
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error('large_acceptance_deadline')),
        29 * 60_000,
      );
      const started = performance.now();
      try {
        const result = await provider.generateStructuredAnalysis(
          '',
          '',
          'auto',
          {
            source: largeSource,
            contextTokens: 16384,
            signal: controller.signal,
          },
        );
        console.log(
          JSON.stringify({
            acceptance: 'meeting-notes-v10-large',
            latencyMs: Math.round(performance.now() - started),
            sourceSegments: segments.length,
            mode: result.generation_metadata?.mode,
            hierarchy: result.generation_metadata?.hierarchy,
          }),
        );
        expect(result.generation_metadata?.mode).toBe('hierarchical');
        expect(result.all_action_items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringMatching(/reviewed FAQ/i),
              assignee: 'Dana',
              due: expect.stringMatching(/Wednesday/i),
            }),
          ]),
        );
        expect(
          result.all_action_items.map((item) => item.text).join(' '),
        ).not.toMatch(/integration checklist/i);
        expect(
          result.all_action_items.find((item) =>
            /reviewed FAQ/i.test(item.text),
          )?.text,
        ).toMatch(/after.*audit/i);
        const sources = Object.values(
          result.generation_metadata?.source_provenance?.blocks ?? {},
        ).flatMap((block) => block.sources);
        expect(sources.some((span) => span.segment === 10)).toBe(true);
        for (const span of sources)
          expect(resolveSourceSpan(largeSource, span).trim()).not.toBe('');
      } finally {
        clearTimeout(timer);
      }
    },
    30 * 60_000,
  );

  it.each(seeds)(
    'keeps commitments grounded and respects qualifiers (seed %i)',
    async (seed) => {
      const provider = new UnifiedLLMProvider('ollama', {
        ollama_model: model,
        ollama_seed: seed,
        ollama_structured_thinking: false,
      });
      const instrumentedProvider = provider as unknown as {
        generateText: (...args: unknown[]) => Promise<string>;
      };
      const generateText = instrumentedProvider.generateText.bind(provider);
      const responses: Array<{ task: unknown; raw: string }> = [];
      let directCallCount = 0;
      instrumentedProvider.generateText = async (...args) => {
        directCallCount += 1;
        const raw = await generateText(...args);
        responses.push({
          task:
            args[0] && typeof args[0] === 'object' && 'task' in args[0]
              ? (args[0] as { task?: unknown }).task
              : null,
          raw,
        });
        if (captureFailure)
          console.log(JSON.stringify({ seed, response: responses.at(-1) }));
        return raw;
      };
      const startedAt = performance.now();
      const controller = new AbortController();
      // Abort before Vitest's watchdog so the next seed never inherits a live request.
      const timeout = setTimeout(
        () => controller.abort(new Error('acceptance_deadline')),
        270_000,
      );
      let analysis: AnalysisDocumentV3;
      try {
        analysis = await provider.generateStructuredAnalysis(
          sourceText,
          '',
          'auto',
          {
            source,
            trustedUserTerms: [],
            entityHints: [],
            contextTokens: 16_384,
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (captureFailure) {
          console.log(
            JSON.stringify({
              acceptanceFailure: 'meeting-notes-v10',
              seed,
              model,
              directCallCount,
              error: error instanceof Error ? error.message : String(error),
              responses: responses.map(({ task, raw }) => ({
                task,
                diagnostics: responseDiagnostics(raw),
                raw,
              })),
            }),
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      const latencyMs = performance.now() - startedAt;
      if (captureFailure)
        console.log(JSON.stringify({ seed, responses, analysis }));
      const actions = analysis.all_action_items;
      const decisions = analysis.all_decisions;
      const visibleNotes = [
        analysis.overview,
        ...analysis.topics.flatMap((topic) => [
          topic.title,
          topic.summary,
          ...topic.key_points.map((point) => point.text),
        ]),
      ].join(' ');
      const settledText = [...actions, ...decisions]
        .map((item) => item.text.toLowerCase())
        .join('\n');

      console.log(
        JSON.stringify({
          acceptance: 'meeting-notes-v10',
          seed,
          model,
          latencyMs: Math.round(latencyMs),
          directCallCount,
          actionCount: actions.length,
          decisionCount: decisions.length,
          pipeline: analysis.generation_metadata?.pipeline_version ?? null,
          auditStatus: analysis.generation_metadata?.audit_status ?? null,
          retryCount: analysis.quality.retry_count,
        }),
      );

      expect(analysis.generation_metadata?.pipeline_version).toBe(
        'writer-audit-v1',
      );
      expect(analysis.generation_metadata?.audit_status).toBe('complete');
      expect(analysis.quality.retry_count).toBe(0);
      expect(directCallCount).toBe(2);
      expect(actions).toHaveLength(1);
      expect(actions[0]?.text).toMatch(/after.*audit/i);
      expect(visibleNotes).toMatch(/checklist/i);
      expect(visibleNotes).toMatch(/announcement/i);
      expect(actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringMatching(/reviewed FAQ/i),
            assignee: expect.stringMatching(/Dana/i),
            due: expect.stringMatching(/Wednesday/i),
          }),
        ]),
      );
      expect(settledText).not.toMatch(
        /integration checklist|announcement|migration/,
      );
      expect(
        [...actions, ...decisions].every((item) =>
          evidenceIsGrounded(item.evidence),
        ),
      ).toBe(true);

      const blocks = analysis.generation_metadata?.source_provenance?.blocks;
      expect(blocks).toBeTruthy();
      for (const block of Object.values(blocks ?? {})) {
        for (const span of block.sources) {
          expect(resolveSourceSpan(source, span).trim()).not.toBe('');
        }
      }
    },
    300_000,
  );
});
