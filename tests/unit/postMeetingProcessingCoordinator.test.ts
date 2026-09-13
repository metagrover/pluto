import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildRecoveredMeetingTitleInput,
  canImproveHistoricalSpeakerLabels,
  canRetryMeetingFinalTranscription,
  canRetryMeetingSpeakerLabels,
  forgetExpiredMeetingProcessingAttempts,
  isParakeetValidatedMeeting,
  meetingProcessingFingerprint,
  needsRecoveredAudioRebuild,
  nextMeetingProcessingWakeDelay,
  rememberMeetingProcessingOutcome,
  selectNextMeetingForFinalTranscription,
  selectNextMeetingForProcessing,
  selectNextRecoveredMeetingForTitleGeneration,
  shouldGenerateRecoveredMeetingTitle,
  shouldRunMeetingFinalTranscription,
  shouldStartMeetingFinalTranscription,
} from '../../src/services/postMeetingProcessingCoordinator';

const incomplete = (id: string) => ({
  id,
  transcript_status: 'needs_attention' as const,
  finalization_status: 'finalized' as const,
  transcript_json: JSON.stringify({ segments: [{ text: 'synthetic' }] }),
  transcript_integrity_json: JSON.stringify({
    schemaVersion: 2,
    state: 'needs_attention',
    causes: [{ code: 'local_speech_unaccounted' }],
  }),
  audio_path: '/synthetic/mic.wav',
  analysis_json: null,
  enhanced_notes: null,
});

