import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import { buildNotesResponseSchema } from '../../electron/llm/meetingNotesSchema';
import {
  createNotesSource,
  resolveSourceSpan,
} from '../../electron/llm/meetingNotesSource';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { OLLAMA_GENERAL_MODEL } from '../../src/utils/ollamaModels';
import { meetingNotesFidelityHoldoutCases } from './fixtures/meetingNotesFidelityHoldoutCases';
import { meetingNotesGemmaReliabilityCases } from './fixtures/meetingNotesGemmaReliabilityCases';
import type { MeetingNotesLocalGuardrailsCase } from './fixtures/meetingNotesLocalGuardrailsCases';

const suite =
  process.env.RUN_MEETING_NOTES_PROVIDER_BENCHMARK === '1'
    ? describe
    : describe.skip;
const model = process.env.OLLAMA_BENCHMARK_MODEL || OLLAMA_GENERAL_MODEL;
const seed = Number(process.env.MEETING_NOTES_ACCEPTANCE_SEED ?? 41);
const reviewProtocol = process.env.MEETING_NOTES_REVIEW_PROTOCOL || 'audit';
const caseSet = process.env.MEETING_NOTES_ACCEPTANCE_CASE_SET || 'fixed';
if (!['fixed', 'heldout', 'private'].includes(caseSet))
  throw new Error(
    'MEETING_NOTES_ACCEPTANCE_CASE_SET must be fixed, heldout or private',
  );
// Private source stays outside the repository; redirect this suite's logs to
// an untracked local path too. Never use production generation/publication IPC.
const cases: MeetingNotesLocalGuardrailsCase[] =
  caseSet === 'private'
    ? JSON.parse(
        readFileSync(
          process.env.MEETING_NOTES_ACCEPTANCE_FIXTURE_PATH!,
          'utf8',
        ),
      )
    : caseSet === 'heldout'
      ? meetingNotesFidelityHoldoutCases
      : meetingNotesGemmaReliabilityCases;

