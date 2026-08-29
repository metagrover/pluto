import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { resolveTranscriptEvidence } from '../../electron/llm/analysisGrounding';
import {
  STRUCTURED_ANALYSIS_PROMPT_VERSION,
  UnifiedLLMProvider,
} from '../../electron/llm/unifiedProvider';
import { scoreMeetingNotesQuality } from '../../scripts/lib/meeting_notes_quality.js';
import { OLLAMA_GENERAL_MODEL } from '../../src/utils/ollamaModels';

const COMPARISON_BASELINE_PROMPT_VERSION = 'notes-v6';

type Fixture = {
  case_id?: string;
  transcript: string[];
  expected?: Record<string, unknown>;
  expected_counts?: {
    actions: number;
    decisions: number;
    due_fields?: number;
  };
};

type ProviderBaseline = {
  schema_version: number;
  provider: string;
  model: string;
  prompt_version: string;
  seed: number;
  fixture_order_sha256: string;
  reviewed_scores: number[];
};

const enabled = process.env.RUN_MEETING_NOTES_PROVIDER_BENCHMARK === '1';
const suite = enabled ? describe : describe.skip;

const readJson = <T>(filePath: string): T =>
  JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;

const loadFixtures = (): Fixture[] => {
  const root = path.resolve('scripts/baselines/meeting-notes-quality');
  const reviewed = fs
    .readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      ...readJson<Fixture>(path.join(root, name)),
      case_id: path.basename(name, '.json'),
    }));
  const precision = readJson<Fixture[]>(
    path.join(root, 'precision', 'cases.json'),
  );
  return [...reviewed, ...precision];
};

const reviewedFixtureOrderSha256 = (): string =>
  createHash('sha256')
    .update(
      fs
        .readdirSync(path.resolve('scripts/baselines/meeting-notes-quality'))
        .filter((name) => name.endsWith('.json'))
        .sort()
        .join('\n'),
    )
    .digest('hex');

const loadProviderBaseline = (): ProviderBaseline =>
  readJson<ProviderBaseline>(
    path.resolve(
      'scripts/baselines/meeting-notes-quality/provider-baselines/phi4-mini-notes-v6.json',
    ),
  );

