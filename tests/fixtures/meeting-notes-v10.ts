import { createNotesSource } from '../../electron/llm/meetingNotesSource';

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
