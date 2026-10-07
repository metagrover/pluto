import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompletedWriter } from '../../electron/llm/meetingNotesContinuation';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import * as transport from '../../electron/llm/ollamaHttpTransport';
import {
  UnifiedLLMProvider,
  releaseIdleOllamaModel,
} from '../../electron/llm/unifiedProvider';

const powerBlocker = vi.hoisted(() => ({
  start: vi.fn(() => 7),
  stop: vi.fn(),
}));
vi.mock('electron', () => ({ powerSaveBlocker: powerBlocker }));

vi.mock('../../electron/llm/ollamaHttpTransport', () => ({
  ollamaHttpFetch: vi.fn(),
  ollamaHttpStream: vi.fn(),
}));

const electronDescriptor = Object.getOwnPropertyDescriptor(
  process.versions,
  'electron',
);
let bodies: Array<Record<string, any>>;
const source =
  'BEGIN SOURCE DATA\n["R0","Milo","I will send the outline."]\nEND SOURCE DATA';
const writer = `Write notes.\n${source}`;
const editor = `Review notes.\n${source}\nBEGIN DRAFT DATA\n{}\nEND DRAFT DATA`;

beforeEach(() => {
  bodies = [];
  powerBlocker.start.mockClear();
  powerBlocker.stop.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/ps')) return Response.json({ models: [] });
      bodies.push(JSON.parse(init.body));
      return new Response(
        `${JSON.stringify({ message: { content: '{"sections":[]}' }, done: true, done_reason: 'stop', prompt_eval_count: 123 })}\n`,
      );
    }),
  );
});
afterEach(() => {
  if (electronDescriptor)
    Object.defineProperty(process.versions, 'electron', electronDescriptor);
  else Reflect.deleteProperty(process.versions, 'electron');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const generate = (
  provider: UnifiedLLMProvider,
  task: string,
  prompt: string,
  notesContinuation: { previous?: CompletedWriter },
) =>
  (
    provider as unknown as {
      generateText(input: Record<string, unknown>): Promise<string>;
    }
  ).generateText({
    task,
    prompt,
    jsonMode: true,
    notesModel: 'gemma4:12b',
    notesBudget: { contextTokens: 16384, outputTokens: 100 },
    notesContinuation,
  });

it('continues only a completed same-source writer and retains the current editor draft', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const state: { previous?: CompletedWriter } = {};
  await generate(provider, 'notesWriter', writer, state);
  expect(state.previous?.inputTokens).toBe(123);
  await generate(provider, 'notesAudit', editor, state);
  expect(bodies[0].keep_alive).toBe('2h');
  expect(bodies[1].messages).toHaveLength(3);
  expect(bodies[1].messages[0]).toEqual(bodies[0].messages[0]);
  expect(bodies[1].messages[1].content).toBe('{"sections":[]}');
  expect(bodies[1].messages[2].content).toContain('BEGIN DRAFT DATA\n{}');
  await generate(provider, 'notesAudit', editor, {});
  expect(bodies[2].messages).toEqual([{ role: 'user', content: editor }]);
});

it('uses the original editor request when its source differs from the last chunk', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const state = {};
  await generate(provider, 'notesWriter', writer, state);
  const changed = editor.replace('send the outline', 'cancel the outline');
  await generate(provider, 'notesAudit', changed, state);
  expect(bodies[1].messages).toEqual([{ role: 'user', content: changed }]);
});

it('does not seed reuse from a truncated writer response', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const state: { previous?: CompletedWriter } = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) =>
      String(url).endsWith('/api/ps')
        ? Response.json({ models: [] })
        : new Response(
            `${JSON.stringify({ message: { content: '{}' }, done: true, done_reason: 'length' })}\n`,
          ),
    ),
  );
  await expect(
    generate(provider, 'notesWriter', writer, state),
  ).rejects.toThrow('notes_output_truncated');
  expect(state.previous).toBeUndefined();
});

it('discards a writer that needed repair before continuing its editor', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const state = {};
  await generate(provider, 'notesWriter', writer, state);
  await generate(
    provider,
    'notesWriter',
    'BEGIN REJECTED RESPONSE DATA\nInvalid writer JSON.',
    state,
  );
  await generate(provider, 'notesAudit', editor, state);
  expect(bodies[2].messages).toEqual([{ role: 'user', content: editor }]);
});

it('retains the last completed chunk through earlier unmatched reviews', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const state = {};
  await generate(provider, 'notesWriter', writer, state);
  const earlier = editor.replace('send the outline', 'book the room');
  await generate(provider, 'notesAudit', earlier, state);
  await generate(provider, 'notesAudit', editor, state);
  expect(bodies.map((body) => body.messages.length)).toEqual([1, 1, 3]);
  expect(bodies[2].messages[0]).toEqual(bodies[0].messages[0]);
});

it('reuses each matching chunk after all bounded writers finish', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const state = {};
  const phrases = ['send the outline', 'book the room', 'publish the report'];
  for (const phrase of phrases)
    await generate(
      provider,
      'notesWriter',
      writer.replace('send the outline', phrase),
      state,
    );
  for (const phrase of phrases)
    await generate(
      provider,
      'notesAudit',
      editor.replace('send the outline', phrase),
      state,
    );
  expect(bodies.map((body) => body.messages.length)).toEqual([
    1, 1, 1, 3, 3, 3,
  ]);
  for (let index = 0; index < 3; index++)
    expect(bodies[index + 3].messages[0]).toEqual(bodies[index].messages[0]);
});

