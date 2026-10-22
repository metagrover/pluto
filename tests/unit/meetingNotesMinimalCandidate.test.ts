import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseAnalysisDocumentV3 } from '../../electron/llm/analysisDocumentV3';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { hasPersonalActionOwner } from '../../src/utils/actionCommitment';
import { getAnalysisEditBlocks } from '../../src/utils/analysisDocument';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unit tests must not reach a model transport');
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fixture = (text = 'I will send the outline.') => {
  const source = createNotesSource(
    JSON.stringify({ segments: [{ speaker: 'Milo', text }] }),
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: 'gemma4:12b',
    ollama_fast_model: 'phi4-mini:3.8b',
  });
  vi.spyOn(provider as never, 'resolveOllamaModel').mockResolvedValue(
    'gemma4:12b',
  );
  const response = {
    title: null,
    overview: { text: 'An outline will be sent.', sources: ['R0'] },
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
  const generate = vi
    .spyOn(provider as never, 'generateText')
    .mockResolvedValue(JSON.stringify(response));
  return { provider, source, response, generate };
};

it('writes ordinary local notes once without a model reviewer or semantic-review proof', async () => {
  const { provider, source, generate } = fixture();
  const original = structuredClone(source);
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      task: 'notesWriter',
      notesModel: 'gemma4:12b',
      notesBudget: { contextTokens: 16384, outputTokens: 2048 },
    }),
  );
  expect(result.overview).toBe('An outline will be sent.');
  expect(result.all_action_items).toEqual([
    expect.objectContaining({ text: 'Send the outline', assignee: 'Milo' }),
  ]);
  expect(result.quality.fallback_used).toBe(false);
  expect(result.generation_metadata).not.toHaveProperty(
    'source_action_review_version',
  );
  expect(result.generation_metadata).not.toHaveProperty('audit_status');
  expect(result.generation_metadata?.pipeline_version).toBe('writer-only-v1');
  const reread = parseAnalysisDocumentV3(JSON.stringify(result));
  expect(reread?.generation_metadata?.pipeline_version).toBe('writer-only-v1');
  expect(reread?.all_action_items).toEqual(result.all_action_items);
  expect(source).toEqual(original);
  expect(getAnalysisEditBlocks(result).length).toBeGreaterThan(0);
  const missingProvenance = structuredClone(result);
  missingProvenance.generation_metadata!.source_provenance = undefined;
  expect(getAnalysisEditBlocks(missingProvenance)).toEqual([]);
  expect(
    hasPersonalActionOwner(
      {
        metadata: JSON.stringify({
          origin: 'extraction',
          assignee_name: 'Me',
          source_meeting_id: 'fictional-meeting',
          source_evidence: 'I will send the outline.',
        }),
      },
      {},
    ),
  ).toBe(false);
});

it('retains only the existing bounded writer JSON-format repair', async () => {
  const { provider, source, response, generate } = fixture();
  generate
    .mockResolvedValueOnce('{bad json')
    .mockResolvedValueOnce(JSON.stringify(response));
  const result = await provider.generateStructuredAnalysis('', '', 'auto', {
    source,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls.map(([request]) => request.task)).toEqual([
    'notesWriter',
    'notesWriter',
  ]);
  expect(result.generation_metadata).not.toHaveProperty(
    'source_action_review_version',
  );
});

it('refuses a lost approval condition without another model call or transcript replacement', async () => {
  const { provider, source, generate } = fixture(
    'I will send the outline only after legal approval.',
  );
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_guardrail');
  expect(generate).toHaveBeenCalledTimes(1);
});

it('refuses an unaccepted offer instead of converting it into raw-source discussion', async () => {
  const { provider, source, generate } = fixture(
    'I could send the outline if somebody needs it.',
  );
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
});

it('refuses a missing model overview instead of publishing an unreadable document or fallback', async () => {
  const { provider, source, response, generate } = fixture();
  generate.mockResolvedValue(JSON.stringify({ ...response, overview: null }));
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_writer_invalid');
  expect(generate).toHaveBeenCalledTimes(1);
});

it('rejects raw first-person transcript prose without a repair cascade', async () => {
  const { provider, source, response, generate } = fixture();
  response.sections[0]!.items[0]!.text = 'I will send the outline.';
  response.sections[0]!.items[0]!.kind = 'point';
  generate.mockResolvedValue(JSON.stringify(response));
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
});

it('refuses an oversized compact plan before generation rather than entering audit/merge', async () => {
  const { provider, generate } = fixture();
  const source = createNotesSource(
    JSON.stringify({
      segments: Array.from({ length: 80 }, (_, index) => ({
        speaker: 'Milo',
        text: `Topic ${index}. ${'Workshop details. '.repeat(400)}`,
      })),
    }),
  );
  const original = structuredClone(source);
  await expect(
    provider.generateStructuredAnalysis('', '', 'auto', { source }),
  ).rejects.toThrow('notes_bounded_plan_exceeded');
  expect(generate).not.toHaveBeenCalled();
  expect(source).toEqual(original);
});

it.each(['overview', 'title'])(
  'rejects raw source in the model %s without a prose fallback',
  async (field) => {
    const { provider, source, response, generate } = fixture();
    generate.mockResolvedValue(
      JSON.stringify({
        ...response,
        [field]: {
          text: 'I will send the outline.',
          sources: ['R0'],
        },
      }),
    );
    await expect(
      provider.generateStructuredAnalysis('', '', 'auto', { source }),
    ).rejects.toThrow('notes_writer_invalid');
    expect(generate).toHaveBeenCalledTimes(1);
  },
);
