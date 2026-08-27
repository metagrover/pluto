import { describe, expect, it, vi } from 'vitest';
import { findNotesGuardrailIssues } from '../../electron/llm/meetingNotesGuardrails';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesDraft,
  NotesRequest,
} from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import captured from '../fixtures/meeting-notes-long-exhibition-seed41.json';
import { makeNotesContext } from '../fixtures/meeting-notes-v10';

const issuesFor = (
  turns: Array<{ speaker: string; text: string }>,
  items: Array<{ text: string; segment?: number; due?: string | null }> = [],
) => {
  const source = createNotesSource(JSON.stringify({ segments: turns }));
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 's0',
        title: {
          id: 's0:title',
          text: 'Discussion',
          sources: [
            { segment: 0, start: 0, end: source.segments[0]!.text.length },
          ],
        },
        items: items.map((item, index) => ({
          id: `s0:item:${index}`,
          kind: 'action',
          text: item.text,
          owner: 'Priya',
          due: item.due ?? null,
          sources: [
            {
              segment: item.segment ?? 0,
              start: 0,
              end: source.segments[item.segment ?? 0]!.text.length,
            },
          ],
        })),
      },
    ],
  };
  const snapshot = structuredClone({ source, draft });
  const issues = findNotesGuardrailIssues(source, draft);
  expect({ source, draft }).toEqual(snapshot);
  return issues.map((issue) => ({
    code: issue.code,
    segments: issue.sources.map((span) => span.segment),
  }));
};

