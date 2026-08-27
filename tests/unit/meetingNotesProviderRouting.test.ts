import { afterEach, expect, it, vi } from 'vitest';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { NotesStageCache } from '../../electron/llm/meetingNotesStageCache';
import {
  UnifiedLLMProvider,
  getOllamaTimeoutMs,
} from '../../electron/llm/unifiedProvider';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';
import kindCorrection from '../manual/fixtures/meetingNotesV10KindCorrection.json';

afterEach(() => vi.restoreAllMocks());

it('applies the captured real-model kind correction without repair or loss of discussion', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockResolvedValueOnce(JSON.stringify(kindCorrection.writer))
    .mockResolvedValueOnce(JSON.stringify(kindCorrection.audit));
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source: createNotesSource(
      JSON.stringify({ segments: kindCorrection.segments }),
    ),
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(result.all_action_items).toHaveLength(1);
  expect(result.all_action_items[0]).toMatchObject({
    assignee: 'Dana',
    due: 'Wednesday',
  });
  const narrative = result.topics
    .flatMap((topic) => [
      topic.summary,
      ...topic.key_points.map((point) => point.text),
    ])
    .join(' ');
  expect(narrative).toContain('Ava withdraws');
  expect(narrative).toContain(
    'Ben can draft the announcement if legal approves',
  );
});

it('forwards cancellation through entity extraction after publication', async () => {
  const provider = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockResolvedValue('{}');
  const signal = new AbortController().signal;
  await provider.extractEntities('Synthetic discussion', undefined, { signal });
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({ task: 'entities', signal }),
  );
});

it.each(['extractInternalSignals', 'extractEntities'] as const)(
  'does not log private malformed output from %s',
  async (method) => {
    const provider = new UnifiedLLMProvider('ollama', {});
    vi.spyOn(provider as never, 'generateText').mockRejectedValue(
      new SyntaxError('Invalid JSON near PRIVATE_MEETING_MARKER'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(provider[method]('PRIVATE_MEETING_MARKER')).rejects.toThrow(
      /failed/,
    );
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.flat().map(String).join(' ')).not.toContain(
      'PRIVATE_MEETING_MARKER',
    );
  },
);

it.each(['notesWriter', 'notesAudit', 'notesMerge'])(
  'gives %s the established analysis capacity deadline',
  (task) => {
    expect(getOllamaTimeoutMs(task)).toBe(getOllamaTimeoutMs('topicAnalysis'));
  },
);

it.each(['ollama', 'openai', 'claude', 'gemini'] as const)(
  'routes raw and indexed %s callers through the same two-stage contract',
  async (kind) => {
    const fixture = makeDirectNotesFixture();
    const provider = new UnifiedLLMProvider(kind, {});
    const generate = vi
      .spyOn(provider as never, 'generateText')
      .mockResolvedValueOnce(JSON.stringify(fixture.draft))
      .mockResolvedValueOnce(JSON.stringify(fixture.audit));
    const result = await provider.generateStructuredAnalysis(
      fixture.source.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n'),
    );
    expect(
      generate.mock.calls.map(
        ([request]) => (request as { task: string }).task,
      ),
    ).toEqual(['notesWriter', 'notesAudit']);
    expect(result.generation_metadata?.prompt_version).toBe('notes-v10');
    expect(result.all_action_items).toHaveLength(1);
  },
);

it('repairs malformed writer output once and still requires an independent audit', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockResolvedValueOnce('invalid')
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockResolvedValueOnce(JSON.stringify(f.audit));
  const onStage = vi.fn();
  const result = await p.generateStructuredAnalysis('', '', 'auto', {
    source: f.source,
    onStage,
  });
  expect(onStage.mock.calls.flat()).toEqual([
    'notesWriter',
    'notesWriter',
    'notesAudit',
  ]);
  expect(result.quality.retry_count).toBe(1);
  expect(
    generate.mock.calls.map(([r]) => (r as { task: string }).task),
  ).toEqual(['notesWriter', 'notesWriter', 'notesAudit']);
});

