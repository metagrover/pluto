import type {
  LocalIntelligenceNotesCase,
  NotesGoldClaim,
} from './localIntelligenceEvaluationCases';
import type { NotesProjectionExpectation } from './localIntelligenceNotesScoring';

type SemanticSpec = {
  id: string;
  profile: LocalIntelligenceNotesCase['syntheticProfile'];
  durationClass: LocalIntelligenceNotesCase['durationClass'];
  coverageTags: LocalIntelligenceNotesCase['coverageTags'];
  segments: LocalIntelligenceNotesCase['segments'];
  claims: Array<{
    id: string;
    segmentIndexes: number[];
    kind: NotesProjectionExpectation['kind'];
    requiredTerms: string[];
    evidenceTerms?: string[];
    critical?: boolean;
    modality: NotesGoldClaim['modality'];
    owner?: string | null;
    due?: string | null;
  }>;
  forbiddenClaims: string[];
};

const semanticCase = (spec: SemanticSpec): LocalIntelligenceNotesCase => ({
  id: spec.id,
  lane: 'meeting_notes',
  partition: 'held_out',
  failureIds: [],
  durationClass: spec.durationClass,
  syntheticProfile: spec.profile,
  coverageTags: spec.coverageTags,
  segments: spec.segments,
  gold: {
    expectedBehavior: 'supported_output',
    forbiddenClaims: spec.forbiddenClaims,
    requiredClaims: spec.claims.map(
      (claim): NotesGoldClaim => ({
        id: claim.id,
        evidence: claim.segmentIndexes.map((segmentIndex) => ({
          sourceId: `segment-${segmentIndex}`,
          excerpt: spec.segments[segmentIndex]!.text,
        })),
        requiredTerms: claim.requiredTerms,
        critical: claim.critical ?? true,
        modality: claim.modality,
        ...(typeof claim.owner === 'string' ? { owner: claim.owner } : {}),
        ...(typeof claim.due === 'string' ? { date: claim.due } : {}),
        notesProjection: {
          kind: claim.kind,
          requiredTextTerms: claim.requiredTerms,
          requiredEvidenceTerms:
            claim.evidenceTerms ??
            claim.segmentIndexes.map((index) => spec.segments[index]!.text),
          ...(claim.owner !== undefined ? { owner: claim.owner } : {}),
          ...(claim.due !== undefined ? { due: claim.due } : {}),
        },
      }),
    ),
  },
});

