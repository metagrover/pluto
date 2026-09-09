import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import {
  buildMarkdownNotesMessages,
  generateMarkdownNotes,
  markdownEvidencePassages,
  triageMarkdownNotes,
} from '../../scripts/lib/notesReplayMarkdown';

const source = createNotesSource(
  JSON.stringify({
    segments: [
      {
        speaker: 'A',
        text: 'The release is blocked. Alice will review it Friday.',
      },
      {
        speaker: 'B',
        text: 'Correction: the review is due Monday, not Friday.',
      },
    ],
  }),
);
afterEach(() => vi.unstubAllGlobals());
describe('single-pass Markdown development candidate', () => {
  it('packs every original segment exactly once with stable reverse references', () => {
    const passages = markdownEvidencePassages(source);
    expect(passages.flatMap((p) => p.segments)).toEqual([0, 1]);
    for (const segment of source.segments) {
      const passage = passages.find((p) => p.segments.includes(segment.index))!;
      expect(passage.text).toContain(segment.text);
      expect(passage.text).toContain(`Speaker "${segment.speaker}":`);
    }
    expect(
      triageMarkdownNotes('* Reviewed Monday. [P0]', source).claims[0].segments,
    ).toEqual([0, 1]);
  });
  it('retains the full source and rejects over-capacity input instead of truncating', () => {
    const messages = buildMarkdownNotesMessages(source);
    for (const segment of source.segments)
      expect(messages[1].content).toContain(segment.text);
    const large = createNotesSource(
      JSON.stringify([{ text: 'x'.repeat(60000) }]),
    );
    expect(() => buildMarkdownNotesMessages(large)).toThrow(
      'markdown_notes_context_exhausted',
    );
  });
  it('keeps correct citations provisional and flags missing, unknown or active markup', () => {
    expect(
      triageMarkdownNotes('*   Review Monday [P0].', source),
    ).toMatchObject({
      qualityApproved: false,
      invalidLines: [],
      status: 'pending_review',
    });
    expect(
      triageMarkdownNotes('## Release\n- Review Monday. [P0]', source),
    ).toMatchObject({
      status: 'pending_review',
      qualityApproved: false,
      invalidLines: [],
    });
    for (const text of [
      '- Missing citation',
      '- Wrong [P9]',
      '- <script>x</script> [P0]',
      '- ![x](https://x) [P0]',
      '## Empty',
    ]) {
      expect(triageMarkdownNotes(text, source).status).toBe(
        'flagged_for_review',
      );
    }
  });
  it('streams text before completion in one request without JSON generation constraints', async () => {
    const onText = vi.fn();
    const packets = [
      { model: 'test', message: { content: '## Release\n' }, done: false },
      { model: 'test', message: { content: '- Blocked. [P0]' }, done: false },
      {
        model: 'test',
        done: true,
        done_reason: 'stop',
        eval_count: 12,
        prompt_eval_count: 30,
      },
    ];
    const fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.format).toBeUndefined();
      expect(body).toMatchObject({ truncate: false, shift: false });
      expect(body.options).toMatchObject({ num_ctx: 16384, num_predict: 2048 });
      let index = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (index === 2) expect(onText).toHaveBeenCalled();
            if (index === packets.length) controller.close();
            else
              controller.enqueue(
                new TextEncoder().encode(
                  `${JSON.stringify(packets[index++])}\n`,
                ),
              );
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const result = await generateMarkdownNotes({
      source,
      model: 'test',
      signal: new AbortController().signal,
      onText,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.firstTextMs).toBeTypeOf('number');
    expect(result.triage.qualityApproved).toBe(false);
  });
  it.each(['length', 'missing', 'identity'])(
    'rejects %s stream completion',
    async (mode) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              `${JSON.stringify({
                model: mode === 'identity' ? 'wrong' : 'test',
                message: { content: '- Text. [P0]' },
                done: mode !== 'missing',
                done_reason: mode === 'length' ? 'length' : 'stop',
              })}\n`,
            ),
        ),
      );
      await expect(
        generateMarkdownNotes({
          source,
          model: 'test',
          signal: new AbortController().signal,
          onText: () => {},
        }),
      ).rejects.toThrow();
    },
  );
});
