import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CommitmentOwnerInput,
  buildIdentityResolutionRequest,
  buildIdentityVerificationRequest,
  resolveCommitmentOwner,
} from '../../electron/identityResolution';
import { createOllamaGenerationDeadline } from '../../electron/llm/ollamaGenerationDeadline';
import {
  UnifiedLLMProvider,
  calculateOllamaContextBudget,
  getOllamaActiveGenerationTimeoutMs,
  toOllamaCommitmentSchema,
} from '../../electron/llm/unifiedProvider';
import type {
  IdentityBinding,
  IdentityContext,
  OwnerResolution,
} from '../../src/types/identity';
import { OLLAMA_GENERAL_MODEL } from '../../src/utils/ollamaModels';

const enabled = process.env.RUN_IDENTITY_RESOLUTION_ACCEPTANCE === '1';
const suite = enabled ? describe : describe.skip;
const model = process.env.IDENTITY_ACCEPTANCE_MODEL || OLLAMA_GENERAL_MODEL;
const extendedCapacity =
  process.env.IDENTITY_ACCEPTANCE_EXTENDED_CAPACITY === '1';
const caseTimeoutMs = extendedCapacity ? 660_000 : 180_000;

// Diagnostic semantic evaluation only: production wire settings and strict
// resolver validation, with a longer wait for an occupied local model slot.
async function generateWithExtendedCapacity(
  prompt: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const budget = calculateOllamaContextBudget(
    prompt,
    'commitmentReconciliation',
  );
  const deadline = createOllamaGenerationDeadline({
    capacityTimeoutMs: 300_000,
    idleTimeoutMs: 60_000,
    activeTimeoutMs: getOllamaActiveGenerationTimeoutMs(budget.num_predict),
    callerSignal: signal,
  });
  const started = Date.now();
  let firstPacketMs: number | null = null;
  let answer = '';
  let pending = '';
  let completed = false;
  const consume = (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const packet = JSON.parse(line);
      if (packet.error) throw new Error('notes_provider_error');
      if (packet.done === true) {
        completed = true;
        if (packet.done_reason === 'length')
          throw new Error('commitment_response_incomplete');
      }
      if (typeof packet.response === 'string') answer += packet.response;
    }
  };
  try {
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: deadline.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: { ...budget, temperature: 0, num_thread: 8 },
        keep_alive: '1h',
        format: toOllamaCommitmentSchema(schema),
        think: false,
      }),
    });
    if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
    if (!response.body) throw new Error('commitment_response_incomplete');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        firstPacketMs ??= Date.now() - started;
        deadline.recordProgress();
        consume(decoder.decode(value, { stream: true }));
      }
      consume(decoder.decode());
      if (pending.trim()) consume('\n');
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (!completed) throw new Error('commitment_response_incomplete');
    return answer;
  } finally {
    deadline.dispose();
    console.log(
      JSON.stringify({
        event: 'identity-extended-capacity-metrics',
        capacityTimeoutMs: 300_000,
        firstPacketMs,
        elapsedMs: Date.now() - started,
        completed,
        answerChars: answer.length,
      }),
    );
  }
}
const personA = { id: 'person-rowan', name: 'Rowan Vale' };
const personB = { id: 'person-morgan', name: 'Morgan Lake' };
const binding = (personId = personA.id): IdentityBinding => ({
  speaker: 'Speaker 1',
  personId,
  individual: true,
  source: 'user',
  sourceRevision: 'fixture-v1',
  evidence: [],
});

