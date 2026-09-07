import type { DreamingInputPackage } from '../../../electron/dreaming/types';

export type EvaluationPartition = 'development' | 'held_out';

export type GoldClaim = {
  id: string;
  evidence: Array<{ sourceId: string; excerpt: string }>;
  requiredTerms: string[];
  critical: boolean;
  modality: 'fact' | 'tentative' | 'conditional' | 'committed' | 'withdrawn';
  owner?: string;
  date?: string;
};

export type EvaluationGold = {
  requiredClaims: GoldClaim[];
  forbiddenClaims: string[];
  expectedBehavior: 'supported_output' | 'abstain' | 'no_change';
};

type EvaluationCaseMetadata = {
  partition: EvaluationPartition;
  failureIds: string[];
  gold: EvaluationGold;
};

export type LocalIntelligenceNotesCase = {
  id: string;
  lane: 'meeting_notes';
  durationClass: 'ordinary' | 'long';
  segments: Array<{ speaker: string; text: string }>;
} & EvaluationCaseMetadata;

export type LocalIntelligenceChatCase = {
  id: string;
  lane: 'quick_chat' | 'cross_meeting';
  mode: 'fast' | 'deep';
  prompt: string;
  sources: Array<{ sourceId: string; text: string }>;
} & EvaluationCaseMetadata;

export type LocalIntelligenceDreamingCase = {
  id: string;
  lane: 'dreaming';
  input: DreamingInputPackage;
} & EvaluationCaseMetadata;

export type LocalIntelligenceEvaluationCase =
  | LocalIntelligenceNotesCase
  | LocalIntelligenceChatCase
  | LocalIntelligenceDreamingCase;

