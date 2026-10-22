import { describe, expect, it, vi } from 'vitest';
import {
  acceptEditedNotes,
  applyNotesAudit,
  applySourceBoundSemanticReview,
  sourceBoundItemReviewWindow,
} from '../../electron/llm/meetingNotesAudit';
import { reviewSourceBoundNotes } from '../../electron/llm/meetingNotesSemanticReview';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesDraft,
  NotesItem,
} from '../../electron/llm/meetingNotesTypes';

const fixture = (
  turns: Array<{ speaker: string | null; text: string }>,
  kind: NotesItem['kind'] = 'question',
) => {
  const source = createNotesSource(JSON.stringify(turns));
  const sources = [{ segment: 0, start: 0, end: turns[0]!.text.length }];
  const draft: NotesDraft = {
    title: null,
    overview: null,
    meetingType: 'general',
    sections: [
      {
        id: 'section',
        title: { id: 'heading', text: 'Teaching experience', sources },
        items: [
          {
            id: 'question',
            kind,
            text: 'Was the exercise a past example or a new assignment?',
            owner: null,
            due: null,
            sources,
          },
        ],
      },
    ],
  };
  const notes = acceptEditedNotes({
    source,
    draft,
    acceptancePolicy: 'conservative',
  });
  return { notes, item: notes.draft.sections[0]!.items[0]! };
};

