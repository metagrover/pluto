import { expect, it } from 'vitest';
import {
  type MeetingAskPlutoContext,
  withMeetingPrepContext,
} from '../../electron/intelligence/meetingAskPluto';
import { buildNotesWriterPrompt } from '../../electron/llm/meetingNotesPrompts';
import type { MeetingPrep } from '../../electron/meetingPrep';
const context: MeetingAskPlutoContext = {
  status: 'ready',
  scope: { type: 'live_meeting', meetingId: 'current', title: 'Launch' },
  trustStatus: 'weak_evidence',
  boundary: 'Current meeting only.',
  statusNote: 'Live',
  evidenceItems: [
    {
      id: 'spoken',
      kind: 'transcript',
      meetingId: 'current',
      title: 'Actual discussion',
      text: 'We agreed to launch Friday.',
    },
  ],
};
const prep = {
  notes: 'UNASKED QUESTION: Should we cancel the launch?',
  meetings: [
    {
      id: 'past-meeting',
      title: 'Launch review',
      date: '2026-09-20',
      participants: 'Sam',
      preview: 'Past meeting note',
      context: 'PAST MEETING SNAPSHOT: Old price proposal',
      capturedAt: '2026-09-27',
    },
  ],
  topics: [
    {
      id: 'topic',
      name: 'Pricing',
      context: 'Historical price proposal',
      sources: [
        { meetingId: 'past', title: 'Past pricing review', date: null },
      ],
      capturedAt: '2026-09-27',
    },
  ],
} as MeetingPrep;
it('makes prep available to Ask Pluto with an explicit planned-versus-discussed boundary', () => {
  const result = withMeetingPrepContext(context, prep);
  expect(
    result.evidenceItems.find((item) => item.id === 'prep-notes')?.text,
  ).toContain('UNASKED QUESTION');
  expect(
    result.evidenceItems.find((item) => item.id === 'prep-topic-topic')?.kind,
  ).toBe('prep');
  expect(result.boundary).toContain('never claim a planned question was asked');
  expect(
    result.evidenceItems.find(
      (item) => item.id === 'prep-meeting-past-meeting',
    ),
  ).toMatchObject({
    kind: 'prep',
    text: 'PAST MEETING SNAPSHOT: Old price proposal',
  });
  expect(context.evidenceItems).toHaveLength(1);
});
it('keeps unasked prep and topic references out of gist inputs while actual discussion remains', () => {
  const meetingInput = {
    sourceText: context.evidenceItems[0].text,
    userNotes: 'Mention Friday launch',
    knownTerms: [],
    template: 'auto' as const,
    prep,
  };
  const prompt = buildNotesWriterPrompt(meetingInput);
  expect(prompt).toContain('We agreed to launch Friday.');
  expect(prompt).not.toContain('UNASKED QUESTION');
  expect(prompt).not.toContain('Historical price proposal');
  expect(prompt).not.toContain('PAST MEETING SNAPSHOT');
});
it('supports prep-only questions without treating prep as transcript evidence', () => {
  const result = withMeetingPrepContext(
    { ...context, status: 'unavailable', evidenceItems: [] },
    prep,
  );
  expect(result.status).toBe('ready');
  expect(result.trustStatus).toBe('inferred');
  expect(result.evidenceItems.every((item) => item.kind === 'prep')).toBe(true);
});
it('passes richer prep suggestions to Ask Pluto as historical background', () => {
  const item = {
    id: 'history',
    text: 'The earlier review was delayed.',
    summary: 'The earlier review was delayed while the draft was unfinished.',
    trustStatus: 'inferred' as const,
    sourceMeetingId: 'past-meeting',
    sourceLabel: 'Launch review',
    sourceDate: '2026-09-20',
  };
  const result = withMeetingPrepContext(context, {
    ...prep,
    briefing: {
      title: 'Launch',
      startsAt: null,
      agenda: null,
      relationship: 'manual',
      priorMeeting: null,
      lastTime: [],
      stillOpen: [],
      relevantContext: [],
      emptyMessage: null,
      overview: [item],
      possibleNextSteps: [
        {
          ...item,
          id: 'next',
          summary: 'Consider checking the revised draft.',
        },
      ],
      watchouts: [
        {
          ...item,
          id: 'watch',
          summary: 'The unfinished draft may delay review again.',
        },
      ],
    },
  });
  const briefing = result.evidenceItems.find(
    (item) => item.id === 'prep-briefing',
  );
  expect(briefing?.kind).toBe('prep');
  expect(briefing?.text).toContain('Consider checking the revised draft.');
  expect(briefing?.text).toContain(
    'The unfinished draft may delay review again.',
  );
});