export const phiNotesHeldOutCases: LocalIntelligenceNotesCase[] = [
  semanticCase({
    id: 'phi-semantic-short-recipient-decoy',
    profile: 'short',
    durationClass: 'ordinary',
    coverageTags: ['beginning_evidence', 'owner_handoff'],
    segments: [
      {
        speaker: 'Asha',
        text: 'Ben, could you ask Cleo to validate the export?',
      },
      {
        speaker: 'Ben',
        text: 'Cleo, Asha is requesting the validation from you.',
      },
      {
        speaker: 'Cleo',
        text: 'Yes. I accept it and will validate the export by Wednesday.',
      },
    ],
    claims: [
      {
        id: 'cleo-export-validation',
        segmentIndexes: [0, 1, 2],
        kind: 'action',
        requiredTerms: ['cleo', 'validate the export', 'wednesday'],
        modality: 'committed',
        owner: 'Cleo',
        due: 'Wednesday',
      },
    ],
    forbiddenClaims: [
      'asha owns the export validation',
      'ben owns the export validation',
    ],
  }),
  semanticCase({
    id: 'phi-semantic-short-corrected-deadline',
    profile: 'short',
    durationClass: 'ordinary',
    coverageTags: ['beginning_evidence', 'date_correction'],
    segments: [
      {
        speaker: 'Diego',
        text: 'I will deliver the compliance matrix on May 14.',
      },
      { speaker: 'Diego', text: 'Correction: make that May 21, not May 14.' },
      {
        speaker: 'Edda',
        text: "May 21 is the final deadline for Diego's matrix.",
      },
    ],
    claims: [
      {
        id: 'diego-matrix-corrected-date',
        segmentIndexes: [0, 1, 2],
        kind: 'action',
        requiredTerms: ['diego', 'compliance matrix', 'may 21'],
        modality: 'committed',
        owner: 'Diego',
        due: 'May 21',
      },
    ],
    forbiddenClaims: ['compliance matrix is due may 14'],
  }),
  semanticCase({
    id: 'phi-semantic-short-declined-proposal',
    profile: 'short',
    durationClass: 'ordinary',
    coverageTags: ['explicit_no_decision', 'explicit_no_action'],
    segments: [
      {
        speaker: 'Farah',
        text: 'Should we publish the beta dashboard tomorrow?',
      },
      {
        speaker: 'Gus',
        text: 'No. We decline that proposal because the privacy review is open.',
      },
      {
        speaker: 'Farah',
        text: 'Confirmed: no dashboard publication action was assigned.',
      },
    ],
    claims: [
      {
        id: 'dashboard-proposal-declined',
        segmentIndexes: [1, 2],
        kind: 'decision',
        requiredTerms: ['dashboard', 'declined|decline', 'privacy review'],
        modality: 'fact',
        owner: null,
      },
      {
        id: 'dashboard-no-action',
        segmentIndexes: [2],
        kind: 'point',
        requiredTerms: ['dashboard', 'no action|no publication action'],
        modality: 'fact',
        owner: null,
        due: null,
      },
    ],
    forbiddenClaims: ['beta dashboard will be published tomorrow'],
  }),
  semanticCase({
    id: 'phi-semantic-ordinary-final-turn',
    profile: 'ordinary',
    durationClass: 'ordinary',
    coverageTags: ['middle_evidence', 'end_evidence'],
    segments: [
      {
        speaker: 'Hana',
        text: 'The team reviewed twelve localization defects.',
      },
      {
        speaker: 'Ivo',
        text: 'German and Polish remain the two release-blocking locales.',
      },
      {
        speaker: 'Jules',
        text: 'We still need a named owner for the glossary.',
      },
      {
        speaker: 'Keiko',
        text: 'Before we close: I will finish the glossary by June 8.',
      },
    ],
    claims: [
      {
        id: 'release-blocking-locales',
        segmentIndexes: [1],
        kind: 'point',
        requiredTerms: ['german', 'polish', 'release-blocking'],
        modality: 'fact',
      },
      {
        id: 'keiko-final-glossary-commitment',
        segmentIndexes: [2, 3],
        kind: 'action',
        requiredTerms: ['keiko', 'glossary', 'june 8'],
        modality: 'committed',
        owner: 'Keiko',
        due: 'June 8',
      },
    ],
    forbiddenClaims: ['the glossary has no owner'],
  }),
  semanticCase({
    id: 'phi-semantic-ordinary-unmet-prerequisite',
    profile: 'ordinary',
    durationClass: 'ordinary',
    coverageTags: ['conditionality', 'explicit_no_action', 'end_evidence'],
    segments: [
      {
        speaker: 'Malik',
        text: 'If the legal waiver arrives, Noura can import the archive on July 2.',
      },
      {
        speaker: 'Noura',
        text: 'The archive contains forty-two historical contracts.',
      },
      { speaker: 'Oren', text: 'Legal rejected the waiver request.' },
      {
        speaker: 'Malik',
        text: 'That prerequisite failed, so Noura has no archive-import action.',
      },
    ],
    claims: [
      {
        id: 'archive-contract-quantity',
        segmentIndexes: [1],
        kind: 'point',
        requiredTerms: ['forty-two|42', 'historical contracts'],
        modality: 'fact',
      },
      {
        id: 'archive-prerequisite-unmet',
        segmentIndexes: [0, 2, 3],
        kind: 'point',
        requiredTerms: ['noura', 'archive', 'waiver', 'no action'],
        modality: 'conditional',
        owner: null,
        due: null,
      },
    ],
    forbiddenClaims: ['noura will import the archive on july 2'],
  }),
  semanticCase({
    id: 'phi-semantic-ordinary-withdraw-retain',
    profile: 'ordinary',
    durationClass: 'ordinary',
    coverageTags: ['withdrawal', 'middle_evidence', 'end_evidence'],
    segments: [
      {
        speaker: 'Petra',
        text: 'Qasim will draft the launch FAQ by August 4.',
      },
      {
        speaker: 'Qasim',
        text: 'I am also listed for the partner email by August 5.',
      },
      {
        speaker: 'Rhea',
        text: 'Withdraw the partner email task because sales owns that channel.',
      },
      {
        speaker: 'Petra',
        text: "Retain Qasim's FAQ task; support needs it for agent training.",
      },
    ],
    claims: [
      {
        id: 'qasim-faq-retained',
        segmentIndexes: [0, 3],
        kind: 'action',
        requiredTerms: ['qasim', 'launch faq', 'august 4'],
        modality: 'committed',
        owner: 'Qasim',
        due: 'August 4',
      },
      {
        id: 'partner-email-withdrawn-reason',
        segmentIndexes: [1, 2],
        kind: 'point',
        requiredTerms: ['partner email', 'withdrawn|withdraw', 'sales'],
        modality: 'withdrawn',
      },
      {
        id: 'faq-retention-reason',
        segmentIndexes: [3],
        kind: 'point',
        requiredTerms: ['support', 'agent training'],
        modality: 'fact',
        critical: false,
      },
    ],
    forbiddenClaims: ['qasim will send the partner email'],
  }),
  semanticCase({
    id: 'phi-semantic-ordinary-unrelated-same-names',
    profile: 'ordinary',
    durationClass: 'ordinary',
    coverageTags: ['unrelated_topic_negative', 'date_correction'],
    segments: [
      {
        speaker: 'Sana',
        text: 'Project Cedar catering is booked with Rowan for September 9.',
      },
      {
        speaker: 'Tariq',
        text: 'A separate Cedar database cutover also mentions Rowan.',
      },
      {
        speaker: 'Uma',
        text: 'For the database only, Uma owns the checksum report due September 9.',
      },
      {
        speaker: 'Sana',
        text: 'Who will verify the database rollback window?',
      },
    ],
    claims: [
      {
        id: 'cedar-database-checksum',
        segmentIndexes: [1, 2],
        kind: 'action',
        requiredTerms: ['uma', 'checksum report', 'september 9', 'database'],
        modality: 'committed',
        owner: 'Uma',
        due: 'September 9',
      },
      {
        id: 'cedar-rollback-question',
        segmentIndexes: [3],
        kind: 'question',
        requiredTerms: ['database rollback window'],
        modality: 'fact',
      },
    ],
    forbiddenClaims: [
      'rowan owns the database checksum report',
      'catering caused the database cutover',
    ],
  }),
  semanticCase({
    id: 'phi-semantic-long-handoff-superseded-date',
    profile: 'long_dense',
    durationClass: 'long',
    coverageTags: [
      'beginning_evidence',
      'middle_evidence',
      'end_evidence',
      'owner_handoff',
      'date_correction',
    ],
    segments: [
      {
        speaker: 'Vera',
        text: 'Waleed initially owns the recovery guide due October 1.',
      },
      {
        speaker: 'Waleed',
        text: 'The guide defines a recovery point as the latest verified snapshot.',
      },
      {
        speaker: 'Xinyi',
        text: 'We measured a seventeen-minute restore in staging.',
      },
      {
        speaker: 'Vera',
        text: 'Transfer the recovery guide from Waleed to Yara.',
      },
      {
        speaker: 'Yara',
        text: 'I accept ownership, but October 1 is no longer possible.',
      },
      {
        speaker: 'Xinyi',
        text: 'Final date: Yara will deliver the guide on October 6.',
      },
      { speaker: 'Vera', text: 'What is the production restore target?' },
    ],
    claims: [
      {
        id: 'recovery-guide-final-owner-date',
        segmentIndexes: [0, 3, 4, 5],
        kind: 'action',
        requiredTerms: ['yara', 'recovery guide', 'october 6'],
        modality: 'committed',
        owner: 'Yara',
        due: 'October 6',
      },
      {
        id: 'recovery-point-definition',
        segmentIndexes: [1],
        kind: 'point',
        requiredTerms: ['recovery point', 'latest verified snapshot'],
        modality: 'fact',
        critical: false,
      },
      {
        id: 'restore-measurement',
        segmentIndexes: [2],
        kind: 'point',
        requiredTerms: ['seventeen-minute|17-minute', 'restore'],
        modality: 'fact',
        critical: false,
      },
      {
        id: 'production-restore-question',
        segmentIndexes: [6],
        kind: 'question',
        requiredTerms: ['production restore target'],
        modality: 'fact',
      },
    ],
    forbiddenClaims: [
      'waleed remains the recovery guide owner',
      'recovery guide is due october 1',
    ],
  }),
  semanticCase({
    id: 'phi-semantic-long-separated-decision-action',
    profile: 'long_dense',
    durationClass: 'long',
    coverageTags: [
      'beginning_evidence',
      'middle_evidence',
      'end_evidence',
      'explicit_no_action',
    ],
    segments: [
      {
        speaker: 'Zora',
        text: 'We are considering encrypted exports for the research workspace.',
      },
      { speaker: 'Amin', text: 'Do not treat the discussion as approval yet.' },
      { speaker: 'Bela', text: 'The export key rotates every thirty days.' },
      {
        speaker: 'Zora',
        text: 'Decision: use encrypted exports for research only.',
      },
      { speaker: 'Amin', text: 'No public-workspace export was approved.' },
      {
        speaker: 'Bela',
        text: 'I will document the research export flow by November 12.',
      },
    ],
    claims: [
      {
        id: 'encrypted-research-decision',
        segmentIndexes: [0, 1, 3, 4],
        kind: 'decision',
        requiredTerms: ['encrypted exports', 'research only'],
        modality: 'fact',
        owner: null,
      },
      {
        id: 'key-rotation-quantity',
        segmentIndexes: [2],
        kind: 'point',
        requiredTerms: ['key', 'thirty days|30 days'],
        modality: 'fact',
        critical: false,
      },
      {
        id: 'bela-export-documentation',
        segmentIndexes: [5],
        kind: 'action',
        requiredTerms: ['bela', 'research export flow', 'november 12'],
        modality: 'committed',
        owner: 'Bela',
        due: 'November 12',
      },
    ],
    forbiddenClaims: ['public-workspace export was approved'],
  }),
  semanticCase({
    id: 'phi-semantic-long-condition-cancel-renew',
    profile: 'long_dense',
    durationClass: 'long',
    coverageTags: [
      'conditionality',
      'withdrawal',
      'middle_evidence',
      'end_evidence',
    ],
    segments: [
      {
        speaker: 'Cora',
        text: 'If load testing passes, Dae can enable the queue on December 2.',
      },
      {
        speaker: 'Dae',
        text: 'The queue limit is defined as eight hundred pending jobs.',
      },
      {
        speaker: 'Emil',
        text: 'Load testing passed, so Dae accepted the December 2 task.',
      },
      {
        speaker: 'Cora',
        text: 'Cancel that task: the vendor certificate expired.',
      },
      { speaker: 'Emil', text: 'The certificate was renewed this afternoon.' },
      {
        speaker: 'Dae',
        text: 'I renew my commitment and will enable the queue on December 5.',
      },
      {
        speaker: 'Cora',
        text: 'Why did certificate renewal take three hours?',
      },
    ],
    claims: [
      {
        id: 'queue-renewed-final-commitment',
        segmentIndexes: [0, 2, 3, 4, 5],
        kind: 'action',
        requiredTerms: ['dae', 'enable the queue', 'december 5'],
        modality: 'committed',
        owner: 'Dae',
        due: 'December 5',
      },
      {
        id: 'queue-limit-definition',
        segmentIndexes: [1],
        kind: 'point',
        requiredTerms: ['queue limit', 'eight hundred|800', 'pending jobs'],
        modality: 'fact',
        critical: false,
      },
      {
        id: 'certificate-renewal-question',
        segmentIndexes: [6],
        kind: 'question',
        requiredTerms: ['certificate renewal', 'three hours'],
        modality: 'fact',
      },
    ],
    forbiddenClaims: ['dae will enable the queue on december 2'],
  }),
  semanticCase({
    id: 'phi-semantic-sparse-many-decoys',
    profile: 'adversarial_sparse',
    durationClass: 'long',
    coverageTags: [
      'middle_evidence',
      'unrelated_topic_negative',
      'dense_multi_claim',
    ],
    segments: [
      { speaker: 'Fiona', text: 'Galen booked Room April for January 7.' },
      {
        speaker: 'Galen',
        text: 'Hye mentioned January 7 while discussing payroll.',
      },
      {
        speaker: 'Hye',
        text: 'The name Indigo appears in both the office map and the mobile release.',
      },
      {
        speaker: 'Indigo',
        text: 'For the mobile release only, I will sign the accessibility report by January 7.',
      },
      {
        speaker: 'Fiona',
        text: 'The office map has no relationship to mobile accessibility.',
      },
      {
        speaker: 'Galen',
        text: 'Accessibility means keyboard and screen-reader parity here.',
      },
    ],
    claims: [
      {
        id: 'indigo-accessibility-report',
        segmentIndexes: [2, 3, 4],
        kind: 'action',
        requiredTerms: [
          'indigo',
          'accessibility report',
          'january 7',
          'mobile release',
        ],
        modality: 'committed',
        owner: 'Indigo',
        due: 'January 7',
      },
      {
        id: 'accessibility-definition',
        segmentIndexes: [5],
        kind: 'point',
        requiredTerms: ['accessibility', 'keyboard', 'screen-reader'],
        modality: 'fact',
        critical: false,
      },
    ],
    forbiddenClaims: [
      'galen owns the accessibility report',
      'office map caused the mobile release',
    ],
  }),
  semanticCase({
    id: 'phi-semantic-sparse-separated-negative',
    profile: 'adversarial_sparse',
    durationClass: 'long',
    coverageTags: [
      'conditionality',
      'explicit_no_action',
      'end_evidence',
      'unrelated_topic_negative',
    ],
    segments: [
      {
        speaker: 'Joon',
        text: 'If procurement approves the sensor, Kira may deploy it on February 18.',
      },
      {
        speaker: 'Kira',
        text: 'The cafeteria replaces a freezer on February 18.',
      },
      { speaker: 'Leif', text: 'We reviewed nine unrelated battery charts.' },
      { speaker: 'Joon', text: 'Procurement declined the sensor order.' },
      {
        speaker: 'Kira',
        text: 'The freezer date does not satisfy the sensor prerequisite.',
      },
      {
        speaker: 'Leif',
        text: 'Final state: Kira has no sensor deployment action.',
      },
    ],
    claims: [
      {
        id: 'sensor-condition-final-negative',
        segmentIndexes: [0, 3, 4, 5],
        kind: 'point',
        requiredTerms: ['kira', 'sensor', 'procurement', 'no action'],
        modality: 'conditional',
        owner: null,
        due: null,
      },
      {
        id: 'battery-chart-quantity',
        segmentIndexes: [2],
        kind: 'point',
        requiredTerms: ['nine|9', 'battery charts'],
        modality: 'fact',
        critical: false,
      },
    ],
    forbiddenClaims: [
      'kira will deploy the sensor on february 18',
      'freezer date approved the sensor',
    ],
  }),
];