export const localIntelligenceEvaluationCases: LocalIntelligenceEvaluationCase[] =
  [
    {
      id: 'notes-routing-smoke',
      lane: 'meeting_notes',
      partition: 'development',
      failureIds: ['F03', 'F17'],
      durationClass: 'ordinary',
      segments: [
        { speaker: 'Speaker 1', text: 'We are considering a Friday launch.' },
        {
          speaker: 'Speaker 2',
          text: 'No decision yet. Sam will verify the payment test by Thursday.',
        },
        {
          speaker: 'Speaker 1',
          text: 'Agreed. Sam owns that verification, but the launch date remains open.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'payment-verification-owner',
            evidence: [
              {
                sourceId: 'segment-2',
                excerpt:
                  'Agreed. Sam owns that verification, but the launch date remains open.',
              },
            ],
            requiredTerms: ['sam', 'verification'],
            critical: true,
            modality: 'committed',
            owner: 'Sam',
          },
          {
            id: 'launch-date-open',
            evidence: [
              {
                sourceId: 'segment-2',
                excerpt: 'the launch date remains open',
              },
            ],
            requiredTerms: ['launch', 'open'],
            critical: true,
            modality: 'fact',
          },
        ],
        forbiddenClaims: ['friday launch was approved', 'launch is friday'],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-middle-withdrawal',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F01', 'F02', 'F04', 'F13', 'F19', 'F21'],
      durationClass: 'ordinary',
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'We opened by reviewing general launch metrics and support volume.',
        },
        {
          speaker: 'Speaker 2',
          text: 'Mira committed to publish the migration checklist by September 12.',
        },
        {
          speaker: 'Speaker 1',
          text: 'At the end, the proposed Friday launch was withdrawn. No launch date is approved.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'middle-only-commitment',
            evidence: [
              {
                sourceId: 'segment-1',
                excerpt:
                  'Mira committed to publish the migration checklist by September 12.',
              },
            ],
            requiredTerms: ['mira', 'migration checklist', 'september 12'],
            critical: true,
            modality: 'committed',
            owner: 'Mira',
            date: 'September 12',
          },
          {
            id: 'withdrawn-launch',
            evidence: [
              {
                sourceId: 'segment-2',
                excerpt: 'the proposed Friday launch was withdrawn',
              },
            ],
            requiredTerms: ['friday', 'withdrawn'],
            critical: true,
            modality: 'withdrawn',
          },
        ],
        forbiddenClaims: ['friday launch approved', 'launch on friday'],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-conditional-ownership',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F05', 'F18'],
      durationClass: 'ordinary',
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'If legal approves the copy, Jordan will schedule the campaign for October 3.',
        },
        {
          speaker: 'Speaker 2',
          text: 'Legal has not approved it, so Jordan has no committed scheduling task yet.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'conditional-campaign-task',
            evidence: [
              {
                sourceId: 'segment-0',
                excerpt:
                  'If legal approves the copy, Jordan will schedule the campaign for October 3.',
              },
              {
                sourceId: 'segment-1',
                excerpt: 'Jordan has no committed scheduling task yet',
              },
            ],
            requiredTerms: [
              'jordan',
              'legal',
              'october 3',
              'conditional|if legal|pending legal',
            ],
            critical: true,
            modality: 'conditional',
            owner: 'Jordan',
            date: 'October 3',
          },
        ],
        forbiddenClaims: [
          'jordan committed to schedule',
          'campaign approved for october 3',
        ],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'chat-fast-routing-smoke',
      lane: 'quick_chat',
      partition: 'development',
      failureIds: ['F18'],
      mode: 'fast',
      prompt:
        'Use only this evidence: Sam owns payment verification due Thursday [Source 1]. Who owns payment verification and when is it due? Cite the source.',
      sources: [
        {
          sourceId: 'Source 1',
          text: 'Sam owns payment verification due Thursday.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'fast-owner-date',
            evidence: [
              {
                sourceId: 'Source 1',
                excerpt: 'Sam owns payment verification due Thursday.',
              },
            ],
            requiredTerms: ['sam', 'thursday', 'source 1'],
            critical: true,
            modality: 'committed',
            owner: 'Sam',
            date: 'Thursday',
          },
        ],
        forbiddenClaims: [],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'cross-meeting-ownership-transfer',
      lane: 'cross_meeting',
      partition: 'held_out',
      failureIds: ['F05', 'F18'],
      mode: 'deep',
      prompt:
        'Compare only these facts: Tuesday was proposed but not approved [Source 1]. Friday was later approved, and Alex replaced Sam as signoff owner [Source 2]. What changed? Cite each source.',
      sources: [
        {
          sourceId: 'Source 1',
          text: 'Tuesday was proposed but not approved. Sam was the proposed signoff owner.',
        },
        {
          sourceId: 'Source 2',
          text: 'Friday was approved. Alex replaced Sam as signoff owner.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'date-and-owner-transfer',
            evidence: [
              {
                sourceId: 'Source 1',
                excerpt: 'Tuesday was proposed but not approved.',
              },
              {
                sourceId: 'Source 2',
                excerpt:
                  'Friday was approved. Alex replaced Sam as signoff owner.',
              },
            ],
            requiredTerms: [
              'tuesday',
              'not approved|unapproved',
              'friday',
              'alex',
              'sam',
              'source 1',
              'source 2',
            ],
            critical: true,
            modality: 'fact',
            owner: 'Alex',
            date: 'Friday',
          },
        ],
        forbiddenClaims: ['tuesday was approved', 'sam remains owner'],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'cross-meeting-same-name-negative',
      lane: 'cross_meeting',
      partition: 'held_out',
      failureIds: ['F05'],
      mode: 'deep',
      prompt:
        'Source 1 concerns Atlas, an internal search project. Source 2 concerns Atlas, an unrelated customer account. Are these the same project? Use only the evidence and cite sources.',
      sources: [
        {
          sourceId: 'Source 1',
          text: 'Atlas is the internal search-index migration project owned by Engineering.',
        },
        {
          sourceId: 'Source 2',
          text: 'Atlas is a customer account renewal owned by Sales and is unrelated to search.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'same-name-not-same-project',
            evidence: [
              {
                sourceId: 'Source 1',
                excerpt: 'Atlas is the internal search-index migration project',
              },
              {
                sourceId: 'Source 2',
                excerpt: 'Atlas is a customer account renewal',
              },
            ],
            requiredTerms: ['unrelated', 'source 1', 'source 2'],
            critical: true,
            modality: 'fact',
          },
        ],
        forbiddenClaims: [
          'are the same project',
          'atlas is one project',
          'customer renewal caused the search migration',
        ],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'cross-meeting-association-no-causation',
      lane: 'cross_meeting',
      partition: 'held_out',
      failureIds: ['F06', 'F21'],
      mode: 'deep',
      prompt:
        'Source 1 and Source 2 both concern Project Aurora. Explain the supported relationship without inventing causation, and cite sources.',
      sources: [
        {
          sourceId: 'Source 1',
          text: 'Aurora usability testing finished on Monday.',
        },
        {
          sourceId: 'Source 2',
          text: 'Aurora pricing review began on Tuesday. No cause for the timing was discussed.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'association-without-cause',
            evidence: [
              {
                sourceId: 'Source 1',
                excerpt: 'Aurora usability testing finished on Monday.',
              },
              {
                sourceId: 'Source 2',
                excerpt:
                  'Aurora pricing review began on Tuesday. No cause for the timing was discussed.',
              },
            ],
            requiredTerms: [
              'aurora',
              'monday',
              'tuesday',
              'no cause|no causal|does not establish causation|cannot infer causation',
            ],
            critical: true,
            modality: 'fact',
          },
        ],
        forbiddenClaims: [
          'usability testing caused the pricing review',
          'pricing began because testing finished',
        ],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'dreaming-routing-smoke',
      lane: 'dreaming',
      partition: 'development',
      failureIds: ['F14'],
      input: {
        entityId: 'project-routing-smoke',
        entityType: 'project',
        entityName: 'Routing Smoke',
        sourceRevision: 'routing-smoke-revision',
        currentBaseline: {},
        currentSummary: null,
        currentMilestones: [],
        currentCommitments: [],
        recentMeetingNotes: [
          {
            meetingId: 'routing-meeting-1',
            title: 'First review',
            startedAt: '2026-09-01T12:00:00.000Z',
            notesContent: 'The team discussed the launch but made no decision.',
          },
          {
            meetingId: 'routing-meeting-2',
            title: 'Second review',
            startedAt: '2026-09-02T12:00:00.000Z',
            notesContent:
              'The team again discussed options without approving a change.',
          },
        ],
        correctionFingerprints: [],
        negativeConstraints: [],
      },
      gold: {
        requiredClaims: [],
        forbiddenClaims: ['approved launch', 'launch milestone'],
        expectedBehavior: 'no_change',
      },
    },
    {
      id: 'dreaming-rejected-correction',
      lane: 'dreaming',
      partition: 'held_out',
      failureIds: ['F06', 'F14'],
      input: {
        entityId: 'project-correction',
        entityType: 'project',
        entityName: 'Correction Project',
        sourceRevision: 'correction-revision',
        currentBaseline: {},
        currentSummary: null,
        currentMilestones: [],
        currentCommitments: [],
        recentMeetingNotes: [
          {
            meetingId: 'correction-meeting-1',
            title: 'Initial proposal',
            startedAt: '2026-09-01T12:00:00.000Z',
            notesContent:
              'A September launch was proposed, but it was not approved.',
          },
          {
            meetingId: 'correction-meeting-2',
            title: 'Correction',
            startedAt: '2026-09-02T12:00:00.000Z',
            notesContent:
              'The team explicitly rejected the September launch claim and left the date open.',
          },
        ],
        correctionFingerprints: ['september-launch-approved'],
        negativeConstraints: ['September launch approved'],
      },
      gold: {
        requiredClaims: [],
        forbiddenClaims: ['september launch approved', 'september milestone'],
        expectedBehavior: 'no_change',
      },
    },
  ];

