import type { MeetingNotesLocalGuardrailsCase } from '../manual/fixtures/meetingNotesLocalGuardrailsCases';

// Fictional paired controls, declared before inference. Assess material meaning
// against the source; neither mechanical counts nor preferred wording prove it.
export const meetingNotesSourceCoverageCases: MeetingNotesLocalGuardrailsCase[] =
  [
    {
      id: 'ordered-prerequisite-chain',
      segments: [
        {
          speaker: 'Ellis',
          text: 'For the community lantern workshop, the hall booking must be confirmed first. Only after that confirmation may the exit inspection take place. The workshop can open only after the inspection passes.',
        },
        {
          speaker: 'Rowan',
          text: 'I accept responsibility for opening the workshop on Saturday, provided those steps finish in that order. I am not taking on the booking confirmation or the exit inspection.',
        },
        {
          speaker: 'Ellis',
          text: 'The booking is still awaiting confirmation and the inspection has not happened. Saturday is the intended opening date, not permission to bypass either step.',
        },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 0, max: 1 },
        questions: 0,
        actionOwner: 'Rowan',
        actionDue: 'Saturday',
      },
      reviewCriteria: [
        'Retain the accepted conditional workshop-opening responsibility, owned by Rowan with Saturday as the intended date; do not assign the prerequisite work to Rowan or Ellis.',
        'Preserve the explicit causal sequence: hall-booking confirmation must precede the exit inspection, and a passing inspection must precede opening. An unordered list of two conditions loses material meaning.',
        'Both prerequisites remain pending: confirmation has not arrived and inspection has not happened. Do not portray approval, inspection, or opening as completed or unconditional.',
      ],
    },
    {
      id: 'unordered-required-conditions',
      segments: [
        {
          speaker: 'Ellis',
          text: 'For the community lantern workshop, both hall-booking confirmation and a passing exit inspection are required before opening. They are independent checks and may finish in either order.',
        },
        {
          speaker: 'Rowan',
          text: 'I accept responsibility for opening the workshop on Saturday once both checks are complete. I am not taking on the booking confirmation or the exit inspection.',
        },
        {
          speaker: 'Ellis',
          text: 'The booking is still awaiting confirmation and the inspection has not happened. Saturday is the intended opening date, not permission to bypass either check.',
        },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 0, max: 1 },
        questions: 0,
        actionOwner: 'Rowan',
        actionDue: 'Saturday',
      },
      reviewCriteria: [
        'Retain the accepted conditional workshop-opening responsibility, owned by Rowan with Saturday as the intended date; do not assign the prerequisite work to Rowan or Ellis.',
        'Preserve the conjunction: opening requires both hall-booking confirmation and a passing exit inspection. Neither check depends on the other; do not invent a booking-before-inspection or inspection-before-booking sequence.',
        'Both prerequisites remain pending: confirmation has not arrived and inspection has not happened. Do not portray either check or the opening as completed or unconditional.',
      ],
    },
  ];
