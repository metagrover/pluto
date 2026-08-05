import { describe, expect, it } from 'vitest';
import {
  forgetExpiredMeetingProcessingAttempts,
  meetingProcessingFingerprint,
  nextMeetingProcessingWakeDelay,
  rememberMeetingProcessingOutcome,
  selectNextMeetingForProcessing,
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

  it('schedules a refresh when a durable processing lease expires', () => {
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
});
