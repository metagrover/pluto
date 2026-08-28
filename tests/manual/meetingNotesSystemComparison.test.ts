import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { meetingNotesGemmaReliabilityCases } from './fixtures/meetingNotesGemmaReliabilityCases';

// Opt-in, synthetic, local-only. Run systems serially and keep every log event.
// A returned document is not a fidelity pass; independent review uses the same
// original criteria for both systems. Never call production publication IPC.
const enabled = process.env.RUN_MEETING_NOTES_SYSTEM_COMPARISON === '1';
const suite = enabled ? describe : describe.skip;
const system = process.env.MEETING_NOTES_COMPARISON_SYSTEM || 'candidate';
const dryRun = process.env.MEETING_NOTES_COMPARISON_DRY_RUN === '1';
const seed = 41;
const timeoutMs = 600_000;
const model = system === 'previous' ? 'qwen3.5:9b' : 'gemma4:12b';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const emit = (event: Record<string, unknown>) =>
  console.log(
    JSON.stringify({ notesSystemComparison: { system, model, ...event } }),
  );

const loadProvider = async () => {
  if (system === 'candidate') return UnifiedLLMProvider;
  if (system !== 'previous') throw new Error('Unknown comparison system');
  const root = process.env.MEETING_NOTES_PREVIOUS_CHECKOUT;
  if (!root || !path.isAbsolute(root))
    throw new Error('Set an absolute MEETING_NOTES_PREVIOUS_CHECKOUT');
  const previous = await import(
    /* @vite-ignore */ path.join(root, 'electron/llm/unifiedProvider.ts')
  );
  expect(previous.STRUCTURED_ANALYSIS_PROMPT_VERSION).toBe('notes-v9');
  return previous.UnifiedLLMProvider as typeof UnifiedLLMProvider;
};

suite('bounded previous-system versus candidate comparison', () => {
  it('loads the selected provider without inference', async () => {
    expect(await loadProvider()).toBeTypeOf('function');
  });

  for (const fixture of meetingNotesGemmaReliabilityCases) {
    it.skipIf(dryRun)(
      fixture.id,
      async () => {
        const Provider = await loadProvider();
        const provider = new Provider('ollama', {
          ollama_model: model,
          ollama_seed: seed,
          ollama_structured_thinking: false,
        });
        const source = createNotesSource(
          JSON.stringify({ segments: fixture.segments }),
        );
        const transcript = fixture.segments
          .map((s) => `${s.speaker}: ${s.text}`)
          .join('\n');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const started = Date.now();
        let attempt = 0;
        let task = '';
        const transport = provider as unknown as {
          ollamaStream(
            endpoint: string,
            options: RequestInit,
            onChunk: (chunk: string) => void,
          ): Promise<unknown>;
          generateText(request: {
            task: string;
            prompt: string;
          }): Promise<string>;
        };
        const generateText = transport.generateText.bind(provider);
        const stream = transport.ollamaStream.bind(provider);
        transport.ollamaStream = async (endpoint, options, onChunk) => {
          const context = { case: fixture.id, attempt, task, endpoint };
          const chunks: string[] = [];
          try {
            return await stream(endpoint, options, (chunk) => {
              chunks.push(chunk);
              onChunk(chunk);
            });
          } finally {
            // Capture before the provider parser sees each chunk, including
            // partial/error responses. Do not consume or replace fetch bodies.
            emit({ event: 'raw_stream', ...context, raw: chunks.join('') });
          }
        };
        transport.generateText = async (request) => {
          controller.signal.throwIfAborted();
          attempt += 1;
          task = request.task;
          const attemptStarted = Date.now();
          const context = {
            case: fixture.id,
            attempt,
            task,
            promptSha256: sha(request.prompt),
          };
          try {
            const raw = await generateText(request);
            emit({
              event: 'raw_attempt',
              ...context,
              latencyMs: Date.now() - attemptStarted,
              raw,
            });
            return raw;
          } catch (error) {
            emit({
              event: 'attempt_failure',
              ...context,
              latencyMs: Date.now() - attemptStarted,
              error: String(error),
            });
            throw error;
          }
        };
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          if (
            /\/api\/(?:chat|generate)$/.test(String(input)) &&
            typeof init?.body === 'string'
          ) {
            const body = JSON.parse(init.body);
            emit({
              event: 'wire_request',
              case: fixture.id,
              attempt,
              task,
              actualModel: body.model,
              endpoint: new URL(String(input)).pathname,
              options: body.options,
              think: body.think,
              stream: body.stream,
              formatSha256: sha(JSON.stringify(body.format ?? null)),
              ...(body.messages
                ? { messagesSha256: sha(JSON.stringify(body.messages)) }
                : { wirePromptSha256: sha(String(body.prompt ?? '')) }),
            });
          }
          return originalFetch(input, init);
        };
        emit({
          event: 'start',
          case: fixture.id,
          seed,
          timeoutMs,
          source,
          transcriptSha256: sha(transcript),
          mechanicalContract: fixture.mechanicalContract,
          reviewCriteria: fixture.reviewCriteria,
          sourceFidelity: 'requires_independent_review',
        });
        try {
          const analysis = await provider.generateStructuredAnalysis(
            transcript,
            '',
            'auto',
            {
              signal: controller.signal,
              ...(system === 'candidate'
                ? { source, contextTokens: 16384 }
                : {}),
            },
          );
          controller.signal.throwIfAborted();
          emit({
            event: 'final',
            case: fixture.id,
            latencyMs: Date.now() - started,
            attempts: attempt,
            analysis,
            sourceFidelity: 'requires_independent_review',
          });
          expect(analysis.analysis_schema_version).toBe(3);
        } catch (error) {
          emit({
            event: 'failure',
            case: fixture.id,
            latencyMs: Date.now() - started,
            attempts: attempt,
            error: String(error),
            sourceFidelity: 'requires_independent_review',
          });
          throw error;
        } finally {
          clearTimeout(timer);
          globalThis.fetch = originalFetch;
        }
      },
      timeoutMs + 30_000,
    );
  }
});
