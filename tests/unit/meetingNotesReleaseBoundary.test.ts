import { afterEach, expect, it, vi } from 'vitest';

const compactDraft = (count: number) => ({
  title: null,
  meetingType: 'general',
  sections: [
    {
      title: 'Discussion',
      items: [
        {
          kind: 'point',
          text: 'A point.',
          owner: null,
          due: null,
          sources: Array.from({ length: count }, (_, segment) => ({
            segment,
            start: 0,
            end: 4,
          })),
        },
      ],
    },
  ],
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('keeps experimental source encodings out of production even when requested', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
  const { NOTES_EXPERIMENTS_ENABLED } = await import(
    '../../electron/llm/meetingNotesExperiments'
  );
  const { createNotesWireRequest } = await import(
    '../../electron/llm/meetingNotesWire'
  );
  expect(NOTES_EXPERIMENTS_ENABLED).toBe(false);
  const span = { segment: 0, start: 0, end: 12 };
  const prompt = `BEGIN SOURCE DATA\n${JSON.stringify({ descriptor: span, speaker: 'Milo', text: 'Exact words.' })}\nEND SOURCE DATA`;
  for (const [speakers, paragraphs] of [
    [true, false],
    [false, true],
  ]) {
    const wire = createNotesWireRequest(prompt, [span], speakers, paragraphs);
    expect(wire.sourceLabels).toEqual(['R0']);
    expect(wire.prompt).toContain(
      JSON.stringify(['R0', 'Milo', 'Exact words.']),
    );
    expect(wire.prompt).not.toContain('speakers dictionary');
    expect(wire.prompt).not.toContain('chronological dialogue');
  }
});

it('retains the production three-span parser limit for experimental requests', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
  const { parseCompactNotesDraft } = await import(
    '../../electron/llm/meetingNotesAudit'
  );
  const raw = JSON.stringify(compactDraft(4));
  expect(() => parseCompactNotesDraft(raw, 36)).toThrow();
});

it.each(['ollama', 'openai', 'openrouter', 'gemini', 'claude', undefined])(
  'retains the production guard for %s even when a larger experimental budget is requested',
  async (provider) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { parseCompactNotesDraft } = await import(
      '../../electron/llm/meetingNotesAudit'
    );
    expect(() =>
      parseCompactNotesDraft(JSON.stringify(compactDraft(4)), 36, provider),
    ).toThrow('notes_writer_invalid');
    expect(() =>
      parseCompactNotesDraft(JSON.stringify(compactDraft(3)), 36, provider),
    ).not.toThrow();
  },
);

it('allows the explicit ChatGPT production budget but rejects more than 36 source spans', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
  const { parseCompactNotesDraft } = await import(
    '../../electron/llm/meetingNotesAudit'
  );
  expect(
    parseCompactNotesDraft(JSON.stringify(compactDraft(36)), 36, 'chatgpt')
      .sections[0].items[0].sources,
  ).toHaveLength(36);
  expect(() =>
    parseCompactNotesDraft(JSON.stringify(compactDraft(37)), 100, 'chatgpt'),
  ).toThrow('notes_writer_invalid');
  const titleSources = compactDraft(4).sections[0].items[0].sources;
  const draft = {
    ...compactDraft(3),
    title: { text: 'Pilot follow-up', sources: titleSources },
  };
  expect(() =>
    parseCompactNotesDraft(JSON.stringify(draft), 36, 'chatgpt'),
  ).not.toThrow();
  expect(() =>
    parseCompactNotesDraft(JSON.stringify(draft), 36, 'ollama'),
  ).not.toThrow();
  expect(() =>
    parseCompactNotesDraft(
      JSON.stringify({
        ...draft,
        title: {
          ...draft.title,
          sources: compactDraft(37).sections[0].items[0].sources,
        },
      }),
      36,
      'ollama',
    ),
  ).toThrow('notes_writer_invalid');
});
