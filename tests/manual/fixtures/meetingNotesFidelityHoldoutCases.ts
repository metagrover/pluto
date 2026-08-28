import type { MeetingNotesLocalGuardrailsCase } from './meetingNotesLocalGuardrailsCases';

// Declared before inference for the final-fidelity continuation. Do not edit
// criteria after seeing model output. These are semantic controls, not a
// keyword-based oracle. Review all visible text and every unsuccessful attempt.
export const meetingNotesFidelityHoldoutCases: MeetingNotesLocalGuardrailsCase[] =
  [
    {
      id: 'heldout-log-operations',
      segments: [
        {
          speaker: 'Vesper',
          text: 'Aren, can you import the service logs into the incident workspace for me by Friday?',
        },
        {
          speaker: 'Kes',
          text: 'The files still contain customer identifiers. Aren is sanitizing and importing them; Vesper will read the result.',
        },
        {
          speaker: 'Aren',
          text: 'Yes, I accept both parts of that request. I will sanitize the service logs and import them into the incident workspace for Vesper by Friday.',
        },
        {
          speaker: 'Kes',
          text: 'The test import was completed yesterday using dummy records. It does not replace the sanitizing or import of the real service logs.',
        },
      ],
      mechanicalContract: {
        actions: { min: 1, max: 2 },
        decisions: { min: 0, max: 0 },
        questions: 0,
        actionOwner: 'Aren',
        actionDue: 'Friday',
      },
      reviewCriteria: [
        'Retain both accepted operations: sanitize customer identifiers from service logs and import those logs into the incident workspace. Aren owns both; Vesper is recipient; Friday is the deadline.',
        "Keep the completed dummy-record import distinct from the still-future real-log work. Do not assign work to Kes or infer anyone's gender.",
      ],
    },
    {
      id: 'heldout-completed-calibration',
      segments: [
        {
          speaker: 'Tavi',
          text: 'The spectrometer is already calibrated. I finished the calibration yesterday and saved the signed certificate in its case.',
        },
        {
          speaker: 'Noor',
          text: 'I will ship the calibrated spectrometer to Eren by Friday. I am accepting shipment only; I am not promising another calibration.',
        },
        {
          speaker: 'Eren',
          text: 'That works. I will be receiving the instrument, not calibrating or shipping it. The certificate records the completed work.',
        },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 0, max: 0 },
        questions: 0,
        actionOwner: 'Noor',
        actionDue: 'Friday',
      },
      reviewCriteria: [
        'Tavi completed calibration yesterday and saved its certificate. Keep this as completed context, never a new calibration task.',
        'Noor has accepted shipment only, to Eren by Friday. Eren is recipient, not owner. Preserve the limited acceptance without inventing gender.',
      ],
    },
    {
      id: 'heldout-separate-preparation-owner',
      segments: [
        {
          speaker: 'Ilan',
          text: 'I will submit the fellowship application to the foundation by Friday. I accept submission only, not proofreading.',
        },
        {
          speaker: 'Maren',
          text: 'The draft was proofread by Sora yesterday. Sora caught the missing reference number, and the correction is already in the file.',
        },
        {
          speaker: 'Sora',
          text: 'That describes my completed work. The file is ready for Ilan to submit. I am not submitting it or taking on more proofreading.',
        },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 0, max: 0 },
        questions: 0,
        actionOwner: 'Ilan',
        actionDue: 'Friday',
      },
      reviewCriteria: [
        "Ilan owns only Friday submission of the fellowship application to the foundation. Do not move Sora's proofreading into Ilan's future task.",
        "Retain Sora's completed proofreading and corrected missing reference number; no additional proofreading commitment or invented gender.",
      ],
    },
    {
      id: 'heldout-offer-dispositions',
      segments: [
        {
          speaker: 'Wren',
          text: 'I could narrate the orientation recording if useful.',
        },
        {
          speaker: 'Auden',
          text: 'We have decided not to take up the narration offer because spoken commentary competes with the screen reader. We will keep the orientation text-only.',
        },
        {
          speaker: 'Sol',
          text: 'I could sketch a new map. That is just an offer; no one has accepted it.',
        },
        {
          speaker: 'Auden',
          text: 'If the accessibility test fails, we will decline the map offer. The test has not happened, so no decision on that offer has been made.',
        },
        {
          speaker: 'Wren',
          text: 'We also decided to keep the existing room names because visitors know them. That separate choice does not accept or reject the map offer.',
        },
      ],
      mechanicalContract: {
        actions: 0,
        decisions: { min: 2, max: 3 },
        questions: 0,
      },
      reviewCriteria: [
        "Explicitly label Wren's narration offer declined, with screen-reader competition as the reason and text-only orientation as the chosen alternative.",
        "Sol's map offer remains unaccepted, not declined. Preserve the conditional possible refusal and pending accessibility test without inventing an assignment or open question.",
        'Retain the independent settled choice of existing room names and visitor-familiarity reason. It is not a decision on the map.',
      ],
    },
    {
      id: 'heldout-person-references',
      segments: [
        {
          speaker: 'Deryn',
          text: 'I use she and her. Repairing the garden gate was satisfying because it finally stopped scraping the path.',
        },
        {
          speaker: 'Rumi',
          text: 'I enjoyed making a small clay bowl, even though its rim came out uneven.',
        },
        {
          speaker: 'Deryn',
          text: "My cousin uses he and him. My cousin enjoyed visiting the pottery studio, but did not make Rumi's bowl.",
        },
        {
          speaker: 'Rumi',
          text: 'The exercise sheet said "Imagine she is a potter." That was a fictional character, not information about me. We are sharing experiences, not assigning each other tasks.',
        },
      ],
      mechanicalContract: {
        actions: 0,
        decisions: { min: 0, max: 0 },
        questions: 0,
      },
      reviewCriteria: [
        "Deryn repaired the gate; satisfaction came from stopping it scraping the path. Deryn's explicit she/her is supported, though using the name is also valid.",
        "Rumi enjoyed making an uneven-rimmed clay bowl. Do not transfer the cousin's he/him or the fictional character's she to Rumi, including in titles, overview or Recent Win.",
        "The cousin enjoyed the studio visit but did not make Rumi's bowl. No invented future tasks, decisions or questions.",
      ],
    },
    {
      id: 'heldout-renewed-offer',
      segments: [
        {
          speaker: 'Elian',
          text: 'I could record a pronunciation guide for the language workshop.',
        },
        {
          speaker: 'Kiran',
          text: 'We will not take up the recording offer while the script is unfinished.',
        },
        {
          speaker: 'Kiran',
          text: 'The script is now finished and approved. I am withdrawing that refusal. Elian, please record the pronunciation guide for the workshop by Friday.',
        },
        {
          speaker: 'Elian',
          text: 'I accept. I will record the approved pronunciation guide for the language workshop by Friday.',
        },
      ],
      mechanicalContract: {
        actions: 1,
        decisions: { min: 0, max: 1 },
        questions: 0,
        actionOwner: 'Elian',
        actionDue: 'Friday',
      },
      reviewCriteria: [
        'Elian now has an accepted Friday recording commitment. The earlier refusal was explicitly withdrawn after script approval; do not leave the offer described as currently declined or merely unaccepted.',
        'Script approval is completed, not a pending prerequisite or another task. Kiran is requester, not recording owner. Do not invent gender.',
      ],
    },
  ];