describe('post-meeting processing coordinator', () => {
  it('selects a sealed provisional recording for the app-wide final worker', () => {
    expect(
      selectNextMeetingForFinalTranscription([
        {
          id: 'meeting-1',
          transcript_status: 'provisional',
          finalization_status: 'processing',
          capture_journal_generation: 'generation-1',
          transcript_json: '{"segments":[]}',
          audio_path: '/approved/mic.wav',
          system_audio_path: '/approved/system.wav',
          mixed_audio_path: '/approved/mixed.wav',
        },
      ])?.id,
    ).toBe('meeting-1');
  });

  it('waits for all recovered audio artifacts before final transcription', () => {
    expect(
      shouldRunMeetingFinalTranscription({
        id: 'meeting-1',
        transcript_status: 'provisional',
        finalization_status: 'processing',
        capture_journal_generation: 'generation-1',
        transcript_json: '{"segments":[]}',
        has_audio: true,
        audio_path: '/approved/mic.wav',
        system_audio_path: '/approved/system.wav',
        mixed_audio_path: null,
      }),
    ).toBe(false);
  });

  it('rebuilds sealed no-gap recovery audio before automatic final transcription', () => {
    const meeting = {
      id: 'recovered-meeting',
      transcript_status: 'needs_attention' as const,
      finalization_status: 'finalized' as const,
      capture_journal_generation: 'generation-1',
      transcript_json: '{"segments":[]}',
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'recovered_awaiting_validation' }],
        recovery: {
          source: 'capture_journal',
          gapDetected: false,
        },
      }),
      audio_path: '/approved/mic.wav',
      system_audio_path: '/approved/system.wav',
      mixed_audio_path: null,
    };

    expect(needsRecoveredAudioRebuild(meeting)).toBe(true);
    expect(shouldRunMeetingFinalTranscription(meeting)).toBe(true);
    expect(shouldStartMeetingFinalTranscription(meeting, 'automatic')).toBe(
      true,
    );
    expect(selectNextMeetingForFinalTranscription([meeting])?.id).toBe(
      'recovered-meeting',
    );
  });

  it('selects recovered work from its content-free meeting summary', () => {
    const summary = {
      id: 'recovered-summary',
      transcript_status: 'needs_attention' as const,
      finalization_status: 'finalized' as const,
      capture_journal_generation: 'generation-1',
      has_transcript: true,
      has_audio: true,
      recovered_awaiting_validation: true,
    };

    expect(needsRecoveredAudioRebuild(summary)).toBe(true);
    expect(selectNextMeetingForFinalTranscription([summary])?.id).toBe(
      'recovered-summary',
    );
  });

  it('selects validated recovered meetings for bounded title repair', () => {
    const summary = {
      id: 'recovered-summary',
      title: 'Recovered recording',
      transcript_status: 'validated' as const,
      capture_journal_generation: 'generation-1',
      has_transcript_text: true,
      final_transcription_policy: 'parakeet_final_v1',
      final_transcription_state: 'complete',
      speaker_attribution_verified: true,
    };

    expect(shouldGenerateRecoveredMeetingTitle(summary)).toBe(true);
    expect(
      selectNextRecoveredMeetingForTitleGeneration([summary], new Set())?.id,
    ).toBe('recovered-summary');
    expect(
      selectNextRecoveredMeetingForTitleGeneration(
        [summary],
        new Set(['recovered-summary']),
      ),
    ).toBeNull();
    expect(
      shouldGenerateRecoveredMeetingTitle({
        ...summary,
        title: 'Quarterly planning',
      }),
    ).toBe(false);
    expect(
      shouldGenerateRecoveredMeetingTitle({
        id: 'recovered-detail',
        title: 'Recovered recording',
        transcript_status: 'validated',
        capture_journal_generation: 'generation-1',
        transcript_json: '{"segments":[{"text":"Synthetic"}]}',
        transcript_integrity_json: JSON.stringify({
          finalTranscription: {
            policy: 'parakeet_final_v1',
            state: 'complete',
          },
          speakerAttributionVerified: true,
        }),
      }),
    ).toBe(true);
  });

  it('builds a bounded title input across the recovered transcript timeline', () => {
    const segments = Array.from({ length: 100 }, (_, index) => ({
      speaker: index % 2 === 0 ? 'Me' : 'Them',
      text: `segment-${index}`,
    }));
    const input = buildRecoveredMeetingTitleInput({
      analysis_json: null,
      transcript_json: JSON.stringify({ segments }),
    });

    expect(input).toContain('segment-0');
    expect(input).toContain('segment-99');
    expect(input?.length).toBeLessThanOrEqual(6_000);
  });

  it('does not automatically retry a recovered capture with a gap', () => {
    expect(
      needsRecoveredAudioRebuild({
        id: 'partial-recovery',
        transcript_status: 'needs_attention',
        finalization_status: 'finalized',
        capture_journal_generation: 'generation-1',
        transcript_json: '{"segments":[]}',
        transcript_integrity_json: JSON.stringify({
          causes: [{ code: 'capture_gap_detected' }],
          recovery: { source: 'capture_journal', gapDetected: true },
        }),
        audio_path: '/approved/mic.wav',
      }),
    ).toBe(false);
  });

  it('rechecks full meeting detail using the initiating retry reason', () => {
    const appSource = readFileSync('src/App.tsx', 'utf8');
    expect(appSource).toContain(
      'shouldStartMeetingFinalTranscription(detail, reason)',
    );
    expect(appSource).toContain(
      "kind === 'speaker_labels' ? 'speaker_labels' : 'manual'",
    );
    expect(appSource).toContain(
      "reason === 'speaker_labels' || needsRecoveredAudioRebuild(detail)",
    );
  });

  it('does not finalize an unsealed or recovery-required recording', () => {
    expect(
      selectNextMeetingForFinalTranscription([
        {
          id: 'unsealed',
          transcript_status: 'provisional',
          transcript_json: '{"segments":[]}',
          audio_path: '/approved/mic.wav',
        },
        {
          id: 'recovery',
          transcript_status: 'provisional',
          finalization_status: 'recovery_required',
          capture_journal_generation: 'generation-1',
          transcript_json: '{"segments":[]}',
          audio_path: '/approved/mic.wav',
        },
      ]),
    ).toBeNull();
  });

  it('recognizes an explicit Parakeet failure as manually retryable', () => {
    const meeting = {
      id: 'meeting-1',
      transcript_status: 'needs_attention' as const,
      capture_journal_generation: 'generation-1',
      audio_path: '/approved/mic.wav',
      system_audio_path: '/approved/system.wav',
      mixed_audio_path: '/approved/mixed.wav',
      transcript_json: JSON.stringify({ segments: [{ text: 'preview' }] }),
      transcript_integrity_json: JSON.stringify({
        finalTranscription: {
          policy: 'parakeet_final_v1',
          state: 'needs_attention',
          failure: 'resource_policy_denied',
        },
      }),
    };
    expect(canRetryMeetingFinalTranscription(meeting)).toBe(true);
    expect(shouldStartMeetingFinalTranscription(meeting, 'manual')).toBe(true);
    expect(shouldStartMeetingFinalTranscription(meeting, 'automatic')).toBe(
      false,
    );
    expect(selectNextMeetingForProcessing([meeting], new Set())).toBeNull();
  });

  it('recognizes a committed Parakeet transcript for downstream-only retry', () => {
    expect(
      isParakeetValidatedMeeting({
        transcript_status: 'validated',
        transcript_json: JSON.stringify({
          speakerAttribution: {
            source: 'offline_diarization_acoustic_v1',
            confidence: 1,
            diarizationAttempted: true,
            mappingApplied: true,
          },
          segments: [],
        }),
        transcript_integrity_json: JSON.stringify({
          finalTranscription: {
            policy: 'parakeet_final_v1',
            state: 'complete',
          },
          finalTranscriptionResult: {
            policy: 'parakeet_final_v1',
            engine: 'parakeet_coreml',
          },
        }),
      }),
    ).toBe(true);
  });

  it('requires reprocessing when microphone identity was left unresolved', () => {
    const meeting = {
      id: 'anonymous-local-speakers',
      capture_journal_generation: 'generation-1',
      audio_path: '/approved/mic.wav',
      system_audio_path: '/approved/system.wav',
      mixed_audio_path: '/approved/mixed.wav',
      final_transcription_policy: 'parakeet_final_v1',
      final_transcription_state: 'complete',
      transcript_status: 'validated',
      transcript_json: JSON.stringify({
        speakerAttribution: {
          source: 'recovered_channel_acoustic_v3',
          confidence: 0.92,
          diarizationAttempted: true,
          mappingApplied: false,
          speakerSeparation: 'verified',
          selfIdentity: 'unresolved',
        },
        segments: [],
      }),
      transcript_integrity_json: JSON.stringify({
        finalTranscription: {
          policy: 'parakeet_final_v1',
          state: 'complete',
        },
        finalTranscriptionResult: {
          policy: 'parakeet_final_v1',
          engine: 'parakeet_coreml',
        },
      }),
    } as const;
    expect(isParakeetValidatedMeeting(meeting)).toBe(false);
    expect(canImproveHistoricalSpeakerLabels(meeting)).toBe(true);
  });

  it('offers explicit final-transcription retry for validated channel fallback', () => {
    const meeting = {
      transcript_status: 'validated' as const,
      capture_journal_generation: 'generation-1',
      audio_path: '/approved/mic.wav',
      system_audio_path: '/approved/system.wav',
      mixed_audio_path: '/approved/mixed.wav',
      transcript_json: JSON.stringify({
        speakerAttribution: {
          source: 'channel_fallback',
          confidence: 0,
          diarizationAttempted: false,
          mappingApplied: false,
        },
        segments: [{ text: 'visible transcript' }],
      }),
      transcript_integrity_json: JSON.stringify({
        finalTranscription: {
          policy: 'parakeet_final_v1',
          state: 'complete',
        },
        finalTranscriptionResult: {
          policy: 'parakeet_final_v1',
          engine: 'parakeet_coreml',
        },
      }),
    };

    expect(canRetryMeetingFinalTranscription(meeting)).toBe(true);
    expect(canImproveHistoricalSpeakerLabels(meeting)).toBe(true);
    expect(isParakeetValidatedMeeting(meeting)).toBe(false);
    expect(selectNextMeetingForFinalTranscription([meeting])).toBeNull();
  });

  it('offers a manual v2 upgrade for a completed v1 attribution', () => {
    const meeting = {
      transcript_status: 'validated' as const,
      capture_journal_generation: 'generation-1',
      audio_path: '/approved/mic.wav',
      system_audio_path: '/approved/system.wav',
      mixed_audio_path: '/approved/mixed.wav',
      transcript_json: JSON.stringify({
        speakerAttribution: {
          source: 'recovered_channel_acoustic_v1',
          confidence: 1,
          mappingApplied: true,
        },
        segments: [{ text: 'visible transcript' }],
      }),
      transcript_integrity_json: JSON.stringify({
        finalTranscription: {
          policy: 'parakeet_final_v1',
          state: 'complete',
        },
        finalTranscriptionResult: {
          policy: 'parakeet_final_v1',
          engine: 'parakeet_coreml',
        },
      }),
      speaker_attribution_verified: true,
    };

    expect(canImproveHistoricalSpeakerLabels(meeting)).toBe(true);
    expect(canRetryMeetingFinalTranscription(meeting)).toBe(true);
    expect(isParakeetValidatedMeeting(meeting)).toBe(true);
  });

  it('does not offer another upgrade for a completed v2 attribution', () => {
    const meeting = {
      transcript_status: 'validated' as const,
      capture_journal_generation: 'generation-1',
      audio_path: '/approved/mic.wav',
      system_audio_path: '/approved/system.wav',
      mixed_audio_path: '/approved/mixed.wav',
      transcript_json: JSON.stringify({
        speakerAttribution: {
          source: 'recovered_channel_acoustic_v2',
          confidence: 0.95,
          mappingApplied: true,
        },
        segments: [{ text: 'visible transcript' }],
      }),
      transcript_integrity_json: JSON.stringify({
        finalTranscription: {
          policy: 'parakeet_final_v1',
          state: 'complete',
        },
        finalTranscriptionResult: {
          policy: 'parakeet_final_v1',
          engine: 'parakeet_coreml',
        },
      }),
      speaker_attribution_verified: true,
    };

    expect(canImproveHistoricalSpeakerLabels(meeting)).toBe(false);
    expect(canRetryMeetingFinalTranscription(meeting)).toBe(false);
    expect(canRetryMeetingSpeakerLabels(meeting)).toBe(true);
    expect(
      shouldStartMeetingFinalTranscription(meeting, 'speaker_labels'),
    ).toBe(true);
    expect(isParakeetValidatedMeeting(meeting)).toBe(true);
  });

  it('offers a retry when remote diarization recorded low coverage', () => {
    const meeting = {
      transcript_status: 'validated' as const,
      capture_journal_generation: 'generation-1',
      audio_path: '/approved/mic.wav',
      system_audio_path: '/approved/system.wav',
      mixed_audio_path: '/approved/mixed.wav',
      transcript_json: JSON.stringify({
        speakerAttribution: {
          source: 'recovered_channel_acoustic_v2',
          confidence: 0.95,
          mappingApplied: true,
          remoteDiarization: {
            attempted: true,
            input: 'system_audio',
            applied: false,
            confidence: 0.78,
            clusterCount: 4,
            labeledSegmentCount: 0,
            fallbackReason: 'low_coverage',
          },
        },
        segments: [{ text: 'visible transcript' }],
      }),
      transcript_integrity_json: JSON.stringify({
        finalTranscription: {
          policy: 'parakeet_final_v1',
          state: 'complete',
        },
      }),
      speaker_attribution_verified: true,
    };

    expect(canImproveHistoricalSpeakerLabels(meeting)).toBe(true);
    expect(canRetryMeetingFinalTranscription(meeting)).toBe(true);
  });

  it('does not retry remote diarization after partial labels were applied', () => {
    const meeting = {
      transcript_status: 'validated' as const,
      capture_journal_generation: 'generation-1',
      audio_path: '/approved/mic.wav',
      system_audio_path: '/approved/system.wav',
      mixed_audio_path: '/approved/mixed.wav',
      transcript_json: JSON.stringify({
        speakerAttribution: {
          source: 'recovered_channel_acoustic_v2',
          confidence: 0.95,
          mappingApplied: true,
          remoteDiarization: {
            attempted: true,
            input: 'system_audio',
            applied: true,
            confidence: 0.78,
            clusterCount: 4,
            labeledSegmentCount: 293,
            coverage: 'partial',
          },
        },
        segments: [{ text: 'visible transcript' }],
      }),
      transcript_integrity_json: JSON.stringify({
        finalTranscription: {
          policy: 'parakeet_final_v1',
          state: 'complete',
        },
      }),
      speaker_attribution_verified: true,
    };

    expect(canImproveHistoricalSpeakerLabels(meeting)).toBe(false);
    expect(canRetryMeetingFinalTranscription(meeting)).toBe(false);
  });

  it('does not classify a fresh attribution rejection as historical repair', () => {
    expect(
      canImproveHistoricalSpeakerLabels({
        transcript_status: 'needs_attention',
        capture_journal_generation: 'generation-1',
        audio_path: '/approved/mic.wav',
        system_audio_path: '/approved/system.wav',
        mixed_audio_path: '/approved/mixed.wav',
        transcript_json: JSON.stringify({ segments: [{ text: 'preview' }] }),
        transcript_integrity_json: JSON.stringify({
          finalTranscription: {
            policy: 'parakeet_final_v1',
            state: 'needs_attention',
            failure: 'speaker_attribution_rejected',
          },
        }),
      }),
    ).toBe(false);
  });

  it('selects incomplete meetings without relying on UI selection', () => {
    const attempted = new Set<string>();
    expect(
      selectNextMeetingForProcessing(
        [incomplete('older'), incomplete('newer')],
        attempted,
      )?.id,
    ).toBe('older');
  });

  it('does not select the same durable state twice', () => {
    const meeting = incomplete('meeting');
    const attempted = new Set([meetingProcessingFingerprint(meeting)]);
    expect(selectNextMeetingForProcessing([meeting], attempted)).toBeNull();
  });

  it('changes the processing fingerprint when durable notes-run state changes', () => {
    const meeting = incomplete('meeting');
    const before = meetingProcessingFingerprint(meeting);

    expect(
      meetingProcessingFingerprint({
        ...meeting,
        analysis_run_json: JSON.stringify({
          notes_status: 'failed',
          automatic_attempt_count: 2,
        }),
      }),
    ).not.toBe(before);
  });

  it('does not skip an in-flight head meeting to start another local-model job', () => {
    const head = incomplete('newest');
    const next = incomplete('next');
    const attempted = new Set([meetingProcessingFingerprint(head)]);

    expect(selectNextMeetingForProcessing([head, next], attempted)).toBeNull();
  });

  it('does not poll a later expired lease while an attempted head blocks the queue', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z');
    const head = incomplete('head');
    const later = {
      ...incomplete('later'),
      downstream_processing_json: JSON.stringify({
        schemaVersion: 1,
        state: 'processing',
        transcriptValidatedAt: '2026-08-03T23:59:00.000Z',
        runId: 'later-run',
        startedAt: '2026-08-03T23:59:00.000Z',
        deadlineAt: new Date(now - 1_000).toISOString(),
        stage: 'analysis',
      }),
    };
    const attempted = new Set([meetingProcessingFingerprint(head)]);

    expect(
      nextMeetingProcessingWakeDelay([head, later], now, attempted),
    ).toBeNull();
  });

  it('selects a meeting again after its persisted processing stage changes', () => {
    const meeting = incomplete('meeting');
    const attempted = new Set([meetingProcessingFingerprint(meeting)]);
    const failedAnalysis = {
      ...meeting,
      transcript_status: 'validated' as const,
      transcript_validated_at: '2026-08-04T00:00:00.000Z',
      downstream_processing_json: JSON.stringify({
        schemaVersion: 1,
        state: 'failed',
        stage: 'analysis',
      }),
    };

    expect(
      selectNextMeetingForProcessing([failedAnalysis], attempted)?.id,
    ).toBe('meeting');
  });

  it('remembers the post-run durable state so persistence does not trigger an immediate retry', () => {
    const attempted = new Set<string>();
    const before = incomplete('meeting');
    const after = {
      ...before,
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'remote_speech_unaccounted' }],
        validation_run_id: 'completed-run',
      }),
    };

    attempted.add(meetingProcessingFingerprint(before));
    rememberMeetingProcessingOutcome(attempted, after);

    expect(selectNextMeetingForProcessing([after], attempted)).toBeNull();
  });

  it('never selects proven capture gaps or completed meetings', () => {
    const captureGap = {
      ...incomplete('gap'),
      transcript_integrity_json: JSON.stringify({
        schemaVersion: 2,
        state: 'needs_attention',
        causes: [{ code: 'capture_gap_detected' }],
      }),
    };
    const complete = {
      ...incomplete('complete'),
      title: 'Completed synthetic meeting',
      transcript_status: 'validated' as const,
      analysis_json: '{}',
    };
    expect(
      selectNextMeetingForProcessing([captureGap, complete], new Set()),
    ).toBeNull();
  });

  it('polls an active durable processing lease instead of waiting for expiry', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z');
    const meeting = {
      ...incomplete('processing'),
      downstream_processing_json: JSON.stringify({
        schemaVersion: 1,
        state: 'processing',
        transcriptValidatedAt: '2026-08-03T23:59:00.000Z',
        runId: 'run',
        startedAt: '2026-08-03T23:59:00.000Z',
        deadlineAt: new Date(now + 1_000).toISOString(),
        stage: 'knowledge_synthesis',
      }),
    };

    expect(nextMeetingProcessingWakeDelay([meeting], now)).toBe(1_050);
    expect(
      selectNextMeetingForProcessing([meeting], new Set(), now),
    ).toBeNull();
    expect(
      selectNextMeetingForProcessing([meeting], new Set(), now + 2_000)?.id,
    ).toBe('processing');
    expect(nextMeetingProcessingWakeDelay([meeting], now + 2_000)).toBe(50);
    expect(
      nextMeetingProcessingWakeDelay(
        [meeting],
        now,
        new Set([meetingProcessingFingerprint(meeting)]),
      ),
    ).toBe(1_050);
    expect(
      nextMeetingProcessingWakeDelay(
        [meeting],
        now + 2_000,
        new Set([meetingProcessingFingerprint(meeting)]),
      ),
    ).toBeNull();

    const attempted = new Set([meetingProcessingFingerprint(meeting)]);
    forgetExpiredMeetingProcessingAttempts([meeting], attempted, now + 2_000);
    expect(
      selectNextMeetingForProcessing([meeting], attempted, now + 2_000)?.id,
    ).toBe('processing');
  });

  it('refreshes a long-running lease before its deadline', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z');
    const meeting = {
      ...incomplete('processing'),
      downstream_processing_json: JSON.stringify({
        schemaVersion: 1,
        state: 'processing',
        transcriptValidatedAt: '2026-08-03T23:59:00.000Z',
        runId: 'run',
        startedAt: '2026-08-03T23:59:00.000Z',
        deadlineAt: new Date(now + 30 * 60_000).toISOString(),
        stage: 'analysis',
      }),
    };

    expect(nextMeetingProcessingWakeDelay([meeting], now)).toBe(2_000);
  });
});
