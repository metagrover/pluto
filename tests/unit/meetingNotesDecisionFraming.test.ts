import { describe, expect, it, vi } from 'vitest';
import { groundSourceReviewedItem } from '../../electron/llm/analysisGrounding';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import type { NotesRequest } from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import captured from '../fixtures/meeting-notes-privacy-seed73.json';
import { makeNotesContext } from '../fixtures/meeting-notes-v10';

const sourceText =
  "The decision is not to publish individual responses. Only aggregate counts may be published, to protect participants' confidentiality.";
const claim =
  "Decision not to publish individual responses; only aggregate counts may be published to protect participants' confidentiality.";
const review = (
  text: string,
  evidence = sourceText,
  kind: 'action' | 'decision' = 'decision',
) =>
  groundSourceReviewedItem(
    { text, kind, owner: null, due: null },
    {
      evidence,
      quotedEvidence: evidence,
      sourceLine: `Tariq: ${evidence}`,
      sourceLines: [`Tariq: ${evidence}`],
      lineIndex: 0,
    },
  );

describe('exact explicit decision predicate with equivalent framing', () => {
  it('publishes the exact captured seed73 privacy response with its original text and source span', async () => {
    const source = structuredClone(captured.source);
    const replies = [captured.writerRaw, captured.auditRaw, captured.auditRaw];
    const generate = vi.fn(async (request: NotesRequest) => {
      const raw = replies.shift();
      if (!raw) throw new Error('offline_replay_exhausted');
      return createNotesWireRequest(
        request.prompt,
        request.sourceSpans ?? [],
      ).decode(raw);
    });
    const result = await generateMeetingNotes({
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 16384,
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.quality.retry_count).toBe(0);
    expect(result.all_decisions).toEqual([
      { text: claim, evidence: sourceText },
    ]);
    expect(result.all_action_items).toEqual([
      expect.objectContaining({ assignee: 'Bea', due: 'Monday' }),
    ]);
    expect(
      result.generation_metadata?.source_provenance?.blocks['all_decisions:0']
        ?.sources,
    ).toEqual([{ segment: 3, start: 0, end: sourceText.length }]);
    expect(source).toEqual(captured.source);
  });

  it('ignores only leading speech framing for a fully equal permission predicate', () => {
    expect(review(claim)).toEqual({ text: claim, owner: null, due: null });
    const conditionalSource =
      'The decision is that aggregate counts may be published once legal approves.';
    const conditionalClaim =
      'Decision that aggregate counts may be published once legal approves.';
    expect(review(conditionalClaim, conditionalSource)).toEqual({
      text: conditionalClaim,
      owner: null,
      due: null,
    });
  });

  it.each([
    claim.replace('not to publish', 'to publish'),
    claim.replace('may be published', 'will be published'),
    claim.replace('only aggregate counts', 'all responses'),
    claim.replace(
      "to protect participants' confidentiality",
      'to increase publicity',
    ),
    'Decision only aggregate counts may be published.',
  ])('does not allow a content, scope or polarity change: %s', (text) => {
    expect(review(text)).toBeNull();
  });

  it.each([
    'The decision is that aggregate counts may be published once legal approves.',
    'The decision is that aggregate counts may be published pending legal approval.',
    'The decision is that aggregate counts may be published if legal does not object.',
  ])('does not drop a real prerequisite: %s', (evidence) => {
    expect(
      review('Decision that aggregate counts may be published.', evidence),
    ).toBeNull();
  });

  it.each([
    sourceText.replace('The decision is', 'The tentative decision is'),
    sourceText.replace('The decision is', 'The decision is perhaps'),
    sourceText.replace('The decision is', 'The decision is tentatively'),
    'The decision is not final; aggregate counts may be published.',
    'The decision is pending approval; aggregate counts may be published.',
    'The decision is that aggregate counts may be published, but it is not finalized.',
    `"${sourceText}"`,
    `Tariq said ${sourceText}`,
  ])(
    'still rejects unsettled or non-explicit source framing: %s',
    (evidence) => {
      expect(
        review(evidence.replace(/^The decision is/i, 'Decision'), evidence),
      ).toBeNull();
    },
  );

  it('does not apply exact decision-copy framing to an action', () => {
    expect(review(claim, sourceText, 'action')).toBeNull();
  });
});
