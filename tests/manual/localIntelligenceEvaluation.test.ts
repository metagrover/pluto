import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildDreamingGenerationRequest } from '../../electron/dreaming/prompt';
import { validateDreamingOutput } from '../../electron/dreaming/validateDreamingOutput';
import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import {
  type EvaluationEvent,
  type EvaluationModelIdentity,
  type LocalIntelligenceManifest,
  type NotesEvaluationCollection,
  type NotesExperimentConfiguration,
  type NotesExperimentManifest,
  type NotesScheduledRun,
  assertEvaluationCeiling,
  parseLocalIntelligenceManifest,
  reconcileNotesEvaluationSchedule,
} from '../../scripts/lib/local_intelligence_evaluation';
import {
  appendOwnerOnlyPrivateLine,
  writeOwnerOnlyPrivateFile,
} from '../../scripts/lib/privateEvaluationFile';
import {
  type LocalIntelligenceEvaluationCase,
  evaluateReplayResponse,
  localIntelligenceEvaluationCases,
  scoreGoldOutput,
} from './fixtures/localIntelligenceEvaluationCases';
import { scoreNotesGoldOutput } from './fixtures/localIntelligenceNotesScoring';

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

const selectedNotesConfiguration = (
  manifest: LocalIntelligenceManifest,
): NotesExperimentConfiguration | null => {
  if (manifest.schemaVersion !== 2) return null;
  if (process.env.LOCAL_INTELLIGENCE_EVALUATION_SCHEDULE === '1') {
    if (process.env.LOCAL_INTELLIGENCE_EVALUATION_CONFIG) {
      throw new Error('evaluation_schedule_single_config_conflict');
    }
    return null;
  }
  const requested = process.env.LOCAL_INTELLIGENCE_EVALUATION_CONFIG;
  if (!requested) throw new Error('evaluation_config_required');
  const configuration = manifest.configurations.find(
    (candidate) => candidate.configId === requested,
  );
  if (!configuration) throw new Error('evaluation_config_unknown');
  return configuration;
};

const selectedCases = (
  manifest: LocalIntelligenceManifest,
): LocalIntelligenceEvaluationCase[] => {
  const partition = process.env.LOCAL_INTELLIGENCE_EVALUATION_PARTITION;
  if (partition && partition !== 'development' && partition !== 'held_out') {
    throw new Error('evaluation_partition_unknown');
  }
  if (manifest.schemaVersion === 2 && partition !== manifest.partition) {
    throw new Error('evaluation_partition_mismatch');
  }
  const collection = process.env.LOCAL_INTELLIGENCE_EVALUATION_COLLECTION as
    | NotesEvaluationCollection
    | undefined;
  if (
    collection &&
    !['semantic', 'ordinary_capacity', 'expected_rejection'].includes(
      collection,
    )
  ) {
    throw new Error('evaluation_collection_unknown');
  }
  const requested = process.env.LOCAL_INTELLIGENCE_EVALUATION_CASE?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const collectionIds =
    manifest.schemaVersion === 2 && collection
      ? manifest.collections[
          collection === 'ordinary_capacity'
            ? 'ordinaryCapacity'
            : collection === 'expected_rejection'
              ? 'expectedRejection'
              : 'semantic'
        ]
      : null;
  const cases = localIntelligenceEvaluationCases.filter(
    (candidate) =>
      (!partition || candidate.partition === partition) &&
      (!collectionIds || collectionIds.includes(candidate.id)) &&
      (!requested?.length || requested.includes(candidate.id)),
  );
  if (!cases.length || (requested && cases.length !== requested.length)) {
    throw new Error('evaluation_case_unknown');
  }
  return cases;
};

const caseForScheduledRun = (
  manifest: NotesExperimentManifest,
  run: NotesScheduledRun,
): LocalIntelligenceEvaluationCase => {
  const candidate = localIntelligenceEvaluationCases.find(
    ({ id }) => id === run.caseId,
  );
  const expectedIds =
    run.collection === 'ordinary_capacity'
      ? manifest.collections.ordinaryCapacity
      : run.collection === 'expected_rejection'
        ? manifest.collections.expectedRejection
        : manifest.collections.semantic;
  if (!candidate || !expectedIds.includes(run.caseId)) {
    throw new Error('evaluation_schedule_mismatch');
  }
  return candidate;
};