suite(
  'local guardrails mechanical acceptance (source fidelity reviewed separately)',
  () => {
    for (const fixture of cases) {
      const timeoutMs = fixture.id.startsWith('long-') ? 600_000 : 270_000;
      const testTimeoutMs = timeoutMs + 30_000;
      it(
        `${fixture.id} (${reviewProtocol}, seed ${seed})`,
        async () => {
          if (reviewProtocol !== 'audit' && reviewProtocol !== 'editor')
            throw new Error(
              'MEETING_NOTES_REVIEW_PROTOCOL must be audit or editor',
            );
          if (!Number.isInteger(seed))
            throw new Error('MEETING_NOTES_ACCEPTANCE_SEED must be an integer');

          const source = createNotesSource(
            JSON.stringify({ segments: fixture.segments }),
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
          const config = {
            case: fixture.id,
            provider: 'ollama',
            model,
            reviewProtocol,
            seed,
            contextTokens: 16384,
            structuredThinking: false,
            responseFormat: 'json_schema',
            timeoutMs,
          };
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), config.timeoutMs);
          const started = Date.now();
          const stages: string[] = [];
          let analysis: AnalysisDocumentV3 | undefined;
          let counts: Record<string, number> | undefined;
          let phase = 'generation';
          console.log(
            JSON.stringify({
              localGuardrailsAcceptance: {
                event: 'start',
                ...config,
                source,
                mechanicalContract: fixture.mechanicalContract,
                reviewCriteria: fixture.reviewCriteria,
                sourceFidelity: 'requires_independent_review',
              },
            }),
          );
          try {
            analysis = await generateMeetingNotes({
              source,
              context: {
                userNotes: '',
                template: 'auto',
                trustedUserTerms: [],
                entityHints: [],
              },
              provider: 'ollama',
              model,
              contextTokens: config.contextTokens,
              signal: controller.signal,
              reviewProtocol:
                reviewProtocol === 'editor' ? 'editor' : undefined,
              generate: async (request) => {
                stages.push(request.task);
                const attempt = stages.length;
                const attemptStarted = Date.now();
                const wire = createNotesWireRequest(
                  request.prompt,
                  request.sourceSpans ?? [],
                );
                const schema = buildNotesResponseSchema(
                  request.responseContract,
                  wire.sourceLabels,
                );
                const attemptConfig = {
                  ...config,
                  attempt,
                  task: request.task,
                  stages: [...stages],
                  contextTokens: request.contextTokens,
                  outputTokens: request.outputTokens,
                  responseContract: request.responseContract,
                  promptSha256: createHash('sha256')
                    .update(wire.prompt)
                    .digest('hex'),
                  schemaSha256: createHash('sha256')
                    .update(JSON.stringify(schema))
                    .digest('hex'),
                };
                let raw: string | undefined;
                try {
                  raw = await transport.generateResumableAnalysisText({
                    prompt: wire.prompt,
                    task: request.task,
                    jsonMode: true,
                    notesResponseSchema: schema,
                    signal: request.signal,
                    notesBudget: {
                      contextTokens: request.contextTokens,
                      outputTokens: request.outputTokens,
                    },
                  });
                  // Always retain raw output before decoding, including invalid
                  // responses and repairs. Structural success is not fidelity.
                  console.log(
                    JSON.stringify({
                      localGuardrailsAcceptance: {
                        event: 'raw_attempt',
                        ...attemptConfig,
                        latencyMs: Date.now() - attemptStarted,
                        raw,
                      },
                    }),
                  );
                  return wire.decode(raw);
                } catch (error) {
                  console.log(
                    JSON.stringify({
                      localGuardrailsAcceptance: {
                        event: 'attempt_failure',
                        ...attemptConfig,
                        latencyMs: Date.now() - attemptStarted,
                        phase: raw === undefined ? 'transport' : 'decode',
                        raw: raw ?? null,
                        error: String(error),
                      },
                    }),
                  );
                  throw error;
                }
              },
            });

            phase = 'mechanical_checks';
            const topicActions = analysis.topics.flatMap(
              (topic) => topic.action_items,
            );
            const topicDecisions = analysis.topics.flatMap(
              (topic) => topic.decisions,
            );
            const questions = analysis.topics.flatMap(
              (topic) => topic.open_questions,
            );
            counts = {
              aggregateActions: analysis.all_action_items.length,
              topicActions: topicActions.length,
              aggregateDecisions: analysis.all_decisions.length,
              topicDecisions: topicDecisions.length,
              questions: questions.length,
            };
            const contract = fixture.mechanicalContract;
            for (const items of [analysis.all_action_items, topicActions]) {
              const range =
                typeof contract.actions === 'number'
                  ? { min: contract.actions, max: contract.actions }
                  : contract.actions;
              expect(
                items.length,
                'Mechanical action count minimum',
              ).toBeGreaterThanOrEqual(range.min);
              expect(
                items.length,
                'Mechanical action count maximum',
              ).toBeLessThanOrEqual(range.max);
              for (const item of items) {
                if (contract.actionOwner !== undefined)
                  expect(item.assignee, 'Mechanical owner field').toBe(
                    contract.actionOwner,
                  );
                if (contract.actionDue !== undefined)
                  expect(item.due, 'Mechanical deadline field').toMatch(
                    new RegExp(`\\b${contract.actionDue}\\b`, 'i'),
                  );
              }
            }
            for (const items of [analysis.all_decisions, topicDecisions]) {
              expect(
                items.length,
                'Mechanical decision count minimum',
              ).toBeGreaterThanOrEqual(contract.decisions.min);
              expect(
                items.length,
                'Mechanical decision count maximum',
              ).toBeLessThanOrEqual(contract.decisions.max);
            }
            expect(questions, 'Mechanical open-question count').toHaveLength(
              contract.questions,
            );
            const provenance = analysis.generation_metadata?.source_provenance;
            expect(
              provenance?.source_revision,
              'Mechanical source revision',
            ).toBe(source.revision);
            for (const block of Object.values(provenance?.blocks ?? {})) {
              for (const span of block.sources)
                expect(
                  resolveSourceSpan(source, span).trim(),
                  'Mechanical exact source-span validity (not entailment)',
                ).not.toBe('');
            }
            console.log(
              JSON.stringify({
                localGuardrailsAcceptance: {
                  event: 'final',
                  ...config,
                  latencyMs: Date.now() - started,
                  stages,
                  counts,
                  analysis,
                  mechanicalChecks: 'passed',
                  sourceFidelity: 'requires_independent_review',
                },
              }),
            );
          } catch (error) {
            console.log(
              JSON.stringify({
                localGuardrailsAcceptance: {
                  event: 'failure',
                  ...config,
                  latencyMs: Date.now() - started,
                  stages,
                  phase,
                  counts: counts ?? null,
                  analysis: analysis ?? null,
                  mechanicalChecks: analysis ? 'failed' : 'not_run',
                  sourceFidelity: 'requires_independent_review',
                  error: String(error),
                },
              }),
            );
            throw error;
          } finally {
            clearTimeout(timer);
          }
        },
        testTimeoutMs,
      );
    }
  },
);