export type PhiNotesCapacityMetadata = {
  assumedDurationMinutes: number;
  durationProvenance: 'synthetic_ordinary_meeting_assumption';
  sourceCharacters: number;
  segmentCount: number;
  language: 'en';
  density: 'ordinary';
  criticalItemPositions: number[];
  expectedWriterParts: 2 | 3 | 4;
  estimatedSourceTokens: number;
  editorFit: 'blocked_at_16384';
  measuredContextTokens: 16_384;
  plannerOutcome: 'notes_source_first_capacity_exceeded';
};

export type PhiNotesCapacityCase = LocalIntelligenceNotesCase & {
  collection: 'ordinary_capacity';
  capacity: PhiNotesCapacityMetadata;
};

const capacityTopics = [
  'support rotation',
  'localization review',
  'billing migration',
  'release telemetry',
  'accessibility audit',
  'backup verification',
  'vendor onboarding',
  'incident rehearsal',
] as const;

const capacitySegments = (
  label: string,
  count: number,
  criticalIndex: number,
): LocalIntelligenceNotesCase['segments'] =>
  Array.from({ length: count }, (_, index) => {
    if (index === criticalIndex) {
      return {
        speaker: 'Morgan',
        text: `For ${label}, Morgan accepts the final verification and will publish the signed checklist by April 24.`,
      };
    }
    const topic = capacityTopics[index % capacityTopics.length];
    const speaker = ['Alex', 'Blair', 'Casey', 'Devon'][index % 4]!;
    const qualifier = [
      'with no ownership change',
      'while one measurement remains open',
      'without treating the calendar hint as evidence',
      'and the team recorded a provisional count',
      'before returning to the main agenda',
    ][index % 5]!;
    return {
      speaker,
      text: `${label} agenda item ${index + 1}: ${speaker} reviewed ${topic} ${qualifier}; this distinct synthetic turn records checkpoint ${index + 1}.`,
    };
  });