describe.skipIf(process.env.RUN_IDENTITY_TRANSPORT_DIAGNOSTIC !== '1')(
  'identity source prompt transport diagnostic',
  () => {
    for (const endpoint of ['generate', 'chat'] as const) {
      it(endpoint, async () => {
        const fixture = cases[0];
        const context: IdentityContext = {
          meetingId: 'transport-diagnostic',
          sourceRevision: 'fixture-v1',
          people: [personA, personB],
          turns: fixture.turns,
          bindings: fixture.bindings ?? [],
          capture: { origin: 'unknown', selfPersonId: null },
        };
        const request = buildIdentityResolutionRequest(
          {
            text: fixture.text,
            ownerLabel: fixture.ownerLabel,
            evidence: null,
          },
          context,
        );
        const schemaVariant = process.env.IDENTITY_DIAGNOSTIC_SCHEMA ?? 'full';
        const withoutBounds = (value: unknown): unknown =>
          Array.isArray(value)
            ? value.map(withoutBounds)
            : value && typeof value === 'object'
              ? Object.fromEntries(
                  Object.entries(value)
                    .filter(
                      ([key]) =>
                        ![
                          'minLength',
                          'maxLength',
                          'minItems',
                          'maxItems',
                        ].includes(key),
                    )
                    .map(([key, child]) => [key, withoutBounds(child)]),
                )
              : value;
        const format =
          schemaVariant === 'json'
            ? 'json'
            : schemaVariant === 'unbounded'
              ? withoutBounds(request.schema)
              : request.schema;
        const started = Date.now();
        const controller = new AbortController();
        const deadline = setTimeout(
          () => controller.abort(new Error('diagnostic_deadline')),
          60_000,
        );
        let firstPacketMs: number | null = null;
        let answer = '';
        let thinkingChars = 0;
        let done = false;
        let error: string | null = null;
        console.log(
          JSON.stringify({
            event: 'identity-transport-start',
            endpoint,
            model,
            promptChars: request.prompt.length,
            schemaVariant,
          }),
        );
        try {
          const response = await fetch(
            `http://127.0.0.1:11434/api/${endpoint}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                model,
                ...(endpoint === 'generate'
                  ? { prompt: request.prompt }
                  : { messages: [{ role: 'user', content: request.prompt }] }),
                format,
                think: false,
                stream: true,
                options: {
                  ...calculateOllamaContextBudget(
                    request.prompt,
                    'commitmentReconciliation',
                  ),
                  temperature: 0,
                  num_thread: 8,
                },
                keep_alive: '1h',
              }),
            },
          );
          if (!response.ok || !response.body)
            throw new Error(
              `HTTP ${response.status}: ${await response.text()}`,
            );
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = '';
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            firstPacketMs ??= Date.now() - started;
            pending += decoder.decode(chunk.value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines.filter((line) => line.trim())) {
              const packet = JSON.parse(line);
              if (packet.error) throw new Error(String(packet.error));
              answer +=
                endpoint === 'generate'
                  ? (packet.response ?? '')
                  : (packet.message?.content ?? '');
              thinkingChars += String(
                endpoint === 'generate'
                  ? (packet.thinking ?? '')
                  : (packet.message?.thinking ?? ''),
              ).length;
              done ||= packet.done === true;
            }
          }
          expect(done).toBe(true);
          expect(JSON.parse(answer).status).toBe('resolved');
        } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure);
          throw failure;
        } finally {
          clearTimeout(deadline);
          console.log(
            JSON.stringify({
              event: 'identity-transport-result',
              endpoint,
              model,
              firstPacketMs,
              elapsedMs: Date.now() - started,
              done,
              thinkingChars,
              schemaVariant,
              answer,
              error,
            }),
          );
        }
      }, 65_000);
    }
  },
);
type FrozenCase = {
  name: string;
  text: string;
  ownerLabel: string | null;
  turns: IdentityContext['turns'];
  bindings?: IdentityBinding[];
  people?: IdentityContext['people'];
  capture?: IdentityContext['capture'];
  expectedKey: string | null;
  expectedStatus?: OwnerResolution['status'][];
};

describe.skipIf(process.env.RUN_IDENTITY_GRAMMAR_DIAGNOSTIC !== '1')(
  'identity grammar initialization controls',
  () => {
    for (const property of [
      'personId',
      'reason',
      'evidence',
      'identityEvidence',
      'full',
    ] as const) {
      it(property, async () => {
        const fixture = cases[0];
        const { schema } = buildIdentityResolutionRequest(
          {
            text: fixture.text,
            ownerLabel: fixture.ownerLabel,
            evidence: null,
          },
          {
            meetingId: 'grammar-control',
            sourceRevision: 'fixture-v1',
            turns: fixture.turns,
            people: [personA, personB],
            bindings: fixture.bindings ?? [],
            capture: { origin: 'unknown', selfPersonId: null },
          },
        );
        const properties = schema.properties as Record<string, unknown>;
        const format =
          property === 'full'
            ? schema
            : {
                type: 'object',
                additionalProperties: false,
                required: [property],
                properties: { [property]: properties[property] },
              };
        const started = Date.now();
        console.log(
          JSON.stringify({ event: 'identity-grammar-start', property }),
        );
        try {
          const response = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(30_000),
            body: JSON.stringify({
              model,
              prompt:
                'Return a minimal JSON object matching the schema. Use null for personId and speaker, empty evidence arrays, unresolved status, ambiguous ownershipKind, and reason "test".',
              format,
              think: false,
              stream: false,
              options: { num_ctx: 4096, num_predict: 96, temperature: 0 },
            }),
          });
          const raw = await response.text();
          console.log(
            JSON.stringify({
              event: 'identity-grammar-result',
              property,
              elapsedMs: Date.now() - started,
              http: response.status,
              raw,
            }),
          );
          expect(response.ok, raw).toBe(true);
        } catch (error) {
          console.log(
            JSON.stringify({
              event: 'identity-grammar-failure',
              property,
              elapsedMs: Date.now() - started,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          throw error;
        }
      }, 35_000);
    }
  },
);

const cases: FrozenCase[] = [
  {
    name: 'bound-first-person',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Speaker 1',
    expectedKey: `person:${personA.id}`,
    bindings: [binding()],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'I will publish the Cedar release checklist tomorrow.',
      },
    ],
  },
  {
    name: 'named-assignee-not-the-speaker',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Speaker 1',
    expectedKey: `person:${personB.id}`,
    bindings: [binding()],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'Morgan Lake agreed to publish the Cedar release checklist tomorrow. I will only review the checklist after Morgan publishes it.',
      },
    ],
  },
  {
    name: 'source-self-introduction',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Speaker 1',
    expectedKey: `person:${personA.id}`,
    turns: [
      { id: 't0', speaker: 'Speaker 1', text: 'I am Rowan Vale.' },
      {
        id: 't1',
        speaker: 'Speaker 1',
        text: 'I will publish the Cedar release checklist tomorrow.',
      },
    ],
  },
  {
    name: 'imported-Me-has-no-profile-identity',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Me',
    expectedKey: null,
    capture: { origin: 'imported', selfPersonId: personA.id },
    turns: [
      {
        id: 't0',
        speaker: 'Me',
        text: 'I will publish the Cedar release checklist tomorrow.',
      },
    ],
  },
  {
    name: 'duplicate-display-names',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: personA.name,
    expectedKey: null,
    people: [personA, { id: 'another-rowan', name: personA.name }],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'I am Rowan Vale, and I will publish the Cedar release checklist tomorrow.',
      },
    ],
  },
  {
    name: 'quotation-is-not-speaker-obligation',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Speaker 1',
    expectedKey: null,
    bindings: [binding()],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'The training guide uses this fictional example: "I will publish the Cedar release checklist tomorrow." I am reading the example, not agreeing to publish anything.',
      },
    ],
  },
  {
    name: 'collective-is-not-individual',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Speaker 1',
    expectedKey: null,
    bindings: [binding()],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'We as the whole release team are collectively responsible for publishing the Cedar release checklist. No individual owner has been chosen.',
      },
    ],
  },
  {
    name: 'ambiguous-pronoun',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'They',
    expectedKey: null,
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'They said they would publish the Cedar release checklist, but I do not know which person they meant.',
      },
    ],
  },
  {
    name: 'conflicting-speaker-corrections',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Speaker 1',
    expectedKey: null,
    expectedStatus: ['unresolved', 'conflicting'],
    bindings: [binding(personA.id), binding(personB.id)],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'I will publish the Cedar release checklist tomorrow.',
      },
    ],
  },
  {
    name: 'mixed-remote-channel',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Them',
    expectedKey: null,
    bindings: [
      { ...binding(), speaker: 'Them', personId: null, individual: false },
    ],
    turns: [
      {
        id: 't0',
        speaker: 'Them',
        text: 'I will publish the Cedar release checklist tomorrow.',
      },
    ],
  },
  {
    name: 'request-without-acceptance',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: personA.name,
    expectedKey: null,
    bindings: [binding(personB.id)],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'Rowan Vale, could you publish the Cedar release checklist tomorrow? We still need your agreement before assigning that to you.',
      },
    ],
  },
  {
    name: 'unique-declared-profile-alias',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Rook',
    expectedKey: `person:${personA.id}`,
    people: [{ ...personA, aliases: ['Rook'] }, personB],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'Rook agreed to publish the Cedar release checklist tomorrow.',
      },
    ],
  },
  {
    name: 'shared-profile-alias-is-ambiguous',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Rook',
    expectedKey: null,
    people: [
      { ...personA, aliases: ['Rook'] },
      { ...personB, aliases: ['Rook'] },
    ],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'Rook agreed to publish the Cedar release checklist tomorrow.',
      },
    ],
  },
  {
    name: 'validated-local-capture',
    text: 'Publish the Cedar release checklist.',
    ownerLabel: 'Speaker 1',
    expectedKey: `person:${personA.id}`,
    capture: { origin: 'local', selfPersonId: personA.id },
    bindings: [
      {
        ...binding(),
        source: 'capture',
        captureEvidence: {
          origin: 'local',
          selfPersonId: personA.id,
          attributionSource: 'local_diarization_acoustic',
          confidence: 0.95,
          mappingApplied: true,
          sourceRevision: 'fixture-v1',
        },
      },
    ],
    turns: [
      {
        id: 't0',
        speaker: 'Speaker 1',
        text: 'I will publish the Cedar release checklist tomorrow.',
      },
    ],
  },
];

const results: Array<{
  case: string;
  expected: string | null;
  actual: string | null;
  status: string;
  passed: boolean;
  wrongPerson: boolean;
  error?: string;
  elapsedMs: number;
}> = [];

suite('configured local-model source identity acceptance', () => {
  let provider: UnifiedLLMProvider;
  beforeAll(async () => {
    const response = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`Local Ollama unavailable: ${response.status}`);
    const data = (await response.json()) as {
      models?: Array<{ name: string; digest: string }>;
    };
    const installed = data.models?.find(
      (candidate) => candidate.name === model,
    );
    if (!installed)
      throw new Error(
        `Required local model is not installed: ${model}; no model pull or fallback is permitted.`,
      );
    provider = new UnifiedLLMProvider('ollama', { ollama_model: model });
    console.log(
      JSON.stringify({
        event: 'identity-acceptance-model',
        model,
        digest: installed.digest,
        cases: cases.length,
        mode: extendedCapacity
          ? 'extended-capacity-semantic-evaluation'
          : 'production-provider',
      }),
    );
  }, 15_000);

  afterAll(() => {
    console.log(
      JSON.stringify({
        event: 'identity-acceptance-summary',
        model,
        completed: results.length,
        total: cases.length,
        mode: extendedCapacity
          ? 'extended-capacity-semantic-evaluation'
          : 'production-provider',
        successes: results.filter((result) => result.passed).length,
        wrongPerson: results.filter((result) => result.wrongPerson).length,
        errors: results.filter((result) => result.error).length,
        results,
      }),
    );
  });

  for (const fixture of cases) {
    it(
      fixture.name,
      async () => {
        const context: IdentityContext = {
          meetingId: `acceptance-${fixture.name}`,
          sourceRevision: 'fixture-v1',
          people: fixture.people ?? [personA, personB],
          turns: fixture.turns,
          bindings: fixture.bindings ?? [],
          capture: fixture.capture ?? { origin: 'unknown', selfPersonId: null },
        };
        const input: CommitmentOwnerInput = {
          text: fixture.text,
          ownerLabel: fixture.ownerLabel,
          evidence: null,
        };
        const started = Date.now();
        let calls = 0;
        const expectedStatus = fixture.expectedStatus ?? [
          fixture.expectedKey === null ? 'unresolved' : 'resolved',
        ];
        const promptHashes = [
          buildIdentityResolutionRequest(input, context),
          buildIdentityVerificationRequest(input, context),
        ].map((request) =>
          createHash('sha256').update(request.prompt).digest('hex'),
        );
        console.log(
          JSON.stringify({
            event: 'identity-case-start',
            case: fixture.name,
            expected: fixture.expectedKey,
            expectedStatus,
            promptHashes,
          }),
        );
        const heartbeat = setInterval(
          () =>
            console.log(
              JSON.stringify({
                event: 'identity-case-progress',
                case: fixture.name,
                calls,
                elapsedMs: Date.now() - started,
              }),
            ),
          20_000,
        );
        try {
          const actual = await resolveCommitmentOwner(
            input,
            context,
            async (prompt, responseSchema, signal) => {
              calls++;
              const raw = extendedCapacity
                ? await generateWithExtendedCapacity(
                    prompt,
                    responseSchema,
                    signal,
                  )
                : await provider.synthesizeKnowledgeDocument(prompt, {
                    purpose: 'commitmentReconciliation',
                    responseSchema,
                    signal,
                  });
              console.log(
                JSON.stringify({
                  event: 'identity-model-response',
                  case: fixture.name,
                  round: calls,
                  raw,
                }),
              );
              return raw;
            },
            AbortSignal.timeout(caseTimeoutMs),
          );
          const passed =
            actual.ownerKey === fixture.expectedKey &&
            expectedStatus.includes(actual.status);
          const result = {
            case: fixture.name,
            expected: fixture.expectedKey,
            actual: actual.ownerKey,
            status: actual.status,
            passed,
            wrongPerson:
              actual.ownerKey !== null &&
              actual.ownerKey !== fixture.expectedKey,
            elapsedMs: Date.now() - started,
          };
          results.push(result);
          console.log(
            JSON.stringify({
              event: 'identity-case-result',
              ...result,
              reason: actual.reason,
              evidence: actual.evidence,
              identityProvenance: actual.identityProvenance,
            }),
          );
          expect(actual.ownerKey, `${fixture.name}: ${actual.reason}`).toBe(
            fixture.expectedKey,
          );
          expect(expectedStatus, fixture.name).toContain(actual.status);
        } catch (error) {
          if (!results.some((result) => result.case === fixture.name)) {
            const result = {
              case: fixture.name,
              expected: fixture.expectedKey,
              actual: null,
              status: 'error',
              passed: false,
              wrongPerson: false,
              error: error instanceof Error ? error.message : String(error),
              elapsedMs: Date.now() - started,
            };
            results.push(result);
            console.log(
              JSON.stringify({ event: 'identity-case-result', ...result }),
            );
          }
          throw error;
        } finally {
          clearInterval(heartbeat);
        }
      },
      caseTimeoutMs + 5_000,
    );
  }
});