type EvaluationExecutionRow = {
  run: NotesScheduledRun | null;
  candidate: LocalIntelligenceEvaluationCase;
  model: EvaluationModelIdentity;
  configuration: NotesExperimentConfiguration | null;
};

const executionRows = (
  manifest: LocalIntelligenceManifest,
): EvaluationExecutionRow[] => {
  const scheduleMode =
    process.env.LOCAL_INTELLIGENCE_EVALUATION_SCHEDULE === '1';
  if (scheduleMode) {
    if (manifest.schemaVersion !== 2) {
      throw new Error('evaluation_schedule_manifest_required');
    }
    if (
      process.env.LOCAL_INTELLIGENCE_EVALUATION_CASE ||
      process.env.LOCAL_INTELLIGENCE_EVALUATION_COLLECTION
    ) {
      throw new Error('evaluation_schedule_filter_conflict');
    }
    selectedNotesConfiguration(manifest);
    return manifest.schedule.map((run) => {
      const configuration = manifest.configurations.find(
        ({ configId }) => configId === run.configId,
      );
      const model = manifest.models.find(
        ({ configId }) => configId === run.configId,
      );
      if (!configuration || !model) {
        throw new Error('evaluation_schedule_mismatch');
      }
      return {
        run,
        candidate: caseForScheduledRun(manifest, run),
        model,
        configuration,
      };
    });
  }

  const configuration = selectedNotesConfiguration(manifest);
  const model = configuration
    ? manifest.models.find(
        ({ configId }) => configId === configuration.configId,
      )
    : selectedModel(manifest);
  if (!model) throw new Error('evaluation_config_unknown');
  return selectedCases(manifest).map((candidate) => ({
    run: null,
    candidate,
    model,
    configuration,
  }));
};

const pendingHumanReview = (automatedTriageAccepted: boolean) => ({
  automatedTriageAccepted,
  reviewStatus: 'pending_human_review' as const,
});

type CapturedWire = {
  endpoint: string;
  body: Record<string, unknown>;
};

type EvaluationWireRequest =
  | { kind: 'ignored' }
  | {
      kind: 'inference';
      endpoint: string;
      body: Record<string, unknown>;
      actualModel: string;
    }
  | {
      kind: 'residency';
      endpoint: string;
      action: 'unload';
      model: string;
    };

type EvaluationWireStart = {
  at: string;
  endpoint: string;
  requestedModel: string;
  actualModel: string;
  bodySha256: string;
  options: unknown;
  formatSha256: string;
  responseContract: 'reconciliation' | 'compact_draft' | 'editor' | 'other';
};

type EvaluationResidencyEvent = {
  at: string;
  endpoint: string;
  action: 'unload';
  model: string;
};

const classifyEvaluationWireRequest = (
  endpoint: string,
  bodyText: unknown,
): EvaluationWireRequest => {
  if (
    !/\/api\/(?:chat|generate)$/.test(endpoint) ||
    typeof bodyText !== 'string'
  ) {
    return { kind: 'ignored' };
  }
  const body = JSON.parse(bodyText) as Record<string, unknown>;
  const contentFreeUnload =
    endpoint === '/api/generate' &&
    body.keep_alive === 0 &&
    body.stream === false &&
    !Object.hasOwn(body, 'prompt') &&
    !Object.hasOwn(body, 'messages');
  if (contentFreeUnload) {
    return {
      kind: 'residency',
      endpoint,
      action: 'unload',
      model: String(body.model ?? ''),
    };
  }
  return {
    kind: 'inference',
    endpoint,
    body,
    actualModel: String(body.model ?? ''),
  };
};