describe('source-bound question answer context', () => {
  it('refuses an over-budget following answer without truncation or a provider call', async () => {
    const { notes } = fixture([
      {
        speaker: 'Tutor',
        text: 'Was the exercise a past example or a new assignment?',
      },
      { speaker: 'Teacher', text: 'Historical explanation. '.repeat(2000) },
    ]);
    const generate = vi.fn();
    const reviewed = await reviewSourceBoundNotes(notes, generate);
    expect(generate).not.toHaveBeenCalled();
    expect(reviewed.issues).toContain('semantic_notes_review_capacity');
  });

  it('includes the following answer to a question about a historical classroom example', () => {
    const { notes, item } = fixture([
      {
        speaker: 'Tutor',
        text: 'Was the exercise a past example or a new assignment?',
      },
      {
        speaker: 'Teacher',
        text: 'The exercise was completed last term. It is a historical example, not a new assignment.',
      },
    ]);
    expect(
      sourceBoundItemReviewWindow(notes, item).map((span) => span.segment),
    ).toEqual([0, 1]);
  });

  it('supplies the answer to real review and persists both citations when the model resolves the question', async () => {
    const { notes } = fixture([
      {
        speaker: 'Tutor',
        text: 'Was the exercise a past example or a new assignment?',
      },
      {
        speaker: 'Teacher',
        text: 'The exercise was completed last term. It is a historical example, not a new assignment.',
      },
    ]);
    const reviewed = await reviewSourceBoundNotes(notes, async ({ prompt }) => {
      const cases = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
      const question = cases.find(
        (entry: { id: string }) => entry.id === 'question',
      );
      expect(
        question.source.map((entry: { text: string }) => entry.text),
      ).toEqual(notes.source.segments.map((segment) => segment.text));
      return JSON.stringify({
        resolutions: cases.map((entry: { id: string }) => ({
          id: entry.id,
          kind: 'point',
          owner: null,
          due: null,
          discussion: null,
          text:
            entry.id === 'question'
              ? 'The exercise was completed last term; it is a historical example, not a new assignment.'
              : 'Teaching experience',
        })),
      });
    });
    expect(reviewed.issues ?? []).not.toContain(
      'semantic_notes_review_incomplete',
    );
    expect(reviewed.draft.sections[0]!.items).toEqual([
      expect.objectContaining({
        kind: 'point',
        sources: [
          { segment: 0, start: 0, end: notes.source.segments[0]!.text.length },
          { segment: 1, start: 0, end: notes.source.segments[1]!.text.length },
        ],
      }),
    ]);
    expect(
      reviewed.draft.sections[0]!.items.some(
        (item) => item.kind === 'question',
      ),
    ).toBe(false);
  });

  it('keeps a genuinely unanswered question when the model reports it unresolved', async () => {
    const { notes, item } = fixture([
      {
        speaker: 'Tutor',
        text: 'Was the exercise a past example or a new assignment?',
      },
      { speaker: 'Teacher', text: 'The answer is not known yet.' },
    ]);
    const next = applySourceBoundSemanticReview(notes, [
      {
        ...item,
        sources: sourceBoundItemReviewWindow(notes, item),
      },
    ]);
    expect(next.draft.sections[0]!.items[0]!.kind).toBe('question');
  });

  it('anchors replay to the original question despite later questions in the expanded citations', () => {
    const { notes, item } = fixture([
      {
        speaker: 'A',
        text: 'Was the exercise a past example or a new assignment?',
      },
      { speaker: 'B', text: 'It was a past example.' },
      { speaker: 'A', text: 'What about another lesson?' },
      { speaker: 'B', text: 'That remains undecided.' },
      { speaker: 'A', text: 'When is the next class?' },
      { speaker: 'B', text: 'Monday.' },
    ]);
    const window = sourceBoundItemReviewWindow(notes, item);
    expect(window.map((span) => span.segment)).toEqual([0, 1, 2, 3]);
    const replayed = { ...item, kind: 'point' as const, sources: window };
    expect(sourceBoundItemReviewWindow(notes, replayed)).toEqual(window);
    expect(() =>
      applySourceBoundSemanticReview(notes, [
        {
          ...item,
          sources: [
            ...window,
            {
              segment: 4,
              start: 0,
              end: notes.source.segments[4]!.text.length,
            },
          ],
        },
      ]),
    ).toThrow('notes_source_out_of_scope');
  });

  it('counts identified-speaker ASR fragments as grouped turns, preserving speaker boundaries', () => {
    const { notes, item } = fixture([
      {
        speaker: 'A',
        text: 'Was the exercise a past example or a new assignment?',
      },
      { speaker: 'B', text: 'It was completed' },
      { speaker: 'B', text: 'last term.' },
      { speaker: 'C', text: 'That clarifies it.' },
      { speaker: 'A', text: 'Thank you.' },
      { speaker: 'C', text: 'A different topic now.' },
    ]);
    expect(
      sourceBoundItemReviewWindow(notes, item).map((span) => span.segment),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not combine unknown-speaker fragments into an unbounded turn', () => {
    const { notes, item } = fixture([
      {
        speaker: 'A',
        text: 'Was the exercise a past example or a new assignment?',
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        speaker: null,
        text: `Recorded reply ${index}.`,
      })),
    ]);
    expect(
      sourceBoundItemReviewWindow(notes, item).map((span) => span.segment),
    ).toEqual([0, 1, 2, 3]);
  });

  it('recognizes a source question even when the original item is a point', () => {
    const { notes, item } = fixture(
      [
        {
          speaker: 'A',
          text: 'Was the exercise a past example or a new assignment?',
        },
        { speaker: 'B', text: 'It was a past example.' },
      ],
      'point',
    );
    expect(
      sourceBoundItemReviewWindow(notes, item).map((span) => span.segment),
    ).toEqual([0, 1]);
  });

  it('uses a question-kind original without punctuation and ignores blank following segments', () => {
    const { notes, item } = fixture([
      {
        speaker: 'A',
        text: 'Please clarify whether the exercise is a new assignment',
      },
      { speaker: 'B', text: ' ' },
      { speaker: 'B', text: 'It was completed last term.' },
    ]);
    expect(
      sourceBoundItemReviewWindow(notes, item).map((span) => span.segment),
    ).toEqual([0, 2]);
  });

  it('does not grant following context to an inserted item without an original mapping', () => {
    const { notes, item } = fixture([
      {
        speaker: 'A',
        text: 'Was the exercise a past example or a new assignment?',
      },
      { speaker: 'B', text: 'It was a past example.' },
    ]);
    expect(
      sourceBoundItemReviewWindow(notes, { ...item, id: 'inserted' }),
    ).toEqual(item.sources);
  });

  it('preserves validation for malformed original spans and safely handles empty originals', () => {
    const { notes, item } = fixture([
      {
        speaker: 'A',
        text: 'Was the exercise a past example or a new assignment?',
      },
      { speaker: 'B', text: 'It was a past example.' },
    ]);
    expect(
      sourceBoundItemReviewWindow(
        {
          ...notes,
          reviewOriginals: new Map([[item.id, { ...item, sources: [] }]]),
        },
        item,
      ),
    ).toEqual(item.sources);
    expect(() =>
      sourceBoundItemReviewWindow(
        {
          ...notes,
          reviewOriginals: new Map([
            [
              item.id,
              { ...item, sources: [{ segment: 100, start: 0, end: 1 }] },
            ],
          ]),
        },
        item,
      ),
    ).toThrow('invalid_source_span');
  });
});

