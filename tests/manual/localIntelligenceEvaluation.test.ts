import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildDreamingGenerationRequest } from '../../electron/dreaming/prompt';
import { validateDreamingOutput } from '../../electron/dreaming/validateDreamingOutput';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import {
  type EvaluationModelIdentity,
  type LocalIntelligenceManifest,
  parseLocalIntelligenceManifest,
} from '../../scripts/lib/local_intelligence_evaluation';
import { writeOwnerOnlyPrivateFile } from '../../scripts/lib/privateEvaluationFile';
import {
  type LocalIntelligenceEvaluationCase,
  evaluateReplayResponse,
  localIntelligenceEvaluationCases,
} from './fixtures/localIntelligenceEvaluationCases';

const enabled = process.env.RUN_LOCAL_INTELLIGENCE_EVALUATION === '1';
const dryRun = process.env.LOCAL_INTELLIGENCE_EVALUATION_DRY_RUN === '1';
const realSuite = enabled ? describe : describe.skip;

const sha = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const loadManifest = (): LocalIntelligenceManifest => {
  const manifestPath = process.env.LOCAL_INTELLIGENCE_EVALUATION_MANIFEST;
  if (!manifestPath || !path.isAbsolute(manifestPath)) {
    throw new Error('evaluation_manifest_absolute_path_required');
  }
  return parseLocalIntelligenceManifest(
    JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
  );
};

const selectedModel = (
  manifest: LocalIntelligenceManifest,
): EvaluationModelIdentity => {
  const requested = process.env.LOCAL_INTELLIGENCE_EVALUATION_CONFIG;
  const model = requested
    ? manifest.models.find((candidate) => candidate.configId === requested)
    : manifest.models[0];
  if (!model) throw new Error('evaluation_config_unknown');
  return model;
};

const selectedCases = (): LocalIntelligenceEvaluationCase[] => {
  const requested = process.env.LOCAL_INTELLIGENCE_EVALUATION_CASE;
  const cases = requested
    ? localIntelligenceEvaluationCases.filter(
        (candidate) => candidate.id === requested,
      )
    : localIntelligenceEvaluationCases;
  if (!cases.length) throw new Error('evaluation_case_unknown');
  return cases;
};

type CapturedWire = {
  endpoint: string;
  body: Record<string, unknown>;
};

