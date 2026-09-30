import { describe, expect, it, vi } from 'vitest';
import {
  acceptLiveMeetingChatReview,
  buildLiveMeetingChatPrompt,
  buildLiveMeetingChatResponse,
  completeLiveMeetingChatAnswer,
  readLiveMeetingChatAnswer,
} from '../../electron/intelligence/liveMeetingChatAnswer';
import { buildLiveMeetingAskPlutoContext } from '../../electron/intelligence/meetingAskPluto';
const context = buildLiveMeetingAskPlutoContext({
  meetingId: 'fictional',
  title: 'Review',
  notes: 'The release is approved.',
  participants: ['Alex'],
  transcript: [
    {
      id: '1',
      speaker: 'Me',
      timestampMs: 1,
      confirmed: true,
      text: 'The release is not approved. Testing must finish first.',
    },
    {
      id: '2',
      speaker: 'Call audio',
      timestampMs: 2,
      confirmed: true,
      text: 'Morgan will prepare the checklist. We have not set a deadline.',
    },
  ],
});
const packet = (sources: unknown[], proposal = '') =>
  JSON.stringify({ sources, proposal });
describe('source-checked live chat answers', () => {
  it('rejects invalid, invented and non-numeric source references', () => {
    expect(
      readLiveMeetingChatAnswer(packet([99, -1, 2.5, 'x', '1.5']), context)
        .points,
    ).toEqual([]);
    expect(() =>
      readLiveMeetingChatAnswer(
        JSON.stringify({
          points: [{ source: 1, quote: 'The release is approved.' }],
        }),
        context,
      ),
    ).toThrow();
  });
  it('copies complete source sentences including negation and conditions', () => {
    const result = buildLiveMeetingChatResponse(packet([1, 2]), context, {
      mode: 'recall',
      recallKind: 'decision',
    });
    expect(result.answer).toContain('The release is not approved.');
    expect(result.answer).toContain('Testing must finish first.');
    expect(result.citations[0].evidence_span).toBe(
      'The release is not approved. Testing must finish first.',
    );
    expect(result.claims[0].citationIds).toEqual(['citation-1']);
  });
  it('keeps distinct supported details and deduplicates repeated selections', () => {
    const result = buildLiveMeetingChatResponse(packet([3, 3, 4]), context, {
      mode: 'recall',
      recallKind: 'action',
    });
    expect(result.citations).toHaveLength(1);
    expect(result.answer).toContain('Morgan will prepare the checklist.');
    expect(result.answer).toContain('We have not set a deadline.');
  });
  it('does not display unchecked generated advice or drafts', () => {
    const raw = packet([3], 'Morgan promised Friday.');
    expect(
      buildLiveMeetingChatResponse(raw, context, { mode: 'draft' }).answer,
    ).not.toContain('Friday');
    expect(
      buildLiveMeetingChatResponse(
        raw,
        context,
        { mode: 'advice' },
        'Ask Morgan which date is realistic.',
      ).answer,
    ).toContain('Suggestion:\nAsk Morgan');
  });
  it('accepts numeric string references and keeps a missing date next to its action', () => {
    const answer = buildLiveMeetingChatResponse(packet(['3']), context, {
      mode: 'recall',
      recallKind: 'action',
    });
    expect(answer.answer).toContain('We have not set a deadline.');
    expect(answer.citations).toHaveLength(1);
  });
  it('prevents a review from adding unrelated source references', () => {
    const reviewed = JSON.parse(
      acceptLiveMeetingChatReview(
        packet([3]),
        JSON.stringify({ sources: ['3', 1, 99], proposal: 'Ask for a date.' }),
      ),
    );
    expect(reviewed.sources).toEqual([3]);
  });

  it('abstains for a missing fact without presenting unrelated source evidence', () => {
    const response = buildLiveMeetingChatResponse(packet([]), context, {
      mode: 'recall',
      recallKind: 'fact',
    });
    expect(response.answer).toContain("haven't heard enough");
    expect(response.claims).toEqual([]);
    expect(response.citations).toEqual([]);
  });
  it('keeps assistant notes and attendee hints out of the transcript prompt', () => {
    const prompt = buildLiveMeetingChatPrompt({
      query: 'Who approved?',
      context,
      assistanceRoute: { mode: 'recall', recallKind: 'fact' },
    });
    expect(prompt).not.toContain('The release is approved.');
    expect(prompt).not.toContain('Alex');
    expect(prompt).toContain('The release is not approved.');
  });
  it('rejects malformed output instead of treating it as a factual reply', () => {
    expect(() =>
      readLiveMeetingChatAnswer('The release is approved.', context),
    ).toThrow();
    expect(() => readLiveMeetingChatAnswer('{}', context)).toThrow(
      'live_chat_missing_sources',
    );
  });
  it('uses a source-bound next step and discards invented model advice', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({ sources: ['3'], proposal: 'Morgan promised Friday.' }),
      );
    const response = await completeLiveMeetingChatAnswer({
      raw: packet([3]),
      query: 'What should we do next?',
      context,
      route: { mode: 'advice' },
      generate,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(response.answer).toContain('Ask for a realistic deadline');
    expect(response.answer).toContain('We have not set a deadline.');
    expect(response.answer).not.toContain('Friday');
  });
  it('repairs omitted commitments from the full transcript and produces a usable draft', async () => {
    const generate = vi.fn().mockResolvedValueOnce(
      JSON.stringify({
        sources: [1, 3],
        proposal: 'Morgan promised Friday.',
      }),
    );
    const response = await completeLiveMeetingChatAnswer({
      raw: packet([1]),
      query: 'Draft a follow-up with agreed actions',
      context,
      route: { mode: 'draft' },
      generate,
    });
    expect(generate.mock.calls[0][0]).toContain(
      '[3] Morgan will prepare the checklist.',
    );
    expect(response.answer).toContain('Draft:\nHi everyone,');
    expect(response.answer).toContain('Morgan will prepare the checklist.');
    expect(response.answer).toContain('We have not set a deadline.');
    expect(response.answer).not.toContain('Friday');
    expect(response.answer.match(/Morgan will prepare/g)).toHaveLength(1);
  });
  it('does not list presentation or authorship as agreed actions', async () => {
    const historical = {
      ...context,
      evidenceItems: [
        ...context.evidenceItems,
        {
          ...context.evidenceItems[0],
          id: 'history',
          kind: 'transcript' as const,
          text: 'Alex presented the plan. Morgan created it.',
          quote: 'Alex presented the plan. Morgan created it.',
        },
      ],
    };
    const response = await completeLiveMeetingChatAnswer({
      raw: packet([3, 5, 6]),
      query: 'Draft a follow-up with agreed actions',
      context: historical,
      route: { mode: 'draft' },
      generate: async () => packet([3, 5, 6]),
    });
    expect(response.answer).toContain('prepare the checklist');
    expect(response.answer).not.toMatch(/presented|created/);
  });
  it('propagates cancellation during relevance review', async () => {
    const aborted = new DOMException('Cancelled', 'AbortError');
    await expect(
      completeLiveMeetingChatAnswer({
        raw: packet([3]),
        query: 'Explain this',
        context,
        route: { mode: 'explanation' },
        generate: async () => {
          throw aborted;
        },
      }),
    ).rejects.toBe(aborted);
  });
  it('keeps the subject of an anaphoric denial', () => {
    const denial = {
      ...context,
      evidenceItems: [
        {
          ...context.evidenceItems[0],
          kind: 'transcript' as const,
          text: 'Sam suggested a full page. We did not approve that proposal.',
          quote: 'Sam suggested a full page. We did not approve that proposal.',
        },
      ],
    };
    const answer = buildLiveMeetingChatResponse(packet([2]), denial, {
      mode: 'recall',
      recallKind: 'decision',
    });
    expect(answer.answer).toContain(
      'Sam suggested a full page. We did not approve that proposal.',
    );
  });
  it('includes capture labels only when resolving speaker recall', () => {
    const speakerPrompt = buildLiveMeetingChatPrompt({
      query: 'What did I say?',
      context,
      assistanceRoute: { mode: 'recall', recallKind: 'fact' },
    });
    expect(speakerPrompt).toContain('(Me)');
    expect(speakerPrompt).toContain('(Call audio)');
    expect(speakerPrompt).not.toContain('Alex');
  });
  it('rechecks the supplied transcript when the first pass misses a stated denial', async () => {
    const generate = vi.fn().mockResolvedValueOnce(packet([1]));
    const answer = await completeLiveMeetingChatAnswer({
      raw: packet([]),
      query: 'Is the release approved?',
      context,
      route: { mode: 'recall', recallKind: 'decision' },
      generate,
    });
    expect(generate.mock.calls[0][0]).toContain(
      '[1] The release is not approved.',
    );
    expect(answer.answer).toContain('not approved');
  });
  it('does not request a review for a direct factual answer', async () => {
    const generate = vi.fn();
    await completeLiveMeetingChatAnswer({
      raw: packet([1]),
      query: 'Was it approved?',
      context,
      route: { mode: 'recall', recallKind: 'fact' },
      generate,
    });
    expect(generate).not.toHaveBeenCalled();
  });
});