const makeCapacityCase = ({
  id,
  label,
  segmentCount,
  criticalIndex,
  assumedDurationMinutes,
  expectedWriterParts,
  sourceCharacters,
}: {
  id: string;
  label: string;
  segmentCount: number;
  criticalIndex: number;
  assumedDurationMinutes: number;
  expectedWriterParts: 2 | 3 | 4;
  sourceCharacters: number;
}): PhiNotesCapacityCase => {
  const segments = capacitySegments(label, segmentCount, criticalIndex);
  const criticalText = segments[criticalIndex]!.text;
  return {
    id,
    lane: 'meeting_notes',
    collection: 'ordinary_capacity',
    partition: 'held_out',
    failureIds: [],
    durationClass: assumedDurationMinutes >= 35 ? 'long' : 'ordinary',
    syntheticProfile: assumedDurationMinutes >= 35 ? 'long_dense' : 'ordinary',
    coverageTags: [
      'beginning_evidence',
      'middle_evidence',
      'end_evidence',
      'dense_multi_claim',
    ],
    segments,
    capacity: {
      assumedDurationMinutes,
      durationProvenance: 'synthetic_ordinary_meeting_assumption',
      sourceCharacters,
      segmentCount,
      language: 'en',
      density: 'ordinary',
      criticalItemPositions: [criticalIndex],
      expectedWriterParts,
      estimatedSourceTokens: Math.ceil(sourceCharacters / 4),
      editorFit: 'blocked_at_16384',
      measuredContextTokens: 16_384,
      plannerOutcome: 'notes_source_first_capacity_exceeded',
    },
    gold: {
      expectedBehavior: 'supported_output',
      forbiddenClaims: [`Morgan declined the ${label} verification`],
      requiredClaims: [
        {
          id: `${id}-verification`,
          evidence: [
            { sourceId: `segment-${criticalIndex}`, excerpt: criticalText },
          ],
          requiredTerms: ['morgan', 'signed checklist', 'april 24', label],
          critical: true,
          modality: 'committed',
          owner: 'Morgan',
          date: 'April 24',
          notesProjection: {
            kind: 'action',
            requiredTextTerms: [
              'morgan',
              'signed checklist',
              'april 24',
              label,
            ],
            requiredEvidenceTerms: [criticalText],
            owner: 'Morgan',
            due: 'April 24',
          },
        },
      ],
    },
  };
};

