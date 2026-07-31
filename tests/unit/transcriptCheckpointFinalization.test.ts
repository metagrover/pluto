import { describe, expect, it } from 'vitest';
import {
  type TranscriptFinalizationInput,
  finalizeTranscriptCheckpoints,
} from '../../src/services/transcriptCheckpointFinalization';

const configKey = 'resolved-config-sha256';

const baseInput = (): TranscriptFinalizationInput => ({
  meetingId: 'meeting-442',
  expectedConfigKey: configKey,
  intervals: [
    {
      sequence: 0,
      start: 0,
      end: 10,
      sources: {
        mic: { disposition: 'captured', checksumSha256: 'mic-audio-0' },
        system: {
          disposition: 'captured',
          checksumSha256: 'system-audio-0',
        },
      },
    },
  ],
  checkpoints: [
    {
      reference: {
        source: 'mic',
        sequence: 0,
        chunkChecksumSha256: 'mic-audio-0',
        chunkStartSec: 0,
        chunkEndSec: 10,
        transcriptionConfigKey: configKey,
        transcriptChecksumSha256: 'mic-sidecar-0',
        revision: 0,
        disposition: 'transcribed',
      },
      evidence: {
        audioChecksumVerified: true,
        sidecarChecksumVerified: true,
        pathSafe: true,
      },
      sidecar: {
        schemaVersion: 1,
        meetingId: 'meeting-442',
        source: 'mic',
        sequence: 0,
        chunkChecksumSha256: 'mic-audio-0',
        chunkStartSec: 0,
        chunkEndSec: 10,
        transcriptionConfigKey: configKey,
        segments: [{ start: 1, end: 2, text: 'hello' }],
      },
    },
    {
      reference: {
        source: 'system',
        sequence: 0,
        chunkChecksumSha256: 'system-audio-0',
        chunkStartSec: 0,
        chunkEndSec: 10,
        transcriptionConfigKey: configKey,
        transcriptChecksumSha256: 'system-sidecar-0',
        revision: 0,
        disposition: 'transcribed',
      },
      evidence: {
        audioChecksumVerified: true,
        sidecarChecksumVerified: true,
        pathSafe: true,
      },
      sidecar: {
        schemaVersion: 1,
        meetingId: 'meeting-442',
        source: 'system',
        sequence: 0,
        chunkChecksumSha256: 'system-audio-0',
        chunkStartSec: 0,
        chunkEndSec: 10,
        transcriptionConfigKey: configKey,
        segments: [{ start: 2, end: 3, text: 'world' }],
      },
    },
  ],
  acceptanceFrames: [
    {
      sequence: 0,
      micCheckpointChecksumSha256: 'mic-sidecar-0',
      systemCheckpointChecksumSha256: 'system-sidecar-0',
      arbitrationVersion: 'chunk_arbitration_v1',
      activityEvidenceDigestSha256: 'activity-0',
      evidenceMatches: true,
      segments: [
        { source: 'mic', start: 1, end: 2, text: 'hello' },
        { source: 'system', start: 2, end: 3, text: 'world' },
      ],
    },
  ],
  arbitrationVersion: 'chunk_arbitration_v1',
  speechActivity: [],
});