it.each(['notes_writer_timeout', 'notes_audit_timeout'])(
  'rejects %s without publishing a local fallback or repairing transport',
  async (error) => {
    const f = makeDirectNotesFixture();
    const p = new UnifiedLLMProvider('ollama', {});
    const generate = vi.spyOn(p as never, 'generateText');
    if (error.includes('audit'))
      generate.mockResolvedValueOnce(JSON.stringify(f.draft));
    generate.mockRejectedValueOnce(new Error(error));
    await expect(
      p.generateStructuredAnalysis('', '', 'auto', { source: f.source }),
    ).rejects.toThrow(error);
    expect(generate).toHaveBeenCalledTimes(error.includes('audit') ? 2 : 1);
  },
);

it('reuses only the validated writer after audit failure and audits again on manual regeneration', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockRejectedValueOnce(new Error('notes_audit_timeout'))
    .mockResolvedValue(JSON.stringify(f.audit));
  const options = {
    source: f.source,
    stageCache: new NotesStageCache(),
    cacheKey: 'same-run-inputs',
  };
  await expect(
    p.generateStructuredAnalysis('', '', 'auto', options),
  ).rejects.toThrow('notes_audit_timeout');
  await p.generateStructuredAnalysis('', '', 'auto', options);
  await p.generateStructuredAnalysis('', '', 'auto', options);
  expect(
    generate.mock.calls.map(([r]) => (r as { task: string }).task),
  ).toEqual(['notesWriter', 'notesAudit', 'notesAudit', 'notesAudit']);
});

it('rejects a cancelled caller before requesting any stage', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const controller = new AbortController();
  const generate = vi.spyOn(p as never, 'generateText');
  controller.abort();
  await expect(
    p.generateStructuredAnalysis('', '', 'auto', {
      source: f.source,
      signal: controller.signal,
    }),
  ).rejects.toThrow('notes_cancelled');
  expect(generate).not.toHaveBeenCalled();
});

it('resumes a preempted writer without repairing it or rerunning a completed writer', async () => {
  const f = makeDirectNotesFixture();
  const p = new UnifiedLLMProvider('ollama', {});
  const generate = vi
    .spyOn(p as never, 'generateText')
    .mockRejectedValueOnce(
      new DOMException('foreground_preempted', 'AbortError'),
    )
    .mockResolvedValueOnce(JSON.stringify(f.draft))
    .mockResolvedValueOnce(JSON.stringify(f.audit));
  const result = await p.generateStructuredAnalysis('', '', 'auto', {
    source: f.source,
  });
  expect(result.quality.retry_count).toBe(0);
  expect(generate).toHaveBeenCalledTimes(3);
});

it('preserves configured model, thinking, seed and request budgets on actual transport', async () => {
  const f = makeDirectNotesFixture();
  const outputs = [f.draft, f.audit];
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return {
        ok: true,
        text: async () =>
          `${JSON.stringify({
            response: JSON.stringify(outputs.shift()),
            done: true,
            done_reason: 'stop',
          })}\n`,
      };
    }),
  );
  try {
    const p = new UnifiedLLMProvider('ollama', {
      ollama_model: 'configured-model',
      ollama_structured_thinking: false,
      ollama_seed: 42,
    });
    const result = await p.generateStructuredAnalysis('', '', 'auto', {
      source: f.source,
    });
    expect(requests).toHaveLength(2);
    for (const request of requests)
      expect(request).toMatchObject({
        model: 'configured-model',
        think: false,
        stream: true,
        options: { seed: 42, num_ctx: 16384 },
      });
    expect(
      requests.map((r) => (r.options as { num_predict: number }).num_predict),
    ).toEqual([2048, 1536]);
    expect(result.generation_metadata?.model).toBe('configured-model');
  } finally {
    vi.unstubAllGlobals();
  }
});
