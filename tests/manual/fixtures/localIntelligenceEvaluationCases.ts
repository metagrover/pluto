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
  /** Semantic fixture shape only; it does not claim a wall-clock meeting length. */
  syntheticProfile: 'short' | 'ordinary' | 'long_dense' | 'adversarial_sparse';
  coverageTags: Array<
    | 'beginning_evidence'
    | 'middle_evidence'
    | 'end_evidence'
    | 'owner_handoff'
    | 'date_correction'
    | 'conditionality'
    | 'withdrawal'
    | 'explicit_no_decision'
    | 'explicit_no_action'
    | 'unrelated_topic_negative'
    | 'dense_multi_claim'
  >;
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
      syntheticProfile: 'short',
      coverageTags: ['beginning_evidence', 'end_evidence'],
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
      syntheticProfile: 'ordinary',
      coverageTags: [
        'middle_evidence',
        'end_evidence',
        'withdrawal',
        'explicit_no_decision',
      ],
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
      syntheticProfile: 'ordinary',
      coverageTags: [
        'beginning_evidence',
        'end_evidence',
        'conditionality',
        'explicit_no_action',
      ],
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
      id: 'notes-short-opening-decision',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F01', 'F13'],
      durationClass: 'ordinary',
      syntheticProfile: 'short',
      coverageTags: ['beginning_evidence', 'unrelated_topic_negative'],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'Decision: the export format will be CSV for the pilot.',
        },
        {
          speaker: 'Speaker 2',
          text: 'Separately, the office plants are arriving next week.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'pilot-export-format',
            evidence: [
              {
                sourceId: 'segment-0',
                excerpt: 'the export format will be CSV for the pilot',
              },
            ],
            requiredTerms: ['csv', 'pilot'],
            critical: true,
            modality: 'fact',
          },
        ],
        forbiddenClaims: ['office plants affect the export format'],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-short-date-correction',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F04', 'F18'],
      durationClass: 'ordinary',
      syntheticProfile: 'short',
      coverageTags: ['beginning_evidence', 'date_correction'],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'Correction: the invoice review is due September 18, not September 11.',
        },
        {
          speaker: 'Speaker 2',
          text: 'Understood; September 18 is the current date.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'corrected-invoice-date',
            evidence: [
              {
                sourceId: 'segment-0',
                excerpt:
                  'the invoice review is due September 18, not September 11',
              },
            ],
            requiredTerms: ['invoice review', 'september 18'],
            critical: true,
            modality: 'committed',
            date: 'September 18',
          },
        ],
        forbiddenClaims: ['invoice review is due september 11'],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-short-owner-handoff',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F05', 'F18'],
      durationClass: 'ordinary',
      syntheticProfile: 'short',
      coverageTags: ['owner_handoff', 'end_evidence'],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'Priya handed the access audit to Omar.',
        },
        {
          speaker: 'Speaker 2',
          text: 'Omar accepted ownership and will finish the audit by Monday.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'access-audit-handoff',
            evidence: [
              {
                sourceId: 'segment-0',
                excerpt: 'Priya handed the access audit to Omar.',
              },
              {
                sourceId: 'segment-1',
                excerpt:
                  'Omar accepted ownership and will finish the audit by Monday.',
              },
            ],
            requiredTerms: ['omar', 'access audit', 'monday'],
            critical: true,
            modality: 'committed',
            owner: 'Omar',
            date: 'Monday',
          },
        ],
        forbiddenClaims: ['priya remains the access audit owner'],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-ordinary-no-decision-no-action',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F06', 'F21'],
      durationClass: 'ordinary',
      syntheticProfile: 'ordinary',
      coverageTags: [
        'middle_evidence',
        'explicit_no_decision',
        'explicit_no_action',
      ],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'The group compared monthly and annual billing options.',
        },
        {
          speaker: 'Speaker 2',
          text: 'No pricing decision was made, and no follow-up action was assigned.',
        },
        {
          speaker: 'Speaker 1',
          text: 'We will revisit the topic only if new customer evidence arrives.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'pricing-remains-unresolved',
            evidence: [
              {
                sourceId: 'segment-1',
                excerpt:
                  'No pricing decision was made, and no follow-up action was assigned.',
              },
            ],
            requiredTerms: [
              'no pricing decision|pricing remains undecided',
              'no follow-up action|no follow-up assigned|no action was assigned',
            ],
            critical: true,
            modality: 'fact',
          },
        ],
        forbiddenClaims: [
          'monthly billing was approved',
          'annual billing was approved',
          'follow-up was assigned',
        ],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-ordinary-end-commitment',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F02', 'F18', 'F19'],
      durationClass: 'ordinary',
      syntheticProfile: 'ordinary',
      coverageTags: ['end_evidence'],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'A rollback drill was suggested while the team reviewed release risks.',
        },
        {
          speaker: 'Speaker 2',
          text: 'The group discussed staging capacity and alert coverage.',
        },
        {
          speaker: 'Speaker 1',
          text: 'Final decision: run the rollback drill. Lena owns it and will complete it by November 6.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'rollback-drill-commitment',
            evidence: [
              {
                sourceId: 'segment-2',
                excerpt: 'Lena owns it and will complete it by November 6.',
              },
            ],
            requiredTerms: ['rollback drill', 'lena', 'november 6'],
            critical: true,
            modality: 'committed',
            owner: 'Lena',
            date: 'November 6',
          },
        ],
        forbiddenClaims: ['rollback drill was only suggested'],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-long-dense-three-position-evidence',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F01', 'F02', 'F04', 'F13', 'F18', 'F19'],
      durationClass: 'long',
      syntheticProfile: 'long_dense',
      coverageTags: [
        'beginning_evidence',
        'middle_evidence',
        'end_evidence',
        'conditionality',
        'explicit_no_decision',
        'dense_multi_claim',
      ],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'The team approved the EU region for the first data-residency pilot.',
        },
        {
          speaker: 'Speaker 2',
          text: 'Support volume and office-hours coverage were reviewed next.',
        },
        {
          speaker: 'Speaker 3',
          text: 'Nia committed to deliver the access audit by December 4.',
        },
        {
          speaker: 'Speaker 1',
          text: 'If the vendor passes security review, Luis will enable the sandbox integration.',
        },
        {
          speaker: 'Speaker 2',
          text: 'The Android expansion was discussed but explicitly postponed.',
        },
        {
          speaker: 'Speaker 1',
          text: 'At close, no pricing decision was made.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'eu-pilot-approved',
            evidence: [
              {
                sourceId: 'segment-0',
                excerpt:
                  'approved the EU region for the first data-residency pilot',
              },
            ],
            requiredTerms: ['eu', 'data-residency pilot', 'approved'],
            critical: true,
            modality: 'fact',
          },
          {
            id: 'access-audit-commitment',
            evidence: [
              {
                sourceId: 'segment-2',
                excerpt:
                  'Nia committed to deliver the access audit by December 4.',
              },
            ],
            requiredTerms: ['nia', 'access audit', 'december 4'],
            critical: true,
            modality: 'committed',
            owner: 'Nia',
            date: 'December 4',
          },
          {
            id: 'sandbox-integration-condition',
            evidence: [
              {
                sourceId: 'segment-3',
                excerpt:
                  'If the vendor passes security review, Luis will enable the sandbox integration.',
              },
            ],
            requiredTerms: [
              'luis',
              'sandbox integration',
              'if the vendor|conditional|pending security review',
            ],
            critical: true,
            modality: 'conditional',
            owner: 'Luis',
          },
          {
            id: 'pricing-undecided',
            evidence: [
              {
                sourceId: 'segment-5',
                excerpt: 'no pricing decision was made',
              },
            ],
            requiredTerms: [
              'no pricing decision|pricing remains undecided|no pricing was approved',
            ],
            critical: true,
            modality: 'fact',
          },
        ],
        forbiddenClaims: [
          'android expansion was approved',
          'pricing was approved',
          'vendor passed security review',
        ],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-long-dense-owner-date-revision',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F04', 'F05', 'F18', 'F21'],
      durationClass: 'long',
      syntheticProfile: 'long_dense',
      coverageTags: [
        'beginning_evidence',
        'middle_evidence',
        'end_evidence',
        'owner_handoff',
        'date_correction',
        'withdrawal',
        'dense_multi_claim',
      ],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'The draft plan listed Mei as the runbook owner with a December 1 target.',
        },
        {
          speaker: 'Speaker 2',
          text: 'The team approved retaining the existing incident severity labels.',
        },
        {
          speaker: 'Speaker 3',
          text: 'Ownership changed: Arturo replaced Mei as the runbook owner.',
        },
        {
          speaker: 'Speaker 1',
          text: 'The proposed automatic paging experiment was withdrawn after the risk review.',
        },
        {
          speaker: 'Speaker 2',
          text: 'Capacity planning will continue in a separate meeting.',
        },
        {
          speaker: 'Speaker 3',
          text: 'Final correction: Arturo will deliver the runbook on December 8, not December 1.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'runbook-owner-and-date-revised',
            evidence: [
              {
                sourceId: 'segment-2',
                excerpt: 'Arturo replaced Mei as the runbook owner.',
              },
              {
                sourceId: 'segment-5',
                excerpt:
                  'Arturo will deliver the runbook on December 8, not December 1.',
              },
            ],
            requiredTerms: ['arturo', 'runbook', 'december 8'],
            critical: true,
            modality: 'committed',
            owner: 'Arturo',
            date: 'December 8',
          },
          {
            id: 'severity-labels-retained',
            evidence: [
              {
                sourceId: 'segment-1',
                excerpt:
                  'approved retaining the existing incident severity labels',
              },
            ],
            requiredTerms: ['retain', 'incident severity labels'],
            critical: true,
            modality: 'fact',
          },
          {
            id: 'paging-experiment-withdrawn',
            evidence: [
              {
                sourceId: 'segment-3',
                excerpt:
                  'automatic paging experiment was withdrawn after the risk review',
              },
            ],
            requiredTerms: ['automatic paging', 'withdrawn'],
            critical: true,
            modality: 'withdrawn',
          },
        ],
        forbiddenClaims: [
          'mei remains the runbook owner',
          'runbook is due december 1',
          'automatic paging experiment was approved',
        ],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-long-dense-decisions-and-boundaries',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F01', 'F02', 'F06', 'F13', 'F19'],
      durationClass: 'long',
      syntheticProfile: 'long_dense',
      coverageTags: [
        'beginning_evidence',
        'middle_evidence',
        'end_evidence',
        'explicit_no_action',
        'unrelated_topic_negative',
        'dense_multi_claim',
      ],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'Decision: retain seven days of pilot telemetry.',
        },
        {
          speaker: 'Speaker 2',
          text: 'The catering survey also closes Friday; it is unrelated to telemetry retention.',
        },
        {
          speaker: 'Speaker 3',
          text: 'Ravi committed to publish the deletion test results by January 9.',
        },
        {
          speaker: 'Speaker 1',
          text: 'The group considered a public dashboard but did not approve one.',
        },
        {
          speaker: 'Speaker 2',
          text: 'No action was assigned for the dashboard.',
        },
        {
          speaker: 'Speaker 3',
          text: 'Final decision: pilot access remains limited to the research team.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'telemetry-retention',
            evidence: [
              {
                sourceId: 'segment-0',
                excerpt: 'retain seven days of pilot telemetry',
              },
            ],
            requiredTerms: ['seven days', 'pilot telemetry'],
            critical: true,
            modality: 'fact',
          },
          {
            id: 'deletion-test-results',
            evidence: [
              {
                sourceId: 'segment-2',
                excerpt:
                  'Ravi committed to publish the deletion test results by January 9.',
              },
            ],
            requiredTerms: ['ravi', 'deletion test results', 'january 9'],
            critical: true,
            modality: 'committed',
            owner: 'Ravi',
            date: 'January 9',
          },
          {
            id: 'research-only-access',
            evidence: [
              {
                sourceId: 'segment-5',
                excerpt: 'pilot access remains limited to the research team',
              },
            ],
            requiredTerms: ['pilot access', 'research team'],
            critical: true,
            modality: 'fact',
          },
          {
            id: 'dashboard-unapproved-unassigned',
            evidence: [
              {
                sourceId: 'segment-3',
                excerpt: 'public dashboard but did not approve one',
              },
              {
                sourceId: 'segment-4',
                excerpt: 'No action was assigned for the dashboard.',
              },
            ],
            requiredTerms: [
              'dashboard',
              'not approved|did not approve|unapproved|no public dashboard approved',
              'no action|unassigned',
            ],
            critical: true,
            modality: 'fact',
          },
        ],
        forbiddenClaims: [
          'public dashboard was approved',
          'catering survey determines telemetry retention',
        ],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-adversarial-sparse-unrelated-beacons',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F05', 'F06', 'F13'],
      durationClass: 'long',
      syntheticProfile: 'adversarial_sparse',
      coverageTags: ['middle_evidence', 'unrelated_topic_negative'],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'Beacon customer-event catering is over budget.',
        },
        {
          speaker: 'Speaker 2',
          text: 'The Beacon database migration is a separate engineering project.',
        },
        {
          speaker: 'Speaker 3',
          text: 'For the database migration only, Chen owns the checksum review due February 2.',
        },
        {
          speaker: 'Speaker 1',
          text: 'The customer-event team is choosing vegetarian lunch options.',
        },
        {
          speaker: 'Speaker 2',
          text: 'No relationship between catering cost and migration risk was discussed.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'migration-checksum-owner',
            evidence: [
              {
                sourceId: 'segment-2',
                excerpt:
                  'For the database migration only, Chen owns the checksum review due February 2.',
              },
            ],
            requiredTerms: [
              'chen',
              'checksum review',
              'february 2',
              'database migration',
            ],
            critical: true,
            modality: 'committed',
            owner: 'Chen',
            date: 'February 2',
          },
        ],
        forbiddenClaims: [
          'catering caused migration risk',
          'chen owns the catering review',
          'beacon is one project',
        ],
        expectedBehavior: 'supported_output',
      },
    },
    {
      id: 'notes-adversarial-sparse-unmet-condition',
      lane: 'meeting_notes',
      partition: 'held_out',
      failureIds: ['F02', 'F06', 'F18', 'F21'],
      durationClass: 'long',
      syntheticProfile: 'adversarial_sparse',
      coverageTags: [
        'middle_evidence',
        'end_evidence',
        'conditionality',
        'explicit_no_action',
        'unrelated_topic_negative',
      ],
      segments: [
        {
          speaker: 'Speaker 1',
          text: 'The team reviewed six routine support metrics.',
        },
        {
          speaker: 'Speaker 2',
          text: 'If compliance signs the exception, Noor may run the archive import on March 3.',
        },
        {
          speaker: 'Speaker 3',
          text: 'The office move is scheduled for March 3 but is unrelated to the archive import.',
        },
        {
          speaker: 'Speaker 1',
          text: 'Several dashboard color options were discussed.',
        },
        {
          speaker: 'Speaker 2',
          text: 'Compliance did not sign the exception.',
        },
        {
          speaker: 'Speaker 3',
          text: 'Therefore Noor has no archive-import action.',
        },
      ],
      gold: {
        requiredClaims: [
          {
            id: 'archive-import-condition-unmet',
            evidence: [
              {
                sourceId: 'segment-1',
                excerpt:
                  'If compliance signs the exception, Noor may run the archive import on March 3.',
              },
              {
                sourceId: 'segment-4',
                excerpt: 'Compliance did not sign the exception.',
              },
              {
                sourceId: 'segment-5',
                excerpt: 'Noor has no archive-import action.',
              },
            ],
            requiredTerms: [
              'noor',
              'archive import|archive-import',
              'compliance',
              'march 3',
              'no action|not assigned|unassigned',
            ],
            critical: true,
            modality: 'conditional',
            owner: 'Noor',
            date: 'March 3',
          },
        ],
        forbiddenClaims: [
          'noor will run the archive import',
          'compliance signed the exception',
          'office move approved the archive import',
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

const containsUnnegatedPhrase = (text: string, phrase: string): boolean => {
  let index = text.indexOf(phrase);
  while (index >= 0) {
    const textBeforeClaim = text.slice(0, index);
    const clauseStart =
      Math.max(
        textBeforeClaim.lastIndexOf('.'),
        textBeforeClaim.lastIndexOf(';'),
        textBeforeClaim.lastIndexOf('!'),
        textBeforeClaim.lastIndexOf('?'),
      ) + 1;
    const clausePrefix = text.slice(clauseStart, index);
    const hasNegativePolarity =
      /\bno\s+$/.test(clausePrefix) ||
      /\bno evidence that\s+$/.test(clausePrefix);
    const sentenceEndOffset = text.slice(index + phrase.length).search(/[.!?]/);
    const sentenceEnd =
      sentenceEndOffset < 0
        ? text.length
        : index + phrase.length + sentenceEndOffset;
    const sentenceTail = text.slice(index + phrase.length, sentenceEnd);
    const hasPostClaimContrast = /\b(?:except|but|however|although)\b/.test(
      sentenceTail,
    );
    if (!hasNegativePolarity || hasPostClaimContrast) return true;
    index = text.indexOf(phrase, index + phrase.length);
  }
  return false;
};

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
    containsUnnegatedPhrase(text, normalized(claim)),
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