it('enables reuse for a compact direct run and keeps separate runs independent', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/ps')) return Response.json({ models: [] });
      const body = JSON.parse(init.body);
      bodies.push(body);
      const prompt = body.messages.at(-1).content;
      const draft = prompt.includes('BEGIN DRAFT DATA')
        ? {
            ...JSON.parse(
              prompt.match(/BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/)[1],
            ),
            title: { text: 'Outline', sources: ['R0'] },
            terminology: [],
            dispositions: [],
          }
        : {
            title: { text: 'Outline', sources: ['R0'] },
            sections: [
              {
                title: 'Outline',
                items: [
                  {
                    kind: 'action',
                    text: 'Send the outline',
                    owner: 'Milo',
                    due: null,
                    sources: ['R0'],
                  },
                ],
              },
            ],
          };
      return new Response(
        `${JSON.stringify({ message: { content: JSON.stringify(draft) }, done: true, done_reason: 'stop' })}\n`,
      );
    }),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'gemma4:12b',
  });
  const source = createNotesSource(
    JSON.stringify({
      segments: [{ speaker: 'Milo', text: 'I will send the outline.' }],
    }),
  );
  for (const reuseWriterContext of [undefined, false]) {
    const result = await provider.generateStructuredAnalysis('', '', 'auto', {
      source,
      compactWriterContract: true,
      reuseWriterContext,
    });
    expect(result.all_action_items).toEqual([
      expect.objectContaining({ text: 'Send the outline', assignee: 'Milo' }),
    ]);
  }
  expect(bodies.map((body) => body.messages.length)).toEqual([1, 3, 1, 1]);
});

const electronProvider = () => {
  Object.defineProperty(process.versions, 'electron', {
    value: 'test',
    configurable: true,
  });
  vi.mocked(transport.ollamaHttpFetch).mockImplementation(async (url, init) => {
    if (url.endsWith('/api/ps')) return Response.json({ models: [] });
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ response: 'Outline', done: true });
  });
  return new UnifiedLLMProvider('ollama', { ollama_model: 'gemma4:12b' });
};

it('prevents idle suspension only during notes inference and releases after failure', async () => {
  const provider = electronProvider();
  vi.mocked(transport.ollamaHttpStream).mockImplementation(
    async (_url, _init, consume) => {
      expect(powerBlocker.start).toHaveBeenCalledWith('prevent-app-suspension');
      expect(powerBlocker.stop).not.toHaveBeenCalled();
      consume(
        `${JSON.stringify({ message: { content: '{}' }, done: true, done_reason: 'stop' })}\n`,
      );
      return { ok: true, status: 200, statusText: 'OK', errorBody: '' };
    },
  );
  await generate(provider, 'notesWriter', writer, {});
  expect(powerBlocker.stop).toHaveBeenCalledWith(7);
  powerBlocker.stop.mockClear();
  vi.mocked(transport.ollamaHttpStream).mockRejectedValueOnce(
    new Error('request_failed'),
  );
  await expect(generate(provider, 'notesWriter', writer, {})).rejects.toThrow(
    'request_failed',
  );
  expect(powerBlocker.start).toHaveBeenCalledTimes(2);
  expect(powerBlocker.stop).toHaveBeenCalledTimes(1);
});

it('releases an idle model under pressure, but retains a recently used model', async () => {
  vi.useFakeTimers();
  const provider = electronProvider();
  await provider.generateTitle('Outline discussion');
  await releaseIdleOllamaModel();
  expect(bodies.filter((body) => body.keep_alive === 0)).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(60_001);
  await releaseIdleOllamaModel();
  expect(bodies.filter((body) => body.keep_alive === 0)).toHaveLength(1);
  await releaseIdleOllamaModel();
  expect(bodies.filter((body) => body.keep_alive === 0)).toHaveLength(1);
});

it('does not unload a long-running request or the model just used by it', async () => {
  vi.useFakeTimers();
  const provider = electronProvider();
  let complete!: (response: Response) => void;
  vi.mocked(transport.ollamaHttpFetch).mockImplementation(async (url, init) => {
    if (url.endsWith('/api/ps')) return Response.json({ models: [] });
    bodies.push(JSON.parse(String(init?.body)));
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  });
  const generation = provider.generateTitle('Outline discussion');
  await vi.waitFor(() => expect(bodies).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(60_001);
  const cleanup = releaseIdleOllamaModel();
  expect(bodies).toHaveLength(1);
  complete(Response.json({ response: 'Outline', done: true }));
  await generation;
  await vi.advanceTimersByTimeAsync(0);
  await cleanup;
  expect(bodies.filter((body) => body.keep_alive === 0)).toHaveLength(0);
});

it('releases the owned model on shutdown without waiting for the idle interval', async () => {
  const provider = electronProvider();
  await provider.generateTitle('Outline discussion');
  await releaseIdleOllamaModel(0);
  expect(bodies.filter((body) => body.keep_alive === 0)).toHaveLength(1);
});
