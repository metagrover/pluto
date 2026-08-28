export interface MeetingNotesLocalGuardrailsCase {
  id: string;
  segments: Array<{ speaker: string; text: string }>;
  mechanicalContract: {
    actions: number | { min: number; max: number };
    decisions: { min: number; max: number };
    questions: number;
    actionOwner?: string;
    actionDue?: string;
  };
  reviewCriteria: string[];
}

// Declared before inference. Mechanical counts and fields do not establish
// source fidelity. Independently review every raw attempt and final visible
// claim against these criteria, not just provenance or hidden evidence.
// Record unfamiliar faithful paraphrases as manual adjudications without
// rewriting automated results. Null collective decision owners are valid;
// a speaker reporting a decision is not automatically its decision maker.
export const meetingNotesLocalGuardrailsCases: MeetingNotesLocalGuardrailsCase[] =
  [
    {
      id: 'personal',
      segments: [
        {
          speaker: 'Jun',
          text: 'My first sourdough was flat, but the second rose. That felt satisfying.',
        },
        {
          speaker: 'Esme',
          text: 'I have been restoring an old radio. The persistent hum is frustrating.',
        },
        {
          speaker: 'Jun',
          text: 'I enjoy experimenting, even when the results are not perfect.',
        },
        {
          speaker: 'Esme',
          text: 'We are just comparing our evenings, not asking each other for help.',
        },
      ],
      mechanicalContract: {
        actions: 0,
        decisions: { min: 0, max: 0 },
        questions: 0,
      },
      reviewCriteria: [
        "Attribute sourdough to Jun: the first was flat, the second rose, and the progress felt satisfying; retain Jun's enjoyment of imperfect experimentation.",
        'Attribute the old-radio restoration and frustrating persistent hum to Esme.',
        'Retain the personal exchange without fabricating help tasks, decisions, open questions, or gender.',
      ],
    },
    {
      id: 'qualified-publication',
      segments: [
        {
          speaker: 'Cleo',
          text: 'I will replace the product screenshots today.',
        },
        {
          speaker: 'Marin',
          text: 'I could animate the introduction if useful.',
        },
        {
          speaker: 'Cleo',
          text: 'We have decided to keep the introduction static because animation distracts from the instructions, so we will not take up that offer.',
        },
        {
          speaker: 'Cleo',
          text: "I'm withdrawing my screenshot replacement promise; the images are still accurate.",
        },
        {
          speaker: 'Cleo',
          text: 'Once the accessibility review passes, I will publish the captioned demonstration on the support portal by Wednesday.',
        },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 1, max: 2 },
        questions: 0,
        actionOwner: 'Cleo',
        actionDue: 'Wednesday',
      },
      reviewCriteria: [
        'Exactly one active action: Cleo publishes the captioned demonstration on the support portal by Wednesday, only once accessibility review passes. The prerequisite, destination, and due date must attach to that action.',
        "Retain Marin's animation offer as declined, the settled static-introduction choice, and the rationale that animation distracts from instructions.",
        'Retain screenshot replacement only as an explicitly withdrawn promise, with the reason that existing images are accurate; no active screenshot or animation task.',
        'One or two decisions are legitimate only if the second is the distinct screenshot cancellation, not a duplicate of declining animation. The static-introduction choice is required.',
      ],
    },
    {
      id: 'accepted-request-privacy',
      segments: [
        {
          speaker: 'Tariq',
          text: 'Bea, would you upload the anonymized survey table to the research workspace by Monday for Niko?',
        },
        {
          speaker: 'Niko',
          text: "I'll be using the table. Bea is preparing and uploading it, not me.",
        },
        {
          speaker: 'Bea',
          text: "Yes, I accept that task. I'll have the anonymized table there by Monday.",
        },
        {
          speaker: 'Tariq',
          text: "The decision is not to publish individual responses. Only aggregate counts may be published, to protect participants' confidentiality.",
        },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 1, max: 2 },
        questions: 0,
        actionOwner: 'Bea',
        actionDue: 'Monday',
      },
      reviewCriteria: [
        'Exactly one action: Bea accepts preparing and uploading the anonymized survey table to the research workspace by Monday for Niko. Niko is the intended user, not owner; Tariq is the requester.',
        "Retain the settled policy against publishing individual responses, allowing aggregate counts only, and the participants' confidentiality rationale.",
        'One combined or two complementary privacy decision records are legitimate; do not create an aggregate-publication task or a question from the already-accepted request.',
      ],
    },
  ];