export const phiNotesOrdinaryCapacityCases: PhiNotesCapacityCase[] = [
  makeCapacityCase({
    id: 'phi-capacity-20m-a',
    label: 'Northstar',
    segmentCount: 72,
    criticalIndex: 35,
    assumedDurationMinutes: 20,
    expectedWriterParts: 2,
    sourceCharacters: 10_627,
  }),
  makeCapacityCase({
    id: 'phi-capacity-24m-b',
    label: 'Orchid',
    segmentCount: 82,
    criticalIndex: 61,
    assumedDurationMinutes: 24,
    expectedWriterParts: 2,
    sourceCharacters: 11_853,
  }),
  makeCapacityCase({
    id: 'phi-capacity-28m-c',
    label: 'Quartz',
    segmentCount: 92,
    criticalIndex: 12,
    assumedDurationMinutes: 28,
    expectedWriterParts: 2,
    sourceCharacters: 13_296,
  }),
  makeCapacityCase({
    id: 'phi-capacity-30m-d',
    label: 'Redwood',
    segmentCount: 102,
    criticalIndex: 88,
    assumedDurationMinutes: 30,
    expectedWriterParts: 2,
    sourceCharacters: 14_869,
  }),
  makeCapacityCase({
    id: 'phi-capacity-32m-e',
    label: 'Solstice',
    segmentCount: 135,
    criticalIndex: 67,
    assumedDurationMinutes: 32,
    expectedWriterParts: 3,
    sourceCharacters: 19_911,
  }),
  makeCapacityCase({
    id: 'phi-capacity-35m-f',
    label: 'Tundra',
    segmentCount: 150,
    criticalIndex: 118,
    assumedDurationMinutes: 35,
    expectedWriterParts: 3,
    sourceCharacters: 21_857,
  }),
  makeCapacityCase({
    id: 'phi-capacity-38m-g',
    label: 'Umber',
    segmentCount: 165,
    criticalIndex: 25,
    assumedDurationMinutes: 38,
    expectedWriterParts: 4,
    sourceCharacters: 23_920,
  }),
  makeCapacityCase({
    id: 'phi-capacity-40m-h',
    label: 'Violet',
    segmentCount: 158,
    criticalIndex: 142,
    assumedDurationMinutes: 40,
    expectedWriterParts: 3,
    sourceCharacters: 23_028,
  }),
];