describe('guardrail task scope and explicit withdrawal', () => {
  it('publishes exact captured long writer and first audit without rewriting content or source evidence', async () => {
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
    expect(result.all_action_items).toHaveLength(2);
    expect(result.all_action_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignee: 'Priya',
          due: 'Thursday',
          text: expect.stringContaining(
            'once the insurance certificate is approved',
          ),
          evidence: source.segments[0]!.text,
        }),
        expect.objectContaining({
          assignee: 'Priya',
          due: 'Thursday',
          text: expect.stringMatching(/send the existing floor plan to Lena/i),
          evidence: source.segments[18]!.text,
        }),
      ]),
    );
    expect(result.all_decisions).toEqual([
      expect.objectContaining({
        text: 'The printed catalogue will be limited to 100 copies with a QR link for additional readers due to budget constraints.',
        evidence: source.segments[8]!.text,
      }),
    ]);
    expect(JSON.stringify(result.topics)).toContain(
      'The commitment to replace the camera equipment list was withdrawn as the folder already contains the corrected list.',
    );
    expect(source).toEqual(captured.source);
  });

  it.each([
    'I am withdrawing my promise to',
    "I'm withdrawing my commitment to",
    'I am withdrawing my earlier promise to',
  ])('recognizes same-owner explicit task withdrawal: %s', (prefix) => {
    expect(
      issuesFor([
        { speaker: 'Priya', text: 'I will replace the camera equipment list.' },
        {
          speaker: 'Priya',
          text: `${prefix} replace the camera equipment list.`,
        },
      ]),
    ).toEqual([{ code: 'missing_cancellation_context', segments: [0, 1] }]);
  });

  it.each([
    [
      'other owner',
      'Omar',
      'I am withdrawing my promise to replace the camera equipment list.',
    ],
    [
      'other task',
      'Priya',
      'I am withdrawing my promise to review the camera equipment list.',
    ],
    [
      'conditional withdrawal',
      'Priya',
      'I am withdrawing my promise to replace the camera equipment list if the folder is current.',
    ],
    [
      'question',
      'Priya',
      'Am I withdrawing my promise to replace the camera equipment list?',
    ],
  ])('does not cancel for %s', (_label, speaker, text) => {
    expect(
      issuesFor([
        { speaker: 'Priya', text: 'I will replace the camera equipment list.' },
        { speaker, text },
      ]),
    ).toEqual([{ code: 'missing_action', segments: [0] }]);
  });

  it('does not confuse withdrawal recipients or suppress a later renewed commitment', () => {
    expect(
      issuesFor([
        { speaker: 'Priya', text: 'I will send the report to Lena.' },
        {
          speaker: 'Priya',
          text: 'I am withdrawing my promise to send the report to Omar.',
        },
      ]),
    ).toEqual([{ code: 'missing_action', segments: [0] }]);
    expect(
      issuesFor([
        { speaker: 'Priya', text: 'I will replace the camera equipment list.' },
        {
          speaker: 'Priya',
          text: 'I am withdrawing my promise to replace the camera equipment list.',
        },
        { speaker: 'Priya', text: 'I will replace the camera equipment list.' },
      ]),
    ).toEqual([{ code: 'missing_action', segments: [2] }]);
  });

  it('does not require a recipient purpose tail as a second task', () => {
    expect(
      issuesFor(
        [
          {
            speaker: 'Priya',
            text: 'I will send the existing floor plan to Lena by Thursday so Lena can use it in visitor conversations.',
          },
        ],
        [
          {
            text: 'Send the existing floor plan to Lena by Thursday.',
            due: 'Thursday',
          },
        ],
      ),
    ).toEqual([]);
    expect(
      issuesFor(
        [
          {
            speaker: 'Ari',
            text: 'I will email the report to Nora so Nora can compare the annual figures.',
          },
        ],
        [{ text: 'Email the report to Nora.' }],
      ),
    ).toEqual([]);
  });

  it.each([
    [
      'recipient',
      'Send the existing floor plan to Omar by Thursday.',
      'Thursday',
    ],
    ['date', 'Send the existing floor plan to Lena by Friday.', 'Friday'],
    [
      'delivery verb',
      'Review the existing floor plan with Lena by Thursday.',
      'Thursday',
    ],
  ])(
    'preserves the actual %s outside the purpose clause',
    (_label, text, due) => {
      expect(
        issuesFor(
          [
            {
              speaker: 'Priya',
              text: 'I will send the existing floor plan to Lena by Thursday so Lena can use it in visitor conversations.',
            },
          ],
          [{ text, due }],
        ),
      ).toEqual([{ code: 'missing_action', segments: [0] }]);
    },
  );

  it('does not remove actual prerequisites or swallow a separate commitment', () => {
    expect(
      issuesFor(
        [
          {
            speaker: 'Priya',
            text: 'Once insurance approves, I will send the report to Lena so Lena can brief visitors.',
          },
        ],
        [{ text: 'Send the report to Lena.' }],
      ),
    ).toEqual([{ code: 'missing_condition', segments: [0] }]);
    expect(
      issuesFor(
        [
          {
            speaker: 'Priya',
            text: 'I will send the report to Lena so Lena can brief visitors and I will book the courier.',
          },
        ],
        [{ text: 'Send the report to Lena.' }],
      ),
    ).toEqual([{ code: 'missing_action', segments: [0] }]);
  });

  it('abstains from stripping ambiguous or conditional purpose context', () => {
    for (const text of [
      'I will send the report so Lena can compare the annual figures.',
      'I will send the report to Lena so Omar can compare the annual figures.',
      'I will send the report to Lena so Lena can compare the annual figures once legal approves.',
    ])
      expect(
        issuesFor(
          [{ speaker: 'Priya', text }],
          [{ text: 'Send the report to Lena.' }],
        ),
      ).not.toEqual([]);
  });

  it.each(['commit', 'promise'])(
    'does not hide a separate I %s to commitment in a purpose tail',
    (verb) => {
      expect(
        issuesFor(
          [
            {
              speaker: 'Priya',
              text: `I will send the report to Lena so Lena can brief visitors and I ${verb} to book the courier.`,
            },
          ],
          [{ text: 'Send the report to Lena.' }],
        ),
      ).toEqual([{ code: 'missing_action', segments: [0] }]);
    },
  );
});
