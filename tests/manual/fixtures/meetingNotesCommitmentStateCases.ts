import type { MeetingNotesLocalGuardrailsCase } from './meetingNotesLocalGuardrailsCases';

// Fictional source controls; declare expectations before running inference.
// Counts alone do not prove fidelity: review every visible claim and citation.
export const meetingNotesCommitmentStateCases: MeetingNotesLocalGuardrailsCase[] =
  [
    {
      id: 'separated-acceptance',
      segments: [
        {
          speaker: 'Rowan',
          text: 'We need three sample reports for Mika by Friday.',
        },
        {
          speaker: 'Mika',
          text: 'The samples are for the accessibility review, not publication.',
        },
        {
          speaker: 'Rowan',
          text: 'The release itself is still pending approval.',
        },
        { speaker: 'Ellis', text: 'I will provide the three sample reports.' },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 0, max: 0 },
        questions: 0,
        actionOwner: 'Ellis',
        actionDue: 'Friday',
      },
      reviewCriteria: [
        'Ellis owns delivery of three sample reports to Mika by Friday; cite both scope/deadline and later acceptance. Rowan is requester and Mika recipient.',
        'Release approval remains pending. The samples are for accessibility review, not publication; do not invent release readiness.',
      ],
    },
    {
      id: 'interrupted-coordination',
      segments: [
        {
          speaker: 'Mika',
          text: 'The workshop schedule is the remaining work.',
        },
        { speaker: 'Ellis', text: "I'll coordinate" },
        { speaker: 'Ellis', text: 'how the workshop schedule progresses.' },
        { speaker: 'Mika', text: 'Thank you.' },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 0, max: 0 },
        questions: 0,
        actionOwner: 'Ellis',
      },
      reviewCriteria: [
        'Retain the explicit schedule-coordination commitment as an Ellis-owned action, supported by both parts of the interrupted sentence. No invented due date.',
      ],
    },
    {
      id: 'resolved-during-conversation',
      segments: [
        { speaker: 'Tavi', text: 'The export fails with a delimiter error.' },
        {
          speaker: 'Noor',
          text: 'I will rerun the export and tell Tavi if it still fails.',
        },
        {
          speaker: 'Tavi',
          text: 'We also discussed the report layout; no changes were agreed.',
        },
        {
          speaker: 'Noor',
          text: 'I just reran the export. It works after correcting the delimiter; there is no remaining error.',
        },
      ],
      mechanicalContract: {
        actions: 0,
        decisions: { min: 0, max: 0 },
        questions: 0,
      },
      reviewCriteria: [
        'Retain the completed rerun and delimiter fix as resolved context. No pending rerun or error notification; no visible claim that the export still fails. Layout discussion remains unsettled.',
      ],
    },
    {
      id: 'partial-completion',
      segments: [
        {
          speaker: 'Noor',
          text: 'I will check the archive and send the certificate to Tavi by Monday.',
        },
        { speaker: 'Tavi', text: 'I need the certificate for the inspection.' },
        {
          speaker: 'Noor',
          text: 'I have checked the archive. Sending the certificate is still outstanding; I will send it by Monday.',
        },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 0, max: 0 },
        questions: 0,
        actionOwner: 'Noor',
        actionDue: 'Monday',
      },
      reviewCriteria: [
        'Only certificate delivery to Tavi by Monday remains open, owned by Noor. Archive checking is completed context; do not withdraw the remaining delivery or keep checking as future work.',
      ],
    },
    {
      id: 'unaccepted-request-and-offer',
      segments: [
        {
          speaker: 'Rowan',
          text: 'Could you update the handbook by Tuesday, Ellis?',
        },
        {
          speaker: 'Ellis',
          text: 'I could help if time permits, but I am not accepting that task.',
        },
        {
          speaker: 'Mika',
          text: 'Nobody else has accepted it either. We have not decided what to do.',
        },
      ],
      mechanicalContract: {
        actions: 0,
        decisions: { min: 0, max: 0 },
        questions: 0,
      },
      reviewCriteria: [
        'Retain the unaccepted handbook request and conditional willingness as discussion. No owner, accepted Tuesday action, or invented decision.',
      ],
    },
    {
      id: 'renewed-after-cancellation',
      segments: [
        { speaker: 'Tavi', text: 'I will upload the inventory by Friday.' },
        {
          speaker: 'Tavi',
          text: 'Cancel my inventory upload; the portal is unavailable.',
        },
        { speaker: 'Noor', text: 'The portal is now repaired.' },
        {
          speaker: 'Tavi',
          text: 'I am renewing my commitment. I will upload the inventory by Monday instead.',
        },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 0, max: 1 },
        questions: 0,
        actionOwner: 'Tavi',
        actionDue: 'Monday',
      },
      reviewCriteria: [
        'The latest state is Tavi-owned Monday inventory upload. Preserve the cancellation and renewed commitment without retaining Friday as a live deadline or treating the latest task as cancelled.',
      ],
    },
  ];
