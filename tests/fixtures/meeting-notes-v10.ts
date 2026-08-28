import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesAudit,
  NotesContext,
  NotesDraft,
} from '../../electron/llm/meetingNotesTypes';

const segment = (speaker: string, text: string) => ({ speaker, text });

export const sourceGroundingCases = {
  firstPersonAction: [segment('Nira', 'I will send the outline by Friday.')],
  acceptedRequest: [
    segment('Nira', 'Could you send the outline to the reviewers?'),
    segment('Milo', 'Yes, I will do that.'),
  ],
  unacceptedSuggestion: [
    segment('Nira', 'Maybe someone could send the outline.'),
    segment('Milo', 'Let us discuss it next week.'),
  ],
  conditionalAdvice: [
    segment(
      'Nira',
      'If the certification is delayed, we should notify customers.',
    ),
  ],
  currentVersusPossible: [
    segment(
      'Milo',
      'We have 12 open seats; if none fill, the launch may slip.',
    ),
  ],
  codeAndDependencies: [
    segment(
      'Nira',
      'Place the parser in core; keep auth as a shared dependency.',
    ),
  ],
  spellingAmbiguity: [
    segment(
      'Milo',
      'The service might be called Kora or Cora; do not normalize it yet.',
    ),
  ],
  brainstorming: [
    segment('Nira', 'What if the weekly update were a short voice memo?'),
    segment('Milo', 'That is interesting, but no decision today.'),
  ],
  longDialogue: [
    segment('Nira', 'Context before the commitment.'),
    segment('Milo', 'I will send the outline after legal approves it.'),
    segment('Nira', 'More discussion in the middle.'),
    segment('Milo', 'Do not send the outline; legal rejected that plan.'),
  ],
} as const;

export const expectedCorrectedPropositions = {
  firstPersonAction: 'Nira will send the outline by Friday.',
  acceptedRequest: 'Milo accepted responsibility for sending the outline.',
  unacceptedSuggestion: 'The suggestion remains unaccepted.',
  conditionalAdvice:
    'Customer notification is conditional on certification delay.',
  currentVersusPossible:
    'There are currently 12 open seats; a launch slip is possible, not current.',
  codeAndDependencies: 'The parser belongs in core and auth remains shared.',
  spellingAmbiguity: 'The service spelling is unresolved.',
  brainstorming:
    'The group brainstormed a voice memo without deciding or assigning work.',
  longDialogue:
    'Milo cancelled the conditional outline commitment after legal rejected the plan.',
} as const;

export const makeSyntheticNotesSource = (
  segments: ReadonlyArray<{ speaker: string; text: string }>,
) => createNotesSource(JSON.stringify({ segments }));

export const makeNotesContext = (): NotesContext => ({
  userNotes: '',
  template: 'auto',
  trustedUserTerms: [],
  entityHints: [],
});

export const makeDirectNotesFixture = () => {
  const text = 'I will send the outline.';
  const source = makeSyntheticNotesSource([segment('Milo', text)]);
  const span = { segment: 0, start: 0, end: text.length };
  const draft: NotesDraft = {
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 's0',
        title: {
          id: 's0:title',
          text: 'Outline',
          sources: [span],
        },
        items: [
          {
            id: 's0:item:0',
            kind: 'action',
            text: 'Send the outline',
            sources: [span],
            owner: 'Milo',
            due: null,
          },
        ],
      },
    ],
  };
  const audit: NotesAudit = {
    changes: [],
    verdicts: [
      { target: 's0:title', status: 'supported', sources: [span] },
      { target: 's0:item:0', status: 'supported', sources: [span] },
    ],
    dispositions: [],
    terminology: [],
  };
  return {
    source,
    draft,
    audit,
    expectedAction: { text: 'Send the outline', assignee: 'Milo' },
  };
};