const normalized = (value: string): string =>
  value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();

export const sourceTextForCase = (
  candidate: LocalIntelligenceEvaluationCase,
  sourceId: string,
): string | null => {
  if (candidate.lane === 'meeting_notes') {
    const match = /^segment-(\d+)$/.exec(sourceId);
    return match ? (candidate.segments[Number(match[1])]?.text ?? null) : null;
  }
  if (candidate.lane === 'quick_chat' || candidate.lane === 'cross_meeting') {
    return (
      candidate.sources.find((source) => source.sourceId === sourceId)?.text ??
      null
    );
  }
  return (
    candidate.input.recentMeetingNotes.find(
      (meeting) => meeting.meetingId === sourceId,
    )?.notesContent ?? null
  );
};

export const scoreGoldOutput = (
  candidate: LocalIntelligenceEvaluationCase,
  output: string,
) => {
  const text = normalized(output);
  const claimResults = candidate.gold.requiredClaims.map((claim) => ({
    id: claim.id,
    critical: claim.critical,
    passed: claim.requiredTerms.every((term) =>
      term
        .split('|')
        .some((alternative) => text.includes(normalized(alternative))),
    ),
  }));
  const forbiddenMatches = candidate.gold.forbiddenClaims.filter((claim) =>
    text.includes(normalized(claim)),
  );
  return {
    requiredCount: claimResults.length,
    passedRequiredCount: claimResults.filter((result) => result.passed).length,
    criticalPassed: claimResults
      .filter((result) => result.critical)
      .every((result) => result.passed),
    forbiddenMatches,
    passed:
      claimResults.every((result) => result.passed) &&
      forbiddenMatches.length === 0,
  };
};

export type ReplayResponseInput = {
  expectedSourceRevision: string;
  actualSourceRevision: string;
  transportStatus: 'complete' | 'failed' | 'unavailable';
  terminationReason: 'stop' | 'length' | 'cancelled' | 'error';
  raw: string;
  validate: (raw: string) => boolean;
};

export const evaluateReplayResponse = (
  input: ReplayResponseInput,
): { accepted: true } | { accepted: false; reason: string } => {
  if (input.expectedSourceRevision !== input.actualSourceRevision) {
    return { accepted: false, reason: 'source_revision_changed' };
  }
  if (input.transportStatus === 'unavailable') {
    return { accepted: false, reason: 'model_unavailable' };
  }
  if (input.transportStatus !== 'complete') {
    return { accepted: false, reason: 'transport_failed' };
  }
  if (input.terminationReason !== 'stop') {
    return {
      accepted: false,
      reason:
        input.terminationReason === 'length'
          ? 'output_truncated'
          : 'transport_failed',
    };
  }
  if (!input.raw.trim() || !input.validate(input.raw)) {
    return { accepted: false, reason: 'semantic_validation_failed' };
  }
  return { accepted: true };
};