export type PhiNotesExpectedRejectionCase = LocalIntelligenceNotesCase & {
  collection: 'expected_rejection';
  expectedFailure:
    | 'notes_source_first_capacity_exceeded'
    | 'notes_segment_capacity_exceeded';
  priorNotes: string;
  expectedPublication: false;
};

const rejectionCase = (
  id: string,
  expectedFailure: PhiNotesExpectedRejectionCase['expectedFailure'],
  segmentLength: number,
): PhiNotesExpectedRejectionCase =>
  ({
    ...semanticCase({
      id,
      profile: 'long_dense',
      durationClass: 'long',
      coverageTags: ['dense_multi_claim'],
      segments: [
        {
          speaker: 'Synthetic speaker',
          text: `Boundary fixture ${id}: ${'distinct capacity token '.repeat(segmentLength)}`,
        },
      ],
      claims: [],
      forbiddenClaims: [],
    }),
    collection: 'expected_rejection',
    expectedFailure,
    priorNotes: `Preserved prior notes for ${id}`,
    expectedPublication: false,
  }) as PhiNotesExpectedRejectionCase;

export const phiNotesExpectedRejectionCases: PhiNotesExpectedRejectionCase[] = [
  rejectionCase(
    'phi-reject-aggregate-envelope',
    'notes_source_first_capacity_exceeded',
    1_200,
  ),
  rejectionCase(
    'phi-reject-oversized-segment',
    'notes_segment_capacity_exceeded',
    2_000,
  ),
];