it.each(['insert', 'replace'] as const)(
  'anchors a genuine %s audit question to its corrected source without replay crawl',
  (op) => {
    const turns = [
      { speaker: 'Host', text: 'The lesson has begun.' },
      {
        speaker: 'Tutor',
        text: 'Please clarify whether the exercise is a new assignment',
      },
      { speaker: 'Teacher', text: 'It was completed last term.' },
      { speaker: 'Tutor', text: 'What is the next topic?' },
      { speaker: 'Teacher', text: 'Geometry.' },
      { speaker: 'Tutor', text: 'When is the next class?' },
      { speaker: 'Teacher', text: 'Monday.' },
    ];
    const source = createNotesSource(JSON.stringify(turns));
    const span = (segment: number) => ({
      segment,
      start: 0,
      end: turns[segment]!.text.length,
    });
    const original = {
      id: 'item',
      kind: 'point' as const,
      text: 'The lesson has begun.',
      owner: null,
      due: null,
      sources: [span(0)],
    };
    const candidate = {
      id: op === 'insert' ? 'new-question' : 'item',
      kind: 'question' as const,
      text: 'Is the exercise a new assignment?',
      owner: null,
      due: null,
      sources: [span(1)],
    };
    const draft: NotesDraft = {
      title: null,
      overview: null,
      meetingType: 'general',
      sections: [
        {
          id: 'section',
          title: { id: 'heading', text: 'Lesson', sources: [span(0)] },
          items: [original],
        },
      ],
    };
    const audit = {
      changes: [
        op === 'insert'
          ? { op: 'insert' as const, section: 'section', value: candidate }
          : { op: 'replace' as const, target: 'item', value: candidate },
      ],
      dispositions: [],
      terminology: [],
      verdicts: [
        { target: 'heading', status: 'supported' as const, sources: [span(0)] },
        ...(op === 'insert'
          ? [
              {
                target: 'item',
                status: 'supported' as const,
                sources: [span(0)],
              },
            ]
          : []),
        {
          target: candidate.id,
          status: 'supported' as const,
          sources: [span(1)],
        },
      ],
    };
    const before = structuredClone({ draft, audit });
    const notes = applyNotesAudit({ source, draft, audit });
    expect({ draft, audit }).toEqual(before);
    expect(notes.reviewOriginals?.get(candidate.id)).toEqual(candidate);
    expect(notes.reviewOriginals?.get(candidate.id)).not.toBe(candidate);
    const item = notes.draft.sections[0]!.items.find(
      ({ id }) => id === candidate.id,
    )!;
    const window = sourceBoundItemReviewWindow(notes, item);
    expect(window.map(({ segment }) => segment)).toEqual([1, 2, 3, 4]);
    const replayed = { ...item, kind: 'point' as const, sources: window };
    expect(sourceBoundItemReviewWindow(notes, replayed)).toEqual(window);
    expect(notes.reviewOriginals?.get(candidate.id)?.sources).toEqual([
      span(1),
    ]);
    expect(() =>
      applySourceBoundSemanticReview(notes, [
        { ...replayed, sources: [...window, span(5)] },
      ]),
    ).toThrow('notes_source_out_of_scope');
  },
);
