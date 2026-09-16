import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { subscribeInferenceActivity } from '../../electron/llm/inferenceActivity';
import type { ProviderType } from '../../electron/llm/provider';
import {
  STRUCTURED_ANALYSIS_PROMPT_VERSION,
  UnifiedLLMProvider,
} from '../../electron/llm/unifiedProvider';
import { OLLAMA_GENERAL_MODEL } from '../../src/utils/ollamaModels';

type Fixture = {
  transcript: string[];
  expected: {
    facts: string[];
    commitments: Array<{ owner: string; action: string; due: string }>;
    speakerContext: string[];
    qa: Array<{ question: string; answer: string }>;
    suggestedQuestions: string[];
  };
};

const enabled = process.env.RUN_PROVIDER_COMPARISON_BENCHMARK === '1';
const suite = enabled ? describe : describe.skip;
const root = path.resolve('benchmarks/provider-comparison');

const resolveProvider = (): {
  provider: ProviderType;
  requestedModel: string;
  instance: UnifiedLLMProvider;
} => {
  const provider = (process.env.PLUTO_BENCHMARK_PROVIDER ??
    'ollama') as ProviderType;
  if (!['ollama', 'openai', 'openrouter'].includes(provider)) {
    throw new Error(
      'PLUTO_BENCHMARK_PROVIDER must be ollama, openai, or openrouter',
    );
  }
  const requestedModel =
    provider === 'ollama'
      ? process.env.OLLAMA_BENCHMARK_MODEL?.trim() || OLLAMA_GENERAL_MODEL
      : provider === 'openai'
        ? process.env.OPENAI_BENCHMARK_MODEL?.trim() || 'gpt-4o-mini'
        : process.env.OPENROUTER_BENCHMARK_MODEL?.trim() || '';
  if (!requestedModel)
    throw new Error('OpenRouter requires OPENROUTER_BENCHMARK_MODEL');
  const settings =
    provider === 'ollama'
      ? { ollama_model: requestedModel }
      : provider === 'openai'
        ? {
            openai_api_key: process.env.OPENAI_API_KEY,
            openai_model: requestedModel,
          }
        : {
            openrouter_api_key: process.env.OPENROUTER_API_KEY,
            openrouter_model: requestedModel,
          };
  return {
    provider,
    requestedModel,
    instance: new UnifiedLLMProvider(provider, settings),
  };
};

suite('provider-neutral production-pipeline comparison', () => {
  it(
    'runs the immutable fixture through notes, extraction, Q&A, and suggestions',
    async () => {
      const manifestBytes = fs.readFileSync(path.join(root, 'manifest.json'));
      const manifest = JSON.parse(manifestBytes.toString()) as {
        fixtureRevision: string;
        fixtures: Array<{ path: string; sha256: string }>;
      };
      const selected = manifest.fixtures[0];
      const fixtureBytes = fs.readFileSync(path.join(root, selected.path));
      expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe(
        selected.sha256,
      );
      const fixture = JSON.parse(fixtureBytes.toString()) as Fixture;
      const transcript = fixture.transcript.join('\n');
      const { provider, requestedModel, instance } = resolveProvider();
      const starts = new Map<string, number>();
      let modelLatencyMs = 0;
      const unsubscribe = subscribeInferenceActivity((activity) => {
        if (activity.state === 'started')
          starts.set(activity.requestId, activity.at);
        else {
          const start = starts.get(activity.requestId);
          if (start !== undefined) modelLatencyMs += activity.at - start;
        }
      });
      const startedAt = performance.now();
      const notes = await instance.generateStructuredAnalysis(transcript);
      const entities = await instance.extractEntities(transcript);
      const qa = await instance.answerAskPluto(
        `Using only this transcript, answer: ${fixture.expected.qa[0].question}\n\n${transcript}`,
        { mode: 'deep' },
      );
      const suggestions = await instance.answerAskPluto(
        `Using only this transcript, propose one concise follow-up question.\n\n${transcript}`,
        { mode: 'fast' },
      );
      unsubscribe();
      const endToEndLatencyMs = performance.now() - startedAt;
      const serialized = JSON.stringify(notes).toLowerCase();
      const expectedFactsFound = fixture.expected.facts.filter((fact) =>
        fact
          .toLowerCase()
          .split(/\W+/)
          .filter((word) => word.length > 3)
          .every((word) => serialized.includes(word)),
      ).length;
      const commitmentsFound = fixture.expected.commitments.filter(
        ({ owner, action }) =>
          serialized.includes(owner.toLowerCase()) &&
          action
            .toLowerCase()
            .split(/\W+/)
            .filter((word) => word.length > 4)
            .every((word) => serialized.includes(word)),
      ).length;
      const usage = instance.getUsageSnapshot();
      let apiCostUsd = provider === 'ollama' ? 0 : usage.costUsd;
      if (provider === 'openai') {
        const priceManifest = JSON.parse(
          fs.readFileSync(
            path.join(root, 'openai-prices-2026-09-16.json'),
            'utf8',
          ),
        ) as { models: Record<string, { input: number; output: number }> };
        const price = priceManifest.models[requestedModel];
        if (!price) {
          throw new Error(
            `Add a reviewed dated OpenAI price for ${requestedModel} before benchmarking`,
          );
        }
        apiCostUsd =
          (usage.inputTokens * price.input +
            usage.outputTokens * price.output) /
          1_000_000;
      }
      const report = {
        schemaVersion: 1,
        fixtureRevision: manifest.fixtureRevision,
        fixtureHash: selected.sha256,
        promptSchemaVersion: STRUCTURED_ANALYSIS_PROMPT_VERSION,
        provider,
        requestedModel,
        resolvedModel: requestedModel,
        quality: {
          factuality: expectedFactsFound / fixture.expected.facts.length,
          unsupportedClaims: null,
          missedCommitments:
            fixture.expected.commitments.length - commitmentsFound,
          speakerContextAccuracy: entities.people.some(
            ({ name, role }) =>
              name === 'Priya' && role?.includes('observability'),
          ),
          deterministicValidationFailures: notes.quality.format_pass ? 0 : 1,
        },
        workflows: {
          meetingNotes: true,
          commitments: commitmentsFound,
          profileUpdates: entities.people.length,
          projectUpdates: entities.projects?.length ?? 0,
          meetingQaAnswerMatched: qa.includes(fixture.expected.qa[0].answer),
          suggestedQuestionsProduced: suggestions.trim().length > 0,
        },
        latency: { endToEndLatencyMs, modelLatencyMs },
        usage: { ...usage, apiCostUsd },
        requiresHumanReview: true,
      };
      process.stdout.write(`PROVIDER_COMPARISON ${JSON.stringify(report)}\n`);
      expect(report.quality.deterministicValidationFailures).toBe(0);
    },
    30 * 60_000,
  );
});
