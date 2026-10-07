import { afterEach, expect, it, vi } from 'vitest';

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
  const raw = JSON.stringify({
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
            sources: Array.from({ length: 4 }, (_, segment) => ({
              segment,
              start: 0,
              end: 4,
            })),
          },
        ],
      },
    ],
  });
  expect(() => parseCompactNotesDraft(raw, 36)).toThrow();
});