export const phiNotesBoundaryFixtures = [
  { id: 'direct-bounded-transition', expected: 'bounded' },
  { id: 'maximum-three-leaves', expected: 'three_leaves' },
  { id: 'single-repartition', expected: 'one_split' },
  {
    id: 'aggregate-inventory-overflow',
    expected: 'notes_source_first_capacity_exceeded',
  },
  {
    id: 'oversized-individual-segment',
    expected: 'notes_segment_capacity_exceeded',
  },
  { id: 'explicit-capacity-rejection', expected: 'no_publication' },
] as const;

export const phiNotesCorpusPayload = {
  semantic: phiNotesHeldOutCases.map(
    ({ id, partition, segments, syntheticProfile }) => ({
      id,
      partition,
      syntheticProfile,
      segments,
    }),
  ),
  ordinaryCapacity: phiNotesOrdinaryCapacityCases.map(
    ({ id, partition, segments, capacity }) => ({
      id,
      partition,
      segments,
      capacity,
    }),
  ),
  expectedRejection: phiNotesExpectedRejectionCases.map(
    ({ id, partition, segments, expectedFailure, expectedPublication }) => ({
      id,
      partition,
      segments,
      expectedFailure,
      expectedPublication,
    }),
  ),
};

export const phiNotesRubricPayload = [
  ...phiNotesHeldOutCases,
  ...phiNotesOrdinaryCapacityCases,
  ...phiNotesExpectedRejectionCases,
].map(({ id, gold }) => ({ id, gold }));

export const PHI_NOTES_CORPUS_SHA256 =
  'dcaa8ca11056cfa830ce68d7a93866879a4bc8803832c3944fba1680e223cacf';
export const PHI_NOTES_RUBRIC_SHA256 =
  '74010004c6ebd2bf07454c692065b8d7c64d7604bc55440eb26ecddcba688ccb';