type ProviderTransport = {
  ollamaStream: (
    endpoint: string,
    options: RequestInit,
    onChunk: (chunk: string) => void,
  ) => Promise<unknown>;
  ollamaFetch: (
    endpoint: string,
    options: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<Response>;
};

const captureDryRunWire = async (
  provider: UnifiedLLMProvider,
  run: () => Promise<unknown>,
): Promise<CapturedWire[]> => {
  const captured: CapturedWire[] = [];
  const transport = provider as unknown as ProviderTransport;
  const capture = (endpoint: string, options: RequestInit): never => {
    if (!/\/api\/(?:chat|generate)$/.test(endpoint)) {
      throw new Error('evaluation_dry_run_unexpected_endpoint');
    }
    if (typeof options.body !== 'string') {
      throw new Error('evaluation_dry_run_body_missing');
    }
    captured.push({ endpoint, body: JSON.parse(options.body) });
    throw new Error('evaluation_dry_run_wire_captured');
  };
  transport.ollamaStream = async (endpoint, options) =>
    capture(endpoint, options);
  transport.ollamaFetch = async (endpoint, options) =>
    capture(endpoint, options);
  try {
    await run();
  } catch {
    // Expected: transport is deliberately stopped after the request body exists.
  }
  if (!captured.length) throw new Error('evaluation_dry_run_no_wire_intent');
  return captured;
};

const providerFor = (model: EvaluationModelIdentity): UnifiedLLMProvider =>
  new UnifiedLLMProvider('ollama', {
    ollama_model: model.tag,
    ollama_fast_model: model.tag,
    ollama_seed: 41,
    ollama_structured_thinking: false,
  });

const assertInstalledModelIdentity = async (
  model: EvaluationModelIdentity,
): Promise<void> => {
  const response = await fetch('http://127.0.0.1:11434/api/tags');
  if (!response.ok) throw new Error('evaluation_model_inventory_unavailable');
  const payload = (await response.json()) as {
    models?: Array<{ name?: string; digest?: string }>;
  };
  const installed = payload.models?.some(
    (candidate) =>
      candidate.name === model.tag && candidate.digest === model.digest,
  );
  if (!installed) throw new Error('evaluation_model_identity_unknown');
};

const transcriptFor = (
  candidate: Extract<
    LocalIntelligenceEvaluationCase,
    { lane: 'meeting_notes' }
  >,
): string =>
  candidate.segments
    .map((segment) => `${segment.speaker}: ${segment.text}`)
    .join('\n');

describe('local intelligence replay acceptance boundary', () => {
  const base = {
    expectedSourceRevision: 'source-a',
    actualSourceRevision: 'source-a',
    transportStatus: 'complete' as const,
    terminationReason: 'stop' as const,
    raw: '{"supported":true}',
    validate: (raw: string) => JSON.parse(raw).supported === true,
  };

  it.each([
    [
      'truncation',
      { terminationReason: 'length' as const },
      'output_truncated',
    ],
    ['wrong citation', { validate: () => false }, 'semantic_validation_failed'],
    [
      'changed source revision',
      { actualSourceRevision: 'source-b' },
      'source_revision_changed',
    ],
    [
      'unavailable model',
      { transportStatus: 'unavailable' as const },
      'model_unavailable',
    ],
    [
      'transport failure',
      { transportStatus: 'failed' as const },
      'transport_failed',
    ],
  ])('rejects %s before replay acceptance', (_name, overrides, reason) => {
    expect(evaluateReplayResponse({ ...base, ...overrides })).toEqual({
      accepted: false,
      reason,
    });
  });

  it('accepts only a complete response with the same source revision', () => {
    expect(evaluateReplayResponse(base)).toEqual({ accepted: true });
  });
});

realSuite('opt-in local intelligence production-path replay', () => {
  it('loads an absolute owner-selected manifest without inference', () => {
    expect(loadManifest().models.length).toBeGreaterThan(0);
  });

  it.skipIf(!dryRun)(
    'asserts notes, chat, and dreaming wire intent without endpoint I/O',
    async () => {
      const manifest = loadManifest();
      const model = selectedModel(manifest);
      const notesCase = localIntelligenceEvaluationCases.find(
        (candidate) => candidate.lane === 'meeting_notes',
      );
      const chatCase = localIntelligenceEvaluationCases.find(
        (candidate) => candidate.lane === 'quick_chat',
      );
      const dreamingCase = localIntelligenceEvaluationCases.find(
        (candidate) => candidate.lane === 'dreaming',
      );
      expect(notesCase?.lane).toBe('meeting_notes');
      expect(chatCase?.lane).toBe('quick_chat');
      expect(dreamingCase?.lane).toBe('dreaming');
      if (
        !notesCase ||
        notesCase.lane !== 'meeting_notes' ||
        !chatCase ||
        chatCase.lane !== 'quick_chat' ||
        !dreamingCase ||
        dreamingCase.lane !== 'dreaming'
      ) {
        throw new Error('evaluation_routing_fixtures_missing');
      }

      const notesTranscript = transcriptFor(notesCase);
      const notesSource = createNotesSource(
        JSON.stringify({ segments: notesCase.segments }),
      );
      const notesProvider = providerFor(model);
      const notesWire = await captureDryRunWire(notesProvider, () =>
        notesProvider.generateStructuredAnalysis(notesTranscript, '', 'auto', {
          source: notesSource,
          contextTokens: 16_384,
          compactWriterContract: true,
        }),
      );
      expect(notesWire[0]).toMatchObject({
        endpoint: '/api/chat',
        body: {
          model: model.tag,
          stream: true,
          think: false,
          options: { num_ctx: 16_384 },
        },
      });
      expect(notesWire[0]?.body.format).toBeTypeOf('object');
      expect(notesWire[0]?.body.messages).toBeInstanceOf(Array);

      const chatProvider = providerFor(model);
      const chatWire = await captureDryRunWire(chatProvider, () =>
        chatProvider.answerAskPluto(chatCase.prompt, { mode: chatCase.mode }),
      );
      expect(chatWire[0]).toMatchObject({
        endpoint: '/api/generate',
        body: {
          model: model.tag,
          stream: false,
          think: false,
          options: { num_predict: 192 },
        },
      });

      const dreamingProvider = providerFor(model);
      const dreamingRequest = buildDreamingGenerationRequest(
        dreamingCase.input,
      );
      const dreamingWire = await captureDryRunWire(dreamingProvider, () =>
        dreamingProvider.synthesizeKnowledgeDocument(dreamingRequest.prompt, {
          purpose: 'dreaming',
          responseSchema: dreamingRequest.schema,
          model: model.tag,
          promptVersion: dreamingRequest.promptVersion,
        }),
      );
      expect(dreamingWire[0]).toMatchObject({
        body: {
          model: model.tag,
          think: false,
          format: dreamingRequest.schema,
        },
      });
    },
  );

  it.skipIf(dryRun)(
    'runs only explicitly selected private replay cases and records every wire start',
    async () => {
      const manifest = loadManifest();
      const model = selectedModel(manifest);
      await assertInstalledModelIdentity(model);
      const cases = selectedCases();
      const outputRoot = process.env.LOCAL_INTELLIGENCE_EVALUATION_OUT;
      if (!outputRoot || !path.isAbsolute(outputRoot)) {
        throw new Error('evaluation_output_absolute_path_required');
      }
      const originalFetch = globalThis.fetch;
      const wireStarts: Array<{
        at: string;
        endpoint: string;
        requestedModel: string;
        actualModel: string;
        bodySha256: string;
        options: unknown;
        formatSha256: string;
      }> = [];
      globalThis.fetch = async (input, init) => {
        const endpoint = new URL(String(input)).pathname;
        if (
          /\/api\/(?:chat|generate)$/.test(endpoint) &&
          typeof init?.body === 'string'
        ) {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          const actualModel = String(body.model ?? '');
          wireStarts.push({
            at: new Date().toISOString(),
            endpoint,
            requestedModel: model.tag,
            actualModel,
            bodySha256: sha(init.body),
            options: body.options,
            formatSha256: sha(JSON.stringify(body.format ?? null)),
          });
          if (actualModel !== model.tag) {
            throw new Error('evaluation_wire_model_mismatch');
          }
        }
        return originalFetch(input, init);
      };

      const results: Array<Record<string, unknown>> = [];
      try {
        for (const candidate of cases) {
          const provider = providerFor(model);
          const startedAt = Date.now();
          const wireStartIndex = wireStarts.length;
          try {
            if (candidate.lane === 'meeting_notes') {
              const transcript = transcriptFor(candidate);
              const source = createNotesSource(
                JSON.stringify({ segments: candidate.segments }),
              );
              const analysis = await provider.generateStructuredAnalysis(
                transcript,
                '',
                'auto',
                {
                  source,
                  contextTokens: 16_384,
                  compactWriterContract: true,
                },
              );
              results.push({
                caseId: candidate.id,
                lane: candidate.lane,
                sourceRevision: source.revision,
                sourceSegments: candidate.segments,
                transcript,
                analysis,
                accepted: analysis.analysis_schema_version === 3,
                elapsedMs: Date.now() - startedAt,
                physicalStarts: wireStarts.length - wireStartIndex,
              });
            } else if (
              candidate.lane === 'quick_chat' ||
              candidate.lane === 'cross_meeting'
            ) {
              const answer = await provider.answerAskPluto(candidate.prompt, {
                mode: candidate.mode,
              });
              results.push({
                caseId: candidate.id,
                lane: candidate.lane,
                prompt: candidate.prompt,
                answer,
                accepted: Boolean(answer.trim()),
                elapsedMs: Date.now() - startedAt,
                physicalStarts: wireStarts.length - wireStartIndex,
              });
            } else {
              const request = buildDreamingGenerationRequest(candidate.input);
              const raw = await provider.synthesizeKnowledgeDocument(
                request.prompt,
                {
                  purpose: 'dreaming',
                  responseSchema: request.schema,
                  model: model.tag,
                  promptVersion: request.promptVersion,
                },
              );
              const validation = validateDreamingOutput(raw, candidate.input);
              results.push({
                caseId: candidate.id,
                lane: candidate.lane,
                input: candidate.input,
                raw,
                validation,
                accepted: validation.valid,
                elapsedMs: Date.now() - startedAt,
                physicalStarts: wireStarts.length - wireStartIndex,
              });
            }
          } catch (error) {
            results.push({
              caseId: candidate.id,
              lane: candidate.lane,
              accepted: false,
              elapsedMs: Date.now() - startedAt,
              physicalStarts: wireStarts.length - wireStartIndex,
              error: String(error),
            });
          }
        }
      } finally {
        globalThis.fetch = originalFetch;
      }

      const artifactPath = path.join(
        outputRoot,
        `${model.configId}-${Date.now()}.private.json`,
      );
      writeOwnerOnlyPrivateFile(
        artifactPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            sourceRevision: manifest.sourceRevision,
            model,
            wireStarts,
            results,
          },
          null,
          2,
        )}\n`,
      );
      expect(wireStarts.length).toBeGreaterThan(0);
      expect(wireStarts.every((start) => start.actualModel === model.tag)).toBe(
        true,
      );
      console.log(
        JSON.stringify({
          localIntelligenceEvaluation: {
            configId: model.configId,
            caseCount: results.length,
            acceptedCount: results.filter((result) => result.accepted).length,
            physicalStarts: wireStarts.length,
            artifactPath,
          },
        }),
      );
    },
    1_230_000,
  );
});