describe('transcript checkpoint finalization', () => {
  it('reuses a fully checkpointed accepted meeting with zero transcription requests', () => {
    const result = finalizeTranscriptCheckpoints(baseInput());

    expect(result.repair).toEqual([]);
    expect(result.transcriptionRequests).toEqual([]);
    expect(result.acceptanceFrames).toEqual([{ sequence: 0, action: 'reuse' }]);
    expect(
      result.segments.map(({ speaker, start, end }) => ({
        speaker,
        start,
        end,
      })),
    ).toEqual([
      { speaker: 'Me', start: 1, end: 2 },
      { speaker: 'Them', start: 2, end: 3 },
    ]);
  });

  it('repairs only the missing tuple and reruns that interval arbitration', () => {
    const input = baseInput();
    input.checkpoints = input.checkpoints.filter(
      ({ reference }) => reference.source !== 'mic',
    );

    const result = finalizeTranscriptCheckpoints(input);

    expect(result.repair).toEqual([
      { source: 'mic', sequence: 0, reason: 'checkpoint_missing' },
    ]);
    expect(result.transcriptionRequests).toEqual([
      { source: 'mic', sequence: 0, reason: 'checkpoint_missing' },
    ]);
    expect(result.acceptanceFrames).toEqual([{ sequence: 0, action: 'rerun' }]);
  });

  it('isolates corruption, audio-link mismatch, and configuration changes', () => {
    const corruption = baseInput();
    corruption.checkpoints[0].evidence.sidecarChecksumVerified = false;
    expect(finalizeTranscriptCheckpoints(corruption).repair[0].reason).toBe(
      'checkpoint_corrupt',
    );

    const mismatch = baseInput();
    mismatch.checkpoints[0].reference.chunkChecksumSha256 = 'wrong';
    expect(finalizeTranscriptCheckpoints(mismatch).repair[0].reason).toBe(
      'audio_link_mismatch',
    );

    const config = baseInput();
    config.checkpoints[0].reference.transcriptionConfigKey = 'old-config';
    expect(finalizeTranscriptCheckpoints(config).repair[0].reason).toBe(
      'transcription_config_changed',
    );
  });

  it('normalizes timestamps, owns the right boundary once, and deduplicates exact identities', () => {
    const input = baseInput();
    input.intervals.push({
      sequence: 1,
      start: 10,
      end: 20,
      sources: {
        mic: { disposition: 'verified_silence' },
        system: { disposition: 'verified_silence' },
      },
    });
    input.acceptanceFrames = [];
    input.checkpoints[0].sidecar.segments = [
      { start: 9, end: 10.2, text: 'crossing' },
      { start: 9, end: 10.2, text: 'crossing' },
    ];
    input.checkpoints[1].sidecar.segments = [];

    const result = finalizeTranscriptCheckpoints(input);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      source: 'mic',
      sequence: 0,
      start: 9,
      end: 10,
      speaker: 'Me',
    });
    expect(result.segments[0].id).toBe(
      '0d63d1575cd2abf3d2f3683e6c00e45c3ffd3502a209752f40efc9a1d9bb67de',
    );
  });

  it('distinguishes verified silence, unavailable sources, and capture failures', () => {
    const input = baseInput();
    input.checkpoints = [];
    input.acceptanceFrames = [];
    input.intervals[0].sources = {
      mic: { disposition: 'verified_silence' },
      system: { disposition: 'source_unavailable', reason: 'not-captured' },
    };

    const complete = finalizeTranscriptCheckpoints(input);
    expect(complete.repair).toEqual([]);
    expect(complete.failures).toEqual([]);

    input.intervals[0].sources.mic = {
      disposition: 'missing',
      reason: 'capture-gap',
    };
    expect(finalizeTranscriptCheckpoints(input).failures).toEqual([
      { source: 'mic', sequence: 0, reason: 'capture_missing' },
    ]);

    const failed = baseInput();
    failed.checkpoints[0].reference.disposition = 'transcription_failed';
    expect(finalizeTranscriptCheckpoints(failed).failures).toContainEqual({
      source: 'mic',
      sequence: 0,
      reason: 'source_failed',
    });
    expect(
      finalizeTranscriptCheckpoints(failed).transcriptionRequests,
    ).not.toContainEqual(expect.objectContaining({ source: 'mic' }));
  });

  it('plans at most one coverage repair and never expands to a full-session request', () => {
    const input = baseInput();
    input.speechActivity = [
      { source: 'mic', sequence: 0, speechDetected: true },
    ];
    input.checkpoints[0].sidecar.segments = [];

    const first = finalizeTranscriptCheckpoints(input);
    expect(first.transcriptionRequests).toEqual([
      { source: 'mic', sequence: 0, reason: 'coverage_underfilled' },
    ]);

    input.checkpoints[0].repairAttempted = true;
    const exhausted = finalizeTranscriptCheckpoints(input);
    expect(exhausted.transcriptionRequests).toEqual([]);
    expect(exhausted.failures).toContainEqual({
      source: 'mic',
      sequence: 0,
      reason: 'coverage_repair_exhausted',
    });
  });

  it('rejects duplicate tuple references without issuing duplicate repair work', () => {
    const input = baseInput();
    input.checkpoints.push(structuredClone(input.checkpoints[0]));

    const result = finalizeTranscriptCheckpoints(input);

    expect(result.repair).toEqual([
      { source: 'mic', sequence: 0, reason: 'checkpoint_corrupt' },
    ]);
    expect(result.transcriptionRequests).toHaveLength(1);
  });

  it('reruns arbitration without transcription when only acceptance evidence changed', () => {
    const input = baseInput();
    input.acceptanceFrames[0].evidenceMatches = false;

    const result = finalizeTranscriptCheckpoints(input);

    expect(result.transcriptionRequests).toEqual([]);
    expect(result.acceptanceFrames).toEqual([{ sequence: 0, action: 'rerun' }]);
  });

  it('does not reuse an unresolved compatibility key', () => {
    const input = baseInput();
    input.expectedConfigKey = '';
    input.checkpoints.forEach((checkpoint) => {
      checkpoint.reference.transcriptionConfigKey = '';
      checkpoint.sidecar.transcriptionConfigKey = '';
    });

    expect(finalizeTranscriptCheckpoints(input).repair).toEqual([
      {
        source: 'mic',
        sequence: 0,
        reason: 'transcription_config_changed',
      },
      {
        source: 'system',
        sequence: 0,
        reason: 'transcription_config_changed',
      },
    ]);
  });
});
