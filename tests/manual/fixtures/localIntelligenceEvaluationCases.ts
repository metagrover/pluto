import type { DreamingInputPackage } from '../../../electron/dreaming/types';

export type LocalIntelligenceNotesCase = {
  id: string;
  lane: 'meeting_notes';
  durationClass: 'ordinary' | 'long';
  segments: Array<{ speaker: string; text: string }>;
};

export type LocalIntelligenceChatCase = {
  id: string;
  lane: 'quick_chat' | 'cross_meeting';
  mode: 'fast' | 'deep';
  prompt: string;
};

export type LocalIntelligenceDreamingCase = {
  id: string;
  lane: 'dreaming';
  input: DreamingInputPackage;
};

export type LocalIntelligenceEvaluationCase =
  | LocalIntelligenceNotesCase
  | LocalIntelligenceChatCase
  | LocalIntelligenceDreamingCase;

export const localIntelligenceEvaluationCases: LocalIntelligenceEvaluationCase[] =
  [
    {
      id: 'notes-routing-smoke',
      lane: 'meeting_notes',
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
    },
    {
      id: 'chat-fast-routing-smoke',
      lane: 'quick_chat',
      mode: 'fast',
      prompt:
        'Use only this evidence: Sam owns payment verification due Thursday [Source 1]. Who owns payment verification and when is it due? Cite the source.',
    },
    {
      id: 'chat-deep-routing-smoke',
      lane: 'cross_meeting',
      mode: 'deep',
      prompt:
        'Compare only these facts: Tuesday was proposed but not approved [Source 1]. Friday was later approved, and Alex replaced Sam as signoff owner [Source 2]. What changed? Cite each source.',
    },
    {
      id: 'dreaming-routing-smoke',
      lane: 'dreaming',
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
    },
  ];

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