suite('real-provider meeting notes quality benchmark', () => {
  it(
    'runs production prompts and grounding with content-free reporting',
    async () => {
      const model =
        process.env.OLLAMA_BENCHMARK_MODEL?.trim() || OLLAMA_GENERAL_MODEL;
      const repeats = Math.max(
        1,
        Number.parseInt(process.env.OLLAMA_BENCHMARK_REPEATS || '3', 10) || 3,
      );
      const seedStart =
        Number.parseInt(process.env.OLLAMA_BENCHMARK_SEED_START || '42', 10) ||
        42;
      const structuredThinking =
        process.env.OLLAMA_BENCHMARK_STRUCTURED_THINKING === '1';
      const fixtureScope =
        process.env.OLLAMA_BENCHMARK_SUITE === 'precision'
          ? 'precision'
          : process.env.OLLAMA_BENCHMARK_SUITE === 'reviewed'
            ? 'reviewed'
            : 'full';
      const selectedCase = process.env.OLLAMA_BENCHMARK_CASE?.trim();
      const fixtures = loadFixtures().filter(
        (fixture) =>
          (fixtureScope === 'full' ||
            (fixtureScope === 'precision'
              ? fixture.expected_counts
              : fixture.expected)) &&
          (!selectedCase || fixture.case_id === selectedCase),
      );
      if (fixtures.length === 0) {
        throw new Error('No benchmark fixtures matched the selected scope');
      }
      const providerBaseline = loadProviderBaseline();
      const reviewedFixtureCount = loadFixtures().filter(
        (fixture) => fixture.expected,
      ).length;
      if (
        providerBaseline.prompt_version !==
          COMPARISON_BASELINE_PROMPT_VERSION ||
        providerBaseline.fixture_order_sha256 !==
          reviewedFixtureOrderSha256() ||
        providerBaseline.reviewed_scores.length !== reviewedFixtureCount
      ) {
        throw new Error(
          'Provider baseline does not match the fixture contract',
        );
      }
      const runs: Array<{
        fixtureIndex: number;
        fixture: Fixture;
        analysis: Awaited<
          ReturnType<UnifiedLLMProvider['generateStructuredAnalysis']>
        >;
        latencyMs: number;
        score: ReturnType<typeof scoreMeetingNotesQuality> | null;
      }> = [];

      for (let repeat = 0; repeat < repeats; repeat += 1) {
        const provider = new UnifiedLLMProvider('ollama', {
          ollama_model: model,
          ollama_structured_thinking: structuredThinking,
          ollama_seed: seedStart + repeat,
        });
        for (const [fixtureIndex, fixture] of fixtures.entries()) {
          const startedAt = performance.now();
          const analysis = await provider.generateStructuredAnalysis(
            fixture.transcript.join('\n'),
          );
          runs.push({
            fixtureIndex,
            fixture,
            analysis,
            latencyMs: performance.now() - startedAt,
            score: fixture.expected
              ? scoreMeetingNotesQuality({
                  ...fixture,
                  generated_analysis: analysis,
                })
              : null,
          });
        }
      }

      let residentModelBytes: number | null = null;
      try {
        const response = await fetch('http://127.0.0.1:11434/api/ps');
        const payload = (await response.json()) as {
          models?: Array<{ name?: string; size?: number; size_vram?: number }>;
        };
        const resident = payload.models?.find((item) => item.name === model);
        residentModelBytes = Number(resident?.size_vram ?? resident?.size ?? 0);
      } catch {
        residentModelBytes = null;
      }

      const settledItems = runs.flatMap(({ analysis }) => [
        ...analysis.all_action_items,
        ...analysis.all_decisions,
      ]);
      const evidenceSupported = runs.reduce(
        (count, { fixture, analysis }) =>
          count +
          [...analysis.all_action_items, ...analysis.all_decisions].filter(
            (item) =>
              Boolean(
                resolveTranscriptEvidence(
                  item.evidence,
                  fixture.transcript.join('\n'),
                ),
              ),
          ).length,
        0,
      );
      const precisionRuns = runs.filter(({ fixture }) =>
        Boolean(fixture.expected_counts),
      );
      const precisionPassed = precisionRuns.filter(({ fixture, analysis }) => {
        const expected = fixture.expected_counts;
        if (!expected) return false;
        const dueFields = analysis.all_action_items.filter(
          (item) => item.due,
        ).length;
        return (
          analysis.all_action_items.length === expected.actions &&
          analysis.all_decisions.length === expected.decisions &&
          (expected.due_fields === undefined ||
            dueFields === expected.due_fields)
        );
      }).length;
      const falsePositiveCount = precisionRuns.reduce(
        (count, { fixture, analysis }) => {
          const expected = fixture.expected_counts;
          if (!expected) return count;
          const dueFields = analysis.all_action_items.filter(
            (item) => item.due,
          ).length;
          return (
            count +
            Math.max(0, analysis.all_action_items.length - expected.actions) +
            Math.max(0, analysis.all_decisions.length - expected.decisions) +
            Math.max(0, dueFields - (expected.due_fields ?? dueFields))
          );
        },
        0,
      );
      const falseNegativeCount = precisionRuns.reduce(
        (count, { fixture, analysis }) => {
          const expected = fixture.expected_counts;
          if (!expected) return count;
          return (
            count +
            Math.max(0, expected.actions - analysis.all_action_items.length) +
            Math.max(0, expected.decisions - analysis.all_decisions.length)
          );
        },
        0,
      );
      const precisionFailureCases = precisionRuns
        .filter(({ fixture, analysis }) => {
          const expected = fixture.expected_counts;
          if (!expected) return false;
          const dueFields = analysis.all_action_items.filter(
            (item) => item.due,
          ).length;
          return (
            analysis.all_action_items.length !== expected.actions ||
            analysis.all_decisions.length !== expected.decisions ||
            (expected.due_fields !== undefined &&
              dueFields !== expected.due_fields)
          );
        })
        .map(({ fixture }) => fixture.case_id ?? 'unlabeled_synthetic_case');
      const precisionFailureCategories = Object.fromEntries(
        precisionRuns
          .filter(({ fixture }) =>
            precisionFailureCases.includes(
              fixture.case_id ?? 'unlabeled_synthetic_case',
            ),
          )
          .map(({ fixture, analysis }) => [
            fixture.case_id ?? 'unlabeled_synthetic_case',
            analysis.generation_metadata?.error_categories ?? [],
          ]),
      );
      const reviewedScores = runs
        .map(({ score }) => score)
        .filter((score): score is NonNullable<typeof score> => score !== null);
      const reviewedScoreBySeed = Array.from({ length: repeats }, (_, repeat) =>
        reviewedScores
          .slice(
            repeat * reviewedFixtureCount,
            (repeat + 1) * reviewedFixtureCount,
          )
          .reduce((sum, score) => sum + score.total_score, 0),
      );
      const totalScore = reviewedScores.reduce(
        (sum, score) => sum + score.total_score,
        0,
      );
      const maxScore = reviewedScores.reduce(
        (sum, score) => sum + score.max_score,
        0,
      );
      const reviewedFixtureRegressions = runs.filter(
        ({ fixtureIndex, score }) =>
          score !== null &&
          score.total_score <
            (providerBaseline.reviewed_scores[fixtureIndex] ?? 0),
      ).length;
      const reviewedFailureCounts = reviewedScores.reduce<
        Record<string, number>
      >((counts, score) => {
        for (const tag of score.failure_tags) {
          counts[tag] = (counts[tag] ?? 0) + 1;
        }
        return counts;
      }, {});
      const report = {
        schema_version: 1,
        provider: 'ollama',
        model,
        prompt_version: STRUCTURED_ANALYSIS_PROMPT_VERSION,
        fixture_revision: 'meeting-notes-quality-v4',
        comparison_baseline: {
          provider: providerBaseline.provider,
          model: providerBaseline.model,
          prompt_version: providerBaseline.prompt_version,
          seed: providerBaseline.seed,
        },
        fixture_scope: fixtureScope,
        repeats,
        generation: {
          structured_thinking: structuredThinking,
          seed_start: seedStart,
          notes_temperature: 0.1,
        },
        cases: fixtures.length,
        runs: runs.length,
        format_failures: runs.filter(({ analysis }) =>
          Boolean(
            analysis.quality.fallback_used || !analysis.quality.format_pass,
          ),
        ).length,
        false_positive_count: falsePositiveCount,
        false_negative_count: falseNegativeCount,
        precision_failure_cases: precisionFailureCases,
        precision_failure_categories: precisionFailureCategories,
        settled_items: settledItems.length,
        exact_evidence_support: evidenceSupported,
        precision_cases_passed: precisionPassed,
        precision_cases_total: precisionRuns.length,
        reviewed_score: totalScore,
        reviewed_max_score: maxScore,
        reviewed_score_by_seed: reviewedScoreBySeed,
        reviewed_scores: reviewedScores.map((score) => score.total_score),
        reviewed_fixture_regressions: reviewedFixtureRegressions,
        reviewed_failure_counts: reviewedFailureCounts,
        reviewed_failures_by_case: Object.fromEntries(
          runs
            .filter(
              (
                run,
              ): run is typeof run & { score: NonNullable<typeof run.score> } =>
                run.score !== null,
            )
            .map((run) => [
              run.fixture.case_id ?? `reviewed_fixture_${run.fixtureIndex + 1}`,
              run.score.failure_tags,
            ]),
        ),
        token_budget: {
          context_min: 16384,
          context_max: 16384,
          output: 2048,
          audit_output: 1536,
        },
        latency_ms: {
          total: Math.round(runs.reduce((sum, run) => sum + run.latencyMs, 0)),
          average: Math.round(
            runs.reduce((sum, run) => sum + run.latencyMs, 0) /
              Math.max(1, runs.length),
          ),
        },
        process_rss_bytes: process.memoryUsage().rss,
        resident_model_bytes: residentModelBytes,
      };
      process.stdout.write(
        `MEETING_NOTES_BENCHMARK ${JSON.stringify(report)}\n`,
      );

      expect(report.format_failures).toBe(0);
      expect(report.false_positive_count).toBe(0);
      expect(report.exact_evidence_support).toBe(report.settled_items);
      expect(report.precision_cases_passed).toBe(report.precision_cases_total);
      if (fixtureScope === 'full') {
        expect(
          report.reviewed_score_by_seed.every((score) => score >= 40),
        ).toBe(true);
        expect(report.reviewed_max_score).toBe(48 * repeats);
        expect(report.reviewed_fixture_regressions).toBe(0);
        expect(report.latency_ms.average).toBeLessThanOrEqual(30_000);
        expect(report.resident_model_bytes).not.toBeNull();
        expect(
          report.resident_model_bytes ?? Number.POSITIVE_INFINITY,
        ).toBeLessThanOrEqual(6.5 * 1024 * 1024 * 1024);
      }
    },
    30 * 60 * 1_000,
  );
});
