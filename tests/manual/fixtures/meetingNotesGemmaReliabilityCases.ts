import {
  type MeetingNotesLocalGuardrailsCase,
  meetingNotesLocalGuardrailsCases,
} from './meetingNotesLocalGuardrailsCases';

// Frozen before schema-constrained inference. Original cases remain unchanged.
// This longer multi-topic fixture checks early and late commitments without
// pretending synthetic text establishes real-recording or hierarchy acceptance.
export const meetingNotesGemmaReliabilityCases: MeetingNotesLocalGuardrailsCase[] =
  [
    ...meetingNotesLocalGuardrailsCases,
    {
      id: 'long-exhibition-planning',
      segments: [
        {
          speaker: 'Priya',
          text: 'Once the insurance certificate is approved, I will book the artwork courier by Thursday. The approval is a prerequisite, not just a useful document. The courier carries the framed pieces from storage to the gallery. Nothing in this discussion should turn that into an unconditional booking.',
        },
        {
          speaker: 'Omar',
          text: 'The gallery inspection happened yesterday. The loading door is wide enough for the largest crate, and the lift worked during our visit. We have already measured the route from the street. Those are completed checks, not jobs that need to be assigned again in these notes.',
        },
        {
          speaker: 'Lena',
          text: 'I was relieved by the lift result because carrying the pieces up the stairs had worried me. The lighting looked softer in the afternoon than in the morning photographs. That is an observation from the visit, not a request to buy new lighting or to change the installation.',
        },
        {
          speaker: 'Priya',
          text: 'I will replace the camera equipment list this afternoon. I thought the older list still included the broken tripod. Let me compare the version in the folder with the printed sheet while we talk through the visitor experience. I do not want duplicate equipment requests going to the venue.',
        },
        {
          speaker: 'Omar',
          text: 'I could record a narrated audio tour if that would be useful. I am offering an option, not taking on a task at this point. It would describe the materials rather than interpret the artists. No one has asked me to record anything or accepted this offer yet.',
        },
        {
          speaker: 'Lena',
          text: 'The visitors in the small trial liked having space to look without a running commentary. One person preferred to read, while another enjoyed discussing the work with a friend. These observations do not tell us what every visitor will want. We should not present three informal reactions as a survey result.',
        },
        {
          speaker: 'Priya',
          text: 'The artists have already supplied short descriptions for their own works. They are intentionally different in tone. One artist describes the tools, another describes a childhood memory. I would like the notes to preserve that variety rather than imply the artists agreed on a single interpretation of the exhibition.',
        },
        {
          speaker: 'Omar',
          text: 'The print estimate arrived this morning. A large catalogue run costs more than our remaining print budget. A hundred copies fit the budget, and visitors can also read the catalogue on their phones. The estimate is for the catalogue only; it says nothing about delivery insurance or the courier price.',
        },
        {
          speaker: 'Lena',
          text: 'We have decided to limit the printed catalogue to 100 copies and offer a QR link for additional readers because the larger print run exceeds the budget. That is our settled catalogue decision. This is not an instruction to limit entry to one hundred visitors, and it does not change the artwork count.',
        },
        {
          speaker: 'Priya',
          text: 'The catalogue PDF and its QR link already exist. The link opened correctly on both phones we tried. We are discussing how people access the catalogue, not asking someone to create a website or a new PDF. The printed copies and the existing digital copy contain the same artist descriptions.',
        },
        {
          speaker: 'Omar',
          text: 'The entrance has a bench beside the coat hooks. During the trial, an older visitor sat there before looking around. I mention that because the room felt welcoming, not because the bench needs to be moved or replaced. The access inspection already covered the doorway and the route around it.',
        },
        {
          speaker: 'Lena',
          text: 'I enjoyed hearing the artists compare their first attempts with the finished work. Some sounded proud and some were still unsure about how it would be received. Both reactions belong in our understanding of the exhibition. The uncertainty is not evidence that any artist has withdrawn a piece.',
        },
        {
          speaker: 'Priya',
          text: 'I am withdrawing my promise to replace the camera equipment list. The folder already contains the corrected list and the broken tripod has been removed. My earlier concern came from reading the obsolete printed sheet. There is no remaining equipment-list replacement task, and no one else is taking it over.',
        },
        {
          speaker: 'Omar',
          text: 'That correction concerns the camera list only. The artwork courier still depends on the insurance certificate being approved. A corrected equipment list is not a substitute for that approval. I am restating the distinction to avoid mixing two unrelated documents, not making another courier commitment myself.',
        },
        {
          speaker: 'Lena',
          text: 'The installation photographs are useful records of yesterday, but they are not a floor plan. From the images alone, it is hard to judge the distances between the freestanding pieces. I would use the actual floor plan when discussing the layout with visitors who ask about the route through the room.',
        },
        {
          speaker: 'Priya',
          text: 'The floor plan is in the shared folder. It shows the bench and both exits. The photographs make the entrance look narrower than it is because they were taken at an angle. We do not need to infer a new access problem from that perspective; the measured inspection has already been completed.',
        },
        {
          speaker: 'Omar',
          text: 'To clarify the audio idea, my offer remains unaccepted. There is no recording deadline and no agreement to include narration in this exhibition. I am comfortable leaving it as a possibility for another conversation. It should not be turned into an action simply because I said I could do it.',
        },
        {
          speaker: 'Lena',
          text: 'The preview conversation was encouraging, especially when visitors noticed details the artists had not expected anyone to notice. We do not have attendance numbers for the public opening yet. Please distinguish the small completed preview from the future opening rather than treating those reactions as a forecast of turnout.',
        },
        {
          speaker: 'Priya',
          text: 'I will send the existing floor plan to Lena by Thursday so Lena can use it in visitor conversations. This is a separate commitment from booking the courier and does not depend on insurance approval. I am sending the current document, not promising to redesign the layout or draw a replacement plan.',
        },
        {
          speaker: 'Lena',
          text: 'I am the recipient of the floor plan, not the person sending it. The existing document is enough for those conversations. We have not set a date for another planning meeting, and I am not asking anyone to schedule one here. That covers the distinction I wanted to make before we finish.',
        },
      ],
      mechanicalContract: {
        actions: 2,
        decisions: { min: 1, max: 2 },
        questions: 0,
        actionOwner: 'Priya',
        actionDue: 'Thursday',
      },
      reviewCriteria: [
        'Preserve both distinct current Priya commitments: book the artwork courier by Thursday only after insurance certificate approval; send the existing floor plan to Lena by Thursday without that prerequisite. Lena is a recipient, not sender.',
        'Retain cancellation of the camera-list replacement and the reason: the corrected list already exists. No active camera-list replacement, takeover, audio recording, inspection, catalogue creation or scheduling task.',
        'Preserve the settled 100-copy printed catalogue limit, existing QR alternative and print-budget rationale. Do not apply the number to attendance, artworks or courier costs. An additional decision may describe only the distinct camera-list cancellation.',
        "Retain Omar's audio-tour offer as unaccepted, not rejected or commissioned; completed access checks; Lena's relief and observations from the preview; artists' varied descriptions and mixed pride/uncertainty. Avoid invented gender or universal conclusions from informal visitor reactions.",
        'Compress repetition into readable topics without losing early commitment conditions, late recipient ownership or distinct cancellation scope. No unsupported open questions or attendance forecast.',
      ],
    },
  ];