const recordEvaluationWireRequest = (input: {
  endpoint: string;
  bodyText: unknown;
  expectedModel: string;
  at: string;
  wireStarts: EvaluationWireStart[];
  residencyEvents: EvaluationResidencyEvent[];
}): void => {
  const request = classifyEvaluationWireRequest(input.endpoint, input.bodyText);
  if (request.kind === 'residency') {
    input.residencyEvents.push({
      at: input.at,
      endpoint: request.endpoint,
      action: request.action,
      model: request.model,
    });
    return;
  }
  if (request.kind !== 'inference') return;
  const format = request.body.format;
  const properties =
    format && typeof format === 'object' && 'properties' in format
      ? (format as { properties?: Record<string, unknown> }).properties
      : undefined;
  const responseContract = properties?.facts
    ? 'reconciliation'
    : properties?.dispositions
      ? 'editor'
      : properties?.sections
        ? 'compact_draft'
        : 'other';
  input.wireStarts.push({
    at: input.at,
    endpoint: request.endpoint,
    requestedModel: input.expectedModel,
    actualModel: request.actualModel,
    bodySha256: sha(input.bodyText as string),
    options: request.body.options,
    formatSha256: sha(JSON.stringify(request.body.format ?? null)),
    responseContract,
  });
  if (request.actualModel !== input.expectedModel) {
    throw new Error('evaluation_wire_model_mismatch');
  }
};

type ProviderTransport = {
  ollamaStream: (
    endpoint: string,
    options: RequestInit,
    onChunk: (chunk: string) => void,
  ) => Promise<unknown>;
  ollamaFetch: (
    endpoint: string,
    options: RequestInit | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<Response>;
};

const captureDryRunWire = async (
  provider: UnifiedLLMProvider,
  model: EvaluationModelIdentity,
  run: () => Promise<unknown>,
): Promise<CapturedWire[]> => {
  const captured: CapturedWire[] = [];
  const transport = provider as unknown as ProviderTransport;
  const capture = (endpoint: string, options: RequestInit) => {
    if (!/\/api\/(?:chat|generate)$/.test(endpoint)) {
      throw new Error('evaluation_dry_run_unexpected_endpoint');
    }
    if (typeof options.body !== 'string') {
      throw new Error('evaluation_dry_run_body_missing');
    }
    const body = JSON.parse(options.body) as Record<string, unknown>;
    captured.push({ endpoint, body });
    return body;
  };
  const readPath = (value: unknown, keys: readonly (string | number)[]) => {
    let current: unknown = value;
    for (const key of keys) {
      if (
        current === null ||
        typeof current !== 'object' ||
        !(key in current)
      ) {
        return undefined;
      }
      current = (current as Record<string | number, unknown>)[key];
    }
    return current;
  };
  const sourceLabels = (
    body: Record<string, unknown>,
    contract: EvaluationWireStart['responseContract'],
  ): string[] => {
    const path =
      contract === 'reconciliation'
        ? ['properties', 'facts', 'items', 'properties', 'sources']
        : contract === 'compact_draft'
          ? [
              'properties',
              'sections',
              'items',
              'properties',
              'items',
              'items',
              'properties',
              'sources',
            ]
          : ['properties', 'overview', 'anyOf', 0, 'properties', 'sources'];
    const labels = readPath(body.format, [...path, 'items', 'enum']);
    return Array.isArray(labels) &&
      labels.every((label) => typeof label === 'string')
      ? labels
      : [];
  };
  const promptFor = (body: Record<string, unknown>): string => {
    const messages = body.messages as Array<{ content?: unknown }> | undefined;
    return typeof messages?.[0]?.content === 'string'
      ? messages[0].content
      : '';
  };
  const firstSourceText = (prompt: string): string => {
    const packet = prompt.match(
      /BEGIN SOURCE DATA\n([\s\S]*?)\nEND SOURCE DATA/,
    );
    const first = packet?.[1]?.split('\n').find(Boolean);
    if (!first) throw new Error('evaluation_dry_run_source_missing');
    const parsed = JSON.parse(first) as { text?: unknown };
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
      throw new Error('evaluation_dry_run_source_missing');
    }
    return parsed.text;
  };
  const responseFor = (body: Record<string, unknown>) => {
    const properties = readPath(body.format, ['properties']);
    const hasProperty = (key: string) =>
      properties !== null &&
      typeof properties === 'object' &&
      key in properties;
    const contract: EvaluationWireStart['responseContract'] = hasProperty(
      'facts',
    )
      ? 'reconciliation'
      : hasProperty('dispositions')
        ? 'editor'
        : hasProperty('sections')
          ? 'compact_draft'
          : 'other';
    if (contract === 'other') {
      throw new Error('evaluation_dry_run_wire_captured');
    }
    const prompt = promptFor(body);
    const text = firstSourceText(prompt);
    const label = sourceLabels(body, contract)[0];
    if (!label) throw new Error('evaluation_dry_run_source_label_missing');
    if (contract === 'reconciliation') {
      return {
        facts: [{ text, sources: [label] }],
        actions: [],
        decisions: [],
        questions: [],
      };
    }
    if (contract === 'compact_draft') {
      return {
        sections: [
          {
            title: 'Dry-run source inventory',
            items: [
              { kind: 'point', text, owner: null, due: null, sources: [label] },
            ],
          },
        ],
      };
    }
    return {
      meetingType: 'general',
      overview: null,
      sections: [
        {
          title: { text: 'Dry-run source inventory', sources: [label] },
          items: [
            { kind: 'point', text, owner: null, due: null, sources: [label] },
          ],
        },
      ],
      dispositions: [],
      terminology: [],
    };
  };
  transport.ollamaStream = async (endpoint, options, onChunk) => {
    const body = capture(endpoint, options);
    onChunk(
      `${JSON.stringify({
        message: { content: JSON.stringify(responseFor(body)) },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 10,
        eval_count: 10,
      })}\n`,
    );
    return { ok: true, statusText: 'OK', errorBody: '' };
  };
  transport.ollamaFetch = async (endpoint, options) => {
    if (endpoint === '/api/tags') {
      return new Response(
        JSON.stringify({ models: [{ name: model.tag, digest: model.digest }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (endpoint === '/api/ps') {
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!options) throw new Error('evaluation_dry_run_body_missing');
    capture(endpoint, options);
    return new Response(JSON.stringify({ done: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await run();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== 'evaluation_dry_run_wire_captured'
    ) {
      throw error;
    }
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

const resourceSnapshot = async () => {
  const memoryOutput = execFileSync('/usr/bin/memory_pressure', ['-Q'], {
    encoding: 'utf8',
  });
  const freePercent = Number(
    /free percentage:\s*(\d+)%/i.exec(memoryOutput)?.[1] ?? -1,
  );
  const thermalOutput = execFileSync('/usr/bin/pmset', ['-g', 'therm'], {
    encoding: 'utf8',
  });
  const swapOutput = execFileSync('/usr/sbin/sysctl', ['vm.swapusage'], {
    encoding: 'utf8',
  });
  const swapUsedMiB = Number(/used = ([0-9.]+)M/i.exec(swapOutput)?.[1] ?? -1);
  const psResponse = await fetch('http://127.0.0.1:11434/api/ps');
  const ps = (await psResponse.json()) as {
    models?: Array<{ name?: string; size_vram?: number; size?: number }>;
  };
  if (freePercent < 0 || swapUsedMiB < 0) {
    throw new Error('evaluation_resource_telemetry_unavailable');
  }
  return {
    memoryFreePercent: freePercent,
    memoryPressure:
      freePercent < 5 ? 'critical' : freePercent < 10 ? 'warning' : 'normal',
    thermalState: /No thermal warning level has been recorded/i.test(
      thermalOutput,
    )
      ? 'nominal'
      : 'unknown',
    swapUsedBytes: Math.round(swapUsedMiB * 1024 * 1024),
    residentModels: (ps.models ?? []).map((resident) => ({
      name: resident.name ?? 'unknown',
      residentBytes: resident.size_vram ?? resident.size ?? 0,
    })),
  };
};

const prepareScheduledCondition = async (
  run: NotesScheduledRun,
  model: EvaluationModelIdentity,
  allModels: readonly EvaluationModelIdentity[],
  request: typeof fetch,
): Promise<{ condition: 'cold' | 'warm'; residentModel: string }> => {
  for (const candidate of allModels) {
    if (run.condition === 'warm' && candidate.tag === model.tag) continue;
    const response = await request('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: candidate.tag,
        keep_alive: 0,
        stream: false,
      }),
    });
    if (!response.ok) throw new Error('evaluation_residency_cleanup_failed');
  }
  if (run.condition === 'warm') {
    const response = await request('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.tag,
        prompt: 'Return exactly READY. This contains no evaluation content.',
        stream: false,
        keep_alive: '30m',
        options: { seed: 41, temperature: 0, num_predict: 8 },
      }),
    });
    if (!response.ok) throw new Error('evaluation_residency_prime_failed');
  }
  const resident = await request('http://127.0.0.1:11434/api/ps');
  if (!resident.ok) throw new Error('evaluation_model_inventory_unavailable');
  const payload = (await resident.json()) as {
    models?: Array<{ name?: string }>;
  };
  const names = (payload.models ?? []).map(({ name }) => name).filter(Boolean);
  if (
    (run.condition === 'cold' && names.includes(model.tag)) ||
    (run.condition === 'warm' && !names.includes(model.tag))
  ) {
    throw new Error('evaluation_residency_condition_mismatch');
  }
  return { condition: run.condition, residentModel: model.tag };
};

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

  it('audits content-free Ollama unloads separately from inference starts', () => {
    const wireStarts: EvaluationWireStart[] = [];
    const residencyEvents: EvaluationResidencyEvent[] = [];
    expect(() =>
      recordEvaluationWireRequest({
        endpoint: '/api/generate',
        bodyText: JSON.stringify({
          model: 'resident-non-target:latest',
          keep_alive: 0,
          stream: false,
        }),
        expectedModel: 'selected-model:latest',
        at: '2026-09-07T00:00:00.000Z',
        wireStarts,
        residencyEvents,
      }),
    ).not.toThrow();
    expect(wireStarts).toEqual([]);
    expect(residencyEvents).toEqual([
      {
        at: '2026-09-07T00:00:00.000Z',
        endpoint: '/api/generate',
        action: 'unload',
        model: 'resident-non-target:latest',
      },
    ]);
  });

  it('still rejects a mismatched generation model', () => {
    const wireStarts: EvaluationWireStart[] = [];
    expect(() =>
      recordEvaluationWireRequest({
        endpoint: '/api/generate',
        bodyText: JSON.stringify({
          model: 'unexpected-model:latest',
          keep_alive: 0,
          stream: false,
          prompt: 'content makes this an inference request',
        }),
        expectedModel: 'selected-model:latest',
        at: '2026-09-07T00:00:00.000Z',
        wireStarts,
        residencyEvents: [],
      }),
    ).toThrow('evaluation_wire_model_mismatch');
    expect(wireStarts).toHaveLength(1);
  });

  it('labels deterministic gold scoring as triage pending human review', () => {
    expect(pendingHumanReview(true)).toEqual({
      automatedTriageAccepted: true,
      reviewStatus: 'pending_human_review',
    });
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
      const unchangedWorkloadModel =
        manifest.schemaVersion === 2
          ? manifest.models.find(
              ({ configId }) => configId === 'gemma-notes-control',
            )
          : model;
      if (!unchangedWorkloadModel) {
        throw new Error('evaluation_control_model_missing');
      }
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
      const notesConfiguration = selectedNotesConfiguration(manifest);
      let notesAnalysis: AnalysisDocumentV3 | undefined;
      const notesWire = await captureDryRunWire(notesProvider, model, () =>
        notesProvider
          .generateStructuredAnalysis(notesTranscript, '', 'auto', {
            source: notesSource,
            contextTokens: 16_384,
            compactWriterContract: true,
            sourceFirstReconciliation:
              notesConfiguration?.sourceFirstReconciliation ?? false,
          })
          .then((analysis) => {
            notesAnalysis = analysis;
            return analysis;
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
      expect(
        notesWire.map(({ body }) => {
          const properties = (body.format as { properties?: object })
            .properties;
          return properties && 'facts' in properties
            ? 'reconciliation'
            : properties && 'dispositions' in properties
              ? 'editor'
              : 'compact_draft';
        }),
      ).toEqual(
        notesConfiguration?.sourceFirstReconciliation
          ? ['reconciliation', 'editor']
          : ['compact_draft', 'editor'],
      );
      expect(notesAnalysis?.generation_metadata).toMatchObject({
        model: model.tag,
        pipeline_version: notesConfiguration?.sourceFirstReconciliation
          ? 'notes-v30-source-first'
          : expect.stringMatching(/^writer-editor/),
        source_provenance: { source_revision: notesSource.revision },
      });

      const chatProvider = providerFor(unchangedWorkloadModel);
      const chatWire = await captureDryRunWire(
        chatProvider,
        unchangedWorkloadModel,
        () =>
          chatProvider.answerAskPluto(chatCase.prompt, { mode: chatCase.mode }),
      );
      expect(chatWire[0]).toMatchObject({
        endpoint: '/api/generate',
        body: {
          model: unchangedWorkloadModel.tag,
          stream: false,
          think: false,
          options: { num_predict: 192 },
        },
      });

      const dreamingProvider = providerFor(unchangedWorkloadModel);
      const dreamingRequest = buildDreamingGenerationRequest(
        dreamingCase.input,
      );
      const dreamingWire = await captureDryRunWire(
        dreamingProvider,
        unchangedWorkloadModel,
        () =>
          dreamingProvider.synthesizeKnowledgeDocument(dreamingRequest.prompt, {
            purpose: 'dreaming',
            responseSchema: dreamingRequest.schema,
            model: unchangedWorkloadModel.tag,
            promptVersion: dreamingRequest.promptVersion,
          }),
      );
      expect(dreamingWire[0]).toMatchObject({
        body: {
          model: unchangedWorkloadModel.tag,
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
      const outputRoot = process.env.LOCAL_INTELLIGENCE_EVALUATION_OUT;
      if (!outputRoot || !path.isAbsolute(outputRoot)) {
        throw new Error('evaluation_output_absolute_path_required');
      }
      let rows = executionRows(manifest);
      const scheduleMode =
        process.env.LOCAL_INTELLIGENCE_EVALUATION_SCHEDULE === '1';
      const ledgerPath = path.join(outputRoot, 'events.private.jsonl');
      const existingEvents: EvaluationEvent[] = fs.existsSync(ledgerPath)
        ? fs
            .readFileSync(ledgerPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as EvaluationEvent)
        : [];
      if (scheduleMode) {
        if (manifest.schemaVersion !== 2) {
          throw new Error('evaluation_schedule_manifest_required');
        }
        const resumable = reconcileNotesEvaluationSchedule(
          manifest,
          existingEvents,
        );
        const unstartedIds = new Set(
          resumable.unstarted.map(({ runId }) => runId),
        );
        rows = rows.filter(
          ({ run }) => run !== null && unstartedIds.has(run.runId),
        );
      }
      const originalFetch = globalThis.fetch;
      const wireStarts: EvaluationWireStart[] = [];
      const residencyEvents: EvaluationResidencyEvent[] = [];
      let activeRow: EvaluationExecutionRow | null = null;
      let activeAttemptIds: string[] = [];
      globalThis.fetch = async (input, init) => {
        const endpoint = new URL(String(input)).pathname;
        const before = wireStarts.length;
        recordEvaluationWireRequest({
          endpoint,
          bodyText: init?.body,
          expectedModel: activeRow?.model.tag ?? '',
          at: new Date().toISOString(),
          wireStarts,
          residencyEvents,
        });
        if (activeRow?.run && wireStarts.length > before) {
          const attemptId = `attempt-${sha(
            `${activeRow.run.runId}:${activeAttemptIds.length}`,
          ).slice(0, 24)}`;
          activeAttemptIds.push(attemptId);
          appendOwnerOnlyPrivateLine(ledgerPath, {
            type: 'physical_started',
            eventId: `event-${attemptId}`,
            runId: activeRow.run.runId,
            logicalStageId:
              wireStarts.at(-1)?.responseContract ?? 'notes_generation',
            attemptId,
            requestedModel: activeRow.model.tag,
            actualModel: wireStarts.at(-1)?.actualModel ?? '',
            atMs: performance.timeOrigin + performance.now(),
          } satisfies EvaluationEvent);
        }
        return originalFetch(input, init);
      };

      const results: Array<Record<string, unknown>> = [];
      try {
        for (const row of rows) {
          activeRow = row;
          activeAttemptIds = [];
          const { candidate, model, configuration, run } = row;
          await assertInstalledModelIdentity(model);
          if (run) {
            await prepareScheduledCondition(
              run,
              model,
              manifest.models,
              originalFetch,
            );
            appendOwnerOnlyPrivateLine(ledgerPath, {
              type: 'run_started',
              eventId: `event-run-${sha(run.runId).slice(0, 24)}`,
              runId: run.runId,
              caseId: run.caseId,
              configId: run.configId,
              lane: 'meeting_notes',
              environment: 'replay',
              sourceRevision: manifest.sourceRevision,
              atMs: performance.timeOrigin + performance.now(),
            } satisfies EvaluationEvent);
          }
          const provider = providerFor(model);
          const startedAt = Date.now();
          const wireStartIndex = wireStarts.length;
          const resourceBefore = await resourceSnapshot();
          let logicalOutcome: Extract<
            EvaluationEvent,
            { type: 'logical_terminal' }
          >['outcome'] = 'pending_review';
          let physicalOutcome: Extract<
            EvaluationEvent,
            { type: 'physical_terminal' }
          >['outcome'] = 'complete';
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
                  signal: AbortSignal.timeout(
                    candidate.durationClass === 'long'
                      ? manifest.ceilings.longNotesMs
                      : manifest.ceilings.ordinaryNotesMs,
                  ),
                  source,
                  contextTokens:
                    manifest.schemaVersion === 2
                      ? manifest.settings.contextTokens
                      : 16_384,
                  compactWriterContract:
                    configuration?.compactWriterContract ?? true,
                  sourceFirstReconciliation:
                    configuration?.sourceFirstReconciliation ?? false,
                },
              );
              if (run?.collection === 'expected_rejection') {
                throw new Error(
                  'evaluation_expected_rejection_produced_output',
                );
              }
              const goldScore = scoreNotesGoldOutput(
                candidate,
                analysis,
                source,
              );
              results.push({
                runId: run?.runId ?? null,
                caseId: candidate.id,
                configId: model.configId,
                collection: run?.collection ?? null,
                repetition: run?.repetition ?? null,
                condition: run?.condition ?? null,
                lane: candidate.lane,
                sourceRevision: source.revision,
                sourceSegments: candidate.segments,
                transcript,
                analysis,
                pipelineVersion:
                  analysis.generation_metadata?.pipeline_version ?? null,
                responseContracts: wireStarts
                  .slice(wireStartIndex)
                  .map(({ responseContract }) => responseContract),
                goldScore,
                ...pendingHumanReview(
                  analysis.analysis_schema_version === 3 && goldScore.passed,
                ),
                elapsedMs: Date.now() - startedAt,
                physicalStarts: wireStarts.length - wireStartIndex,
                resourceBefore,
                resourceAfter: await resourceSnapshot(),
              });
            } else if (
              candidate.lane === 'quick_chat' ||
              candidate.lane === 'cross_meeting'
            ) {
              const answer = await provider.answerAskPluto(candidate.prompt, {
                mode: candidate.mode,
              });
              const goldScore = scoreGoldOutput(candidate, answer);
              results.push({
                caseId: candidate.id,
                lane: candidate.lane,
                prompt: candidate.prompt,
                answer,
                goldScore,
                ...pendingHumanReview(
                  Boolean(answer.trim()) && goldScore.passed,
                ),
                elapsedMs: Date.now() - startedAt,
                physicalStarts: wireStarts.length - wireStartIndex,
                resourceBefore,
                resourceAfter: await resourceSnapshot(),
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
              const goldScore = scoreGoldOutput(candidate, raw);
              results.push({
                caseId: candidate.id,
                lane: candidate.lane,
                input: candidate.input,
                raw,
                validation,
                goldScore,
                ...pendingHumanReview(validation.valid && goldScore.passed),
                elapsedMs: Date.now() - startedAt,
                physicalStarts: wireStarts.length - wireStartIndex,
                resourceBefore,
                resourceAfter: await resourceSnapshot(),
              });
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            const expectedFailure =
              run?.collection === 'expected_rejection' &&
              'expectedFailure' in candidate
                ? candidate.expectedFailure
                : null;
            const expectedRejectionPassed = message === expectedFailure;
            logicalOutcome = expectedRejectionPassed ? 'accepted' : 'failed';
            physicalOutcome = expectedRejectionPassed ? 'complete' : 'failed';
            results.push({
              runId: run?.runId ?? null,
              caseId: candidate.id,
              configId: model.configId,
              collection: run?.collection ?? null,
              repetition: run?.repetition ?? null,
              condition: run?.condition ?? null,
              lane: candidate.lane,
              ...pendingHumanReview(false),
              expectedRejectionPassed,
              elapsedMs: Date.now() - startedAt,
              physicalStarts: wireStarts.length - wireStartIndex,
              resourceBefore,
              resourceAfter: await resourceSnapshot(),
              error: message,
            });
          }
          if (run) {
            assertEvaluationCeiling(manifest, {
              lane: 'meeting_notes',
              durationClass: candidate.durationClass,
              elapsedMs: Date.now() - startedAt,
              physicalStarts: activeAttemptIds.length,
            });
            const terminalResource = await resourceSnapshot();
            const telemetry = {
              memoryPressure: terminalResource.memoryPressure,
              thermalState: terminalResource.thermalState,
              residentModelBytes: terminalResource.residentModels.reduce(
                (total, resident) => total + resident.residentBytes,
                0,
              ),
              swapUsedBytes: terminalResource.swapUsedBytes,
            };
            for (const attemptId of activeAttemptIds) {
              appendOwnerOnlyPrivateLine(ledgerPath, {
                type: 'physical_terminal',
                eventId: `event-end-${attemptId}`,
                runId: run.runId,
                attemptId,
                outcome: physicalOutcome,
                atMs: performance.timeOrigin + performance.now(),
                inputTokens: 0,
                outputTokens: 0,
                resourceTelemetry: telemetry,
              } satisfies EvaluationEvent);
            }
            appendOwnerOnlyPrivateLine(ledgerPath, {
              type: 'logical_terminal',
              eventId: `event-end-${sha(run.runId).slice(0, 24)}`,
              runId: run.runId,
              logicalStageId: 'notes',
              outcome: logicalOutcome,
              acceptedInReplay: logicalOutcome === 'accepted',
              published: false,
              sourceRevision: manifest.sourceRevision,
              atMs: performance.timeOrigin + performance.now(),
            } satisfies EvaluationEvent);
          }
        }
      } finally {
        activeRow = null;
        globalThis.fetch = originalFetch;
      }

      const artifactPath = path.join(
        outputRoot,
        `${scheduleMode ? 'paired-schedule' : (rows[0]?.model.configId ?? 'empty')}-${Date.now()}.private.json`,
      );
      writeOwnerOnlyPrivateFile(
        artifactPath,
        `${JSON.stringify(
          {
            schemaVersion: 2,
            sourceRevision: manifest.sourceRevision,
            scheduleMode,
            scheduledRows: rows.map(({ run }) => run),
            models: manifest.models,
            wireStarts,
            residencyEvents,
            results,
          },
          null,
          2,
        )}\n`,
      );
      if (rows.length) expect(wireStarts.length).toBeGreaterThan(0);
      expect(
        wireStarts.every((start) =>
          manifest.models.some(({ tag }) => tag === start.actualModel),
        ),
      ).toBe(true);
      console.log(
        JSON.stringify({
          localIntelligenceEvaluation: {
            configId: scheduleMode
              ? 'paired-schedule'
              : rows[0]?.model.configId,
            caseCount: results.length,
            automatedTriageAcceptedCount: results.filter(
              (result) => result.automatedTriageAccepted,
            ).length,
            physicalStarts: wireStarts.length,
            artifactPath,
          },
        }),
      );
    },
    1_230_000,
  );
});
