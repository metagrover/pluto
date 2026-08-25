import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendCaptureJournalChunk,
  appendCaptureTranscriptAcceptanceFrame,
  appendCaptureTranscriptCheckpoint,
  authorizeCaptureJournalInterval,
  completeCaptureJournalCapturedChunk,
  createCaptureJournal,
  persistCaptureJournalRawChunk,
  readCaptureJournalManifest,
  sealCaptureJournal,
  stopCaptureJournal,
  updateCaptureJournalActivityEvidence,
} from '../../electron/captureJournal';
import {
  isMlxCheckpointConfig,
  recoverInterruptedCaptureJournals,
  repairStoppingCaptureJournalTranscript,
  stitchSealedCaptureJournalSource,
  verifySealedCaptureJournalTranscriptEvidence,
} from '../../electron/captureJournalRecovery';
import type { PersistedMeeting } from '../../electron/db';
import { buildRecoverableSealFailureMeeting } from '../../src/utils/recordingFinalization';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';
import { canonicalizeTranscriptCheckpointConfig } from '../../src/utils/transcriptCheckpointConfig';

describe('capture journal recovery', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  const makeRoot = async () => {
    const root = await mkdtemp(join(tmpdir(), 'pluto-capture-recovery-'));
    tempRoots.push(root);
    return root;
  };

  const buildEvidence = () =>
    buildCaptureActivityEvidence(
      [{ startTime: 0.25, endTime: 1.75, speaker: 'Me' }],
      {
        clock: {
          kind: 'meeting_relative_seconds',
          origin: 'recording_start',
        },
        thresholds: {
          rms: 0.02,
          dominanceRatio: 1.4,
          minimumSwitchIntervalMs: 250,
        },
        algorithmVersion: 'speaker_activity_v1',
      },
    );

  it('stitches a verified source directly from a sealed v3 journal', async () => {
    const root = await makeRoot();
    const meetingId = 'meeting-live-stop';
    let manifest = await createCaptureJournal(root, {
      meetingId,
      startedAtMs: 1_000,
      schemaVersion: 3,
      expectedSources: ['system'],
    });
    if (manifest.schemaVersion !== 3) throw new Error('expected v3 journal');
    manifest = await authorizeCaptureJournalInterval(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
    });
    manifest = await persistCaptureJournalRawChunk(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      source: 'system',
      sequence: 0,
      format: 'wav',
      data: Buffer.from('system-raw'),
    });
    const raw = manifest.intervals[0].sources.system;
    if (raw.disposition !== 'raw_durable') {
      throw new Error('expected raw durable system tuple');
    }
    const completed = await completeCaptureJournalCapturedChunk(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      source: 'system',
      sequence: 0,
      rawChecksumSha256: raw.rawChecksumSha256,
      repairData: Buffer.from('system-repair'),
    });
    await updateCaptureJournalActivityEvidence(root, {
      meetingId,
      activityEvidence: await buildEvidence(),
    });
    await stopCaptureJournal(root, {
      meetingId,
      generation: completed.manifest.generation,
      expectedRevision: completed.manifest.revision + 1,
    });
    await sealCaptureJournal(root, { meetingId, endedAtMs: 3_000 });

    const stitch = vi.fn(async (_segments, outputTag: string) =>
      join(root, `${outputTag}.wav`),
    );
    await expect(
      stitchSealedCaptureJournalSource(
        root,
        meetingId,
        'system',
        stitch,
        'session-system',
      ),
    ).resolves.toBe(join(root, 'session-system.wav'));
    expect(stitch).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          startSec: 0,
          endSec: 2,
          chunkIndex: 0,
        }),
      ],
      'session-system',
    );
  });

  it('rejects checkpoint metadata outside the fixed MLX preview contract', () => {
    expect(
      isMlxCheckpointConfig({
        backend: 'mlx_preview',
        device: 'obsolete_device',
        computeType: 'float16',
      }),
    ).toBe(false);
    expect(
      isMlxCheckpointConfig({
        backend: 'mlx_preview',
        device: 'mlx',
        computeType: 'float16',
      }),
    ).toBe(true);
  });

  const recoverSingleMeeting = async (root: string) => {
    const saveMeeting = vi.fn();
    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting,
      stitchWavSegments: async (_segments, outputTag) =>
        join(root, `${outputTag}.wav`),
      nowMs: 5_000,
    });
    const recovered = saveMeeting.mock.calls[0]?.[0] as Record<string, unknown>;
    return {
      result,
      integrity: JSON.parse(String(recovered.transcript_integrity_json)) as {
        evidenceProvenance: { kind: string };
        activityEvidence?: unknown;
        causes: Array<{ code: string }>;
      },
    };
  };

  it('recovers one unsealed journal into a needs-attention meeting exactly once', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
      format: 'wav',
      data: Buffer.from('mic-0'),
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'system',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
      format: 'wav',
      data: Buffer.from('system-0'),
    });
    const activityEvidence = await buildEvidence();
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence,
    });

    const savedMeetings = new Map<string, Record<string, unknown>>();
    const stitchWavSegments = vi
      .fn()
      .mockImplementation(async (_segments, outputTag: string) => {
        return join(root, `${outputTag}.wav`);
      });
    const saveMeeting = vi.fn((meeting: Record<string, unknown>) => {
      savedMeetings.set(String(meeting.id), meeting);
      return meeting;
    });

    const first = await recoverInterruptedCaptureJournals(root, {
      getMeeting: (meetingId) => savedMeetings.get(meetingId) ?? null,
      saveMeeting,
      stitchWavSegments,
      nowMs: 5_000,
    });

    expect(first).toMatchObject({
      recoveredCount: 1,
      skippedExistingCount: 0,
      skippedSealedCount: 0,
    });
    expect(saveMeeting).toHaveBeenCalledTimes(1);
    expect(stitchWavSegments).toHaveBeenCalledTimes(2);

    const recoveredMeeting = savedMeetings.get('meeting-123');
    expect(recoveredMeeting).toMatchObject({
      id: 'meeting-123',
      title: 'Recovered recording',
      transcript_status: 'needs_attention',
      audio_path: join(root, 'meeting-123-mic-recovered.wav'),
      system_audio_path: join(root, 'meeting-123-system-recovered.wav'),
      mixed_audio_path: null,
      duration_seconds: 2,
    });

    const integrity = JSON.parse(
      String(recoveredMeeting?.transcript_integrity_json),
    );
    expect(integrity).toMatchObject({
      schemaVersion: 2,
      state: 'needs_attention',
      causes: [{ code: 'recovered_awaiting_validation' }],
      evidenceProvenance: {
        kind: 'sealed_capture_activity_v2',
        digestSha256: activityEvidence.digestSha256,
      },
      recovery: {
        source: 'capture_journal',
        gapDetected: false,
        sourceScope: 'multiple',
        acknowledgedChunkCount: 2,
        recoveredChunkCount: 2,
      },
    });
    expect(integrity.activityEvidence).toEqual(activityEvidence);
    expect(integrity.activityEvidence.digestSha256).toBe(
      activityEvidence.digestSha256,
    );

    const second = await recoverInterruptedCaptureJournals(root, {
      getMeeting: (meetingId) => savedMeetings.get(meetingId) ?? null,
      saveMeeting,
      stitchWavSegments,
      nowMs: 5_500,
    });

    expect(second).toMatchObject({
      recoveredCount: 0,
      skippedExistingCount: 1,
    });
    expect(saveMeeting).toHaveBeenCalledTimes(1);
  });

  it('repairs a v3 journal interrupted before its first transcript checkpoint', async () => {
    const root = await makeRoot();
    const meetingId = 'meeting-v3';
    let manifest = await createCaptureJournal(root, {
      meetingId,
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (manifest.schemaVersion !== 3) throw new Error('expected v3 journal');
    manifest = await authorizeCaptureJournalInterval(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
    });
    const receipts: Record<
      'mic' | 'system',
      Awaited<ReturnType<typeof completeCaptureJournalCapturedChunk>>['receipt']
    > = {} as never;
    for (const source of ['mic', 'system'] as const) {
      manifest = await persistCaptureJournalRawChunk(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        source,
        sequence: 0,
        format: 'wav',
        data: Buffer.from(`${source}-raw`),
      });
      const raw = manifest.intervals[0].sources[source];
      if (raw.disposition !== 'raw_durable') {
        throw new Error('expected raw durable tuple');
      }
      const completed = await completeCaptureJournalCapturedChunk(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        source,
        sequence: 0,
        rawChecksumSha256: raw.rawChecksumSha256,
        repairData: Buffer.from(`${source}-repair`),
      });
      manifest = completed.manifest;
      receipts[source] = completed.receipt;
    }
    const transcriptionConfig = {
      backend: 'mlx_preview',
      preset: 'balanced',
      model: 'small',
      device: 'mlx',
      computeType: 'float16',
      languageMode: 'detected' as const,
      requestedLanguage: null,
      pipelineVersion: 'live_chunk_v1' as const,
    };
    await updateCaptureJournalActivityEvidence(root, {
      meetingId,
      activityEvidence: await buildEvidence(),
    });
    const saveMeeting = vi.fn();
    const transcribeChunk = vi.fn(async (inputPath: string) => ({
      detectedLanguage: 'en',
      providerLabel: 'local',
      segments: [
        {
          start: inputPath.includes('mic') ? -0.2 : 1,
          end: inputPath.includes('mic') ? 0.8 : 2.8,
          text: inputPath.includes('mic')
            ? 'Synthetic mic statement'
            : 'Synthetic system statement',
          ...(inputPath.includes('mic')
            ? {}
            : {
                words: [
                  {
                    word: 'Synthetic system statement',
                    start: 1,
                    end: 1.6,
                  },
                ],
              }),
        },
      ],
    }));
    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting,
      stitchWavSegments: async (_segments, outputTag) =>
        join(root, `${outputTag}.wav`),
      transcribeChunk,
      transcriptionConfig,
      nowMs: 4_000,
    });

    expect(result.recoveredCount).toBe(1);
    expect(transcribeChunk).toHaveBeenCalledTimes(2);
    expect(
      (await readCaptureJournalManifest(root, meetingId)).lifecycleState,
    ).toBe('sealed');
    await expect(
      verifySealedCaptureJournalTranscriptEvidence(root, meetingId),
    ).resolves.toMatchObject({
      segmentCount: 2,
      sourceCoverageSegments: expect.arrayContaining([
        expect.objectContaining({ speaker: 'Me' }),
        expect.objectContaining({ speaker: 'Them' }),
      ]),
    });
    const recovered = saveMeeting.mock.calls[0][0];
    const transcript = JSON.parse(recovered.transcript_json) as {
      segments: Array<{ speaker: string; text: string }>;
    };
    expect(transcript.segments).toEqual([
      expect.objectContaining({
        speaker: 'Me',
        text: 'Synthetic mic statement',
      }),
      expect.objectContaining({
        speaker: 'Them',
        text: 'Synthetic system statement',
      }),
    ]);
  });

  it('seals explicit v3 capture gaps after all available transcript evidence is resolved', async () => {
    const root = await makeRoot();
    const meetingId = 'meeting-v3-explicit-gap';
    let manifest = await createCaptureJournal(root, {
      meetingId,
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (manifest.schemaVersion !== 3) throw new Error('expected v3 journal');
    manifest = await authorizeCaptureJournalInterval(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
    });
    manifest = await persistCaptureJournalRawChunk(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      source: 'mic',
      sequence: 0,
      format: 'wav',
      data: Buffer.from('mic-raw'),
    });
    const raw = manifest.intervals[0].sources.mic;
    if (raw.disposition !== 'raw_durable') throw new Error('expected raw');
    const completed = await completeCaptureJournalCapturedChunk(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      source: 'mic',
      sequence: 0,
      rawChecksumSha256: raw.rawChecksumSha256,
      repairData: Buffer.from('mic-repair'),
    });
    manifest = completed.manifest;
    const transcriptionConfig = {
      backend: 'mlx_preview',
      preset: 'balanced',
      model: 'small',
      device: 'mlx',
      computeType: 'float16',
      languageMode: 'detected' as const,
      requestedLanguage: null,
      pipelineVersion: 'live_chunk_v1' as const,
    };
    const configKey = createHash('sha256')
      .update(canonicalizeTranscriptCheckpointConfig(transcriptionConfig))
      .digest('hex');
    const savedCheckpoint = await appendCaptureTranscriptCheckpoint(root, {
      receipt: completed.receipt,
      expectedManifestRevision: manifest.revision,
      transcriptionConfigKey: configKey,
      sidecar: {
        schemaVersion: 1,
        meetingId,
        source: 'mic',
        sequence: 0,
        chunkChecksumSha256: completed.receipt.checksumSha256,
        chunkStartSec: 0,
        chunkEndSec: 2,
        transcriptionConfig,
        backendResult: { detectedLanguage: 'en', providerLabel: 'local' },
        segments: [{ start: 0.25, end: 1.25, text: 'Synthetic statement' }],
      },
    });
    const activityEvidence = await buildEvidence();
    manifest = await updateCaptureJournalActivityEvidence(root, {
      meetingId,
      activityEvidence,
    });
    const activityInputs = {
      chunkStartSec: 0,
      chunkEndSec: 2,
      evidence: {
        clock: activityEvidence.clock,
        thresholds: activityEvidence.thresholds,
        algorithmVersion: activityEvidence.algorithmVersion,
        serializationVersion: activityEvidence.serializationVersion,
        windows: activityEvidence.windows,
      },
    };
    const savedFrame = await appendCaptureTranscriptAcceptanceFrame(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      micCheckpointChecksumSha256:
        savedCheckpoint.checkpoint.transcriptChecksumSha256,
      systemCheckpointChecksumSha256: null,
      activityEvidenceDigestSha256: createHash('sha256')
        .update(JSON.stringify(activityInputs))
        .digest('hex'),
      sidecar: {
        schemaVersion: 1,
        meetingId,
        sequence: 0,
        arbitrationVersion: 'chunk_arbitration_v1',
        activityInputs,
        segments: [
          {
            source: 'mic',
            start: 0.25,
            end: 1.25,
            text: 'Synthetic statement',
          },
        ],
      },
    });
    await stopCaptureJournal(root, {
      meetingId,
      generation: savedFrame.manifest.generation,
      expectedRevision: savedFrame.manifest.revision,
    });
    const saveMeeting = vi.fn();
    const transcribeChunk = vi.fn();

    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting,
      stitchWavSegments: async (_segments, outputTag) =>
        join(root, `${outputTag}.wav`),
      transcribeChunk,
      transcriptionConfig,
      nowMs: 4_000,
    });

    expect(result).toMatchObject({ recoveredCount: 1, failedRecoveryCount: 0 });
    expect(transcribeChunk).not.toHaveBeenCalled();
    expect(
      (await readCaptureJournalManifest(root, meetingId)).lifecycleState,
    ).toBe('sealed');
    const recovered = saveMeeting.mock.calls[0][0];
    const integrity = JSON.parse(recovered.transcript_integrity_json) as {
      causes: Array<{ code: string }>;
    };
    expect(integrity.causes).toContainEqual({
      code: 'capture_gap_detected',
      sourceScope: 'system',
    });
  });

  it('does not seal a captured source whose transcript checkpoint failed', async () => {
    const root = await makeRoot();
    const meetingId = 'meeting-v3-captured-transcript-failure';
    let manifest = await createCaptureJournal(root, {
      meetingId,
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (manifest.schemaVersion !== 3) throw new Error('expected v3 journal');
    manifest = await authorizeCaptureJournalInterval(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
    });
    manifest = await persistCaptureJournalRawChunk(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      source: 'mic',
      sequence: 0,
      format: 'wav',
      data: Buffer.from('mic-raw'),
    });
    const raw = manifest.intervals[0].sources.mic;
    if (raw.disposition !== 'raw_durable') throw new Error('expected raw');
    const completed = await completeCaptureJournalCapturedChunk(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      source: 'mic',
      sequence: 0,
      rawChecksumSha256: raw.rawChecksumSha256,
      repairData: Buffer.from('mic-repair'),
    });
    manifest = completed.manifest;
    const transcriptionConfig = {
      backend: 'mlx_preview',
      preset: 'balanced',
      model: 'small',
      device: 'mlx',
      computeType: 'float16',
      languageMode: 'detected' as const,
      requestedLanguage: null,
      pipelineVersion: 'live_chunk_v1' as const,
    };
    const configKey = createHash('sha256')
      .update(canonicalizeTranscriptCheckpointConfig(transcriptionConfig))
      .digest('hex');
    const failedCheckpoint = await appendCaptureTranscriptCheckpoint(root, {
      receipt: completed.receipt,
      expectedManifestRevision: manifest.revision,
      transcriptionConfigKey: configKey,
      disposition: 'transcription_failed',
      sidecar: {
        schemaVersion: 1,
        meetingId,
        source: 'mic',
        sequence: 0,
        chunkChecksumSha256: completed.receipt.checksumSha256,
        chunkStartSec: 0,
        chunkEndSec: 2,
        transcriptionConfig,
        backendResult: { detectedLanguage: null, providerLabel: 'local' },
        segments: [],
      },
    });
    const activityEvidence = await buildCaptureActivityEvidence([], {
      clock: { kind: 'meeting_relative_seconds', origin: 'recording_start' },
      thresholds: {
        rms: 0.02,
        dominanceRatio: 1.4,
        minimumSwitchIntervalMs: 250,
      },
      algorithmVersion: 'speaker_activity_v1',
    });
    manifest = await updateCaptureJournalActivityEvidence(root, {
      meetingId,
      activityEvidence,
    });
    const activityInputs = {
      chunkStartSec: 0,
      chunkEndSec: 2,
      evidence: {
        clock: activityEvidence.clock,
        thresholds: activityEvidence.thresholds,
        algorithmVersion: activityEvidence.algorithmVersion,
        serializationVersion: activityEvidence.serializationVersion,
        windows: activityEvidence.windows,
      },
    };
    const frame = await appendCaptureTranscriptAcceptanceFrame(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      micCheckpointChecksumSha256:
        failedCheckpoint.checkpoint.transcriptChecksumSha256,
      systemCheckpointChecksumSha256: null,
      activityEvidenceDigestSha256: createHash('sha256')
        .update(JSON.stringify(activityInputs))
        .digest('hex'),
      sidecar: {
        schemaVersion: 1,
        meetingId,
        sequence: 0,
        arbitrationVersion: 'chunk_arbitration_v1',
        activityInputs,
        segments: [],
      },
    });
    await stopCaptureJournal(root, {
      meetingId,
      generation: frame.manifest.generation,
      expectedRevision: frame.manifest.revision,
    });
    const saveMeeting = vi.fn();

    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting,
      stitchWavSegments: async (_segments, outputTag) =>
        join(root, `${outputTag}.wav`),
      transcribeChunk: vi.fn(),
      transcriptionConfig,
      nowMs: 4_000,
    });

    expect(result).toMatchObject({ recoveredCount: 0, failedRecoveryCount: 1 });
    expect(saveMeeting).not.toHaveBeenCalled();
    expect(
      (await readCaptureJournalManifest(root, meetingId)).lifecycleState,
    ).toBe('stopping');
  });

  it('repairs a missing clean-stop tail checkpoint before the journal is sealed', async () => {
    const root = await makeRoot();
    const meetingId = 'meeting-clean-tail';
    let manifest = await createCaptureJournal(root, {
      meetingId,
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (manifest.schemaVersion !== 3) throw new Error('expected v3 journal');
    manifest = await authorizeCaptureJournalInterval(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
    });
    const receipts = {} as Record<
      'mic' | 'system',
      Awaited<ReturnType<typeof completeCaptureJournalCapturedChunk>>['receipt']
    >;
    for (const source of ['mic', 'system'] as const) {
      manifest = await persistCaptureJournalRawChunk(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        source,
        sequence: 0,
        format: 'wav',
        data: Buffer.from(`${source}-raw`),
      });
      const raw = manifest.intervals[0].sources[source];
      if (raw.disposition !== 'raw_durable') throw new Error('expected raw');
      const completed = await completeCaptureJournalCapturedChunk(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        source,
        sequence: 0,
        rawChecksumSha256: raw.rawChecksumSha256,
        repairData: Buffer.from(`${source}-repair`),
      });
      manifest = completed.manifest;
      receipts[source] = completed.receipt;
    }
    const transcriptionConfig = {
      backend: 'mlx_preview',
      preset: 'balanced',
      model: 'small',
      device: 'mlx',
      computeType: 'float16',
      languageMode: 'detected' as const,
      requestedLanguage: null,
      pipelineVersion: 'live_chunk_v1' as const,
    };
    const configKey = createHash('sha256')
      .update(canonicalizeTranscriptCheckpointConfig(transcriptionConfig))
      .digest('hex');
    const savedMic = await appendCaptureTranscriptCheckpoint(root, {
      receipt: receipts.mic,
      expectedManifestRevision: manifest.revision,
      transcriptionConfigKey: configKey,
      sidecar: {
        schemaVersion: 1,
        meetingId,
        source: 'mic',
        sequence: 0,
        chunkChecksumSha256: receipts.mic.checksumSha256,
        chunkStartSec: 0,
        chunkEndSec: 2,
        transcriptionConfig,
        backendResult: { detectedLanguage: 'en', providerLabel: 'local' },
        segments: [{ start: 0.2, end: 0.8, text: 'Synthetic mic statement' }],
      },
    });
    manifest = await updateCaptureJournalActivityEvidence(root, {
      meetingId,
      activityEvidence: await buildEvidence(),
    });
    manifest = await stopCaptureJournal(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
    });

    const transcribeChunk = vi.fn(async (audioPath: string) => ({
      detectedLanguage: 'en',
      providerLabel: 'local',
      segments: audioPath.includes('mic-')
        ? [{ start: 0.2, end: 0.8, text: 'Synthetic migrated statement' }]
        : [],
    }));
    const repaired = await repairStoppingCaptureJournalTranscript(root, {
      meetingId,
      transcribeChunk,
      transcriptionConfig,
    });

    expect(savedMic.checkpoint.source).toBe('mic');
    expect(transcribeChunk).toHaveBeenCalledTimes(1);
    expect(transcribeChunk).toHaveBeenCalledWith(
      expect.any(String),
      transcriptionConfig,
      2,
    );
    expect(repaired.transcriptCheckpoints).toHaveLength(2);
    expect(repaired.acceptanceFrames).toHaveLength(1);
    expect(repaired.lifecycleState).toBe('stopping');

    const saveMeeting = vi.fn();
    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting,
      stitchWavSegments: async (_segments, outputTag) =>
        join(root, `${outputTag}.wav`),
      transcribeChunk,
      transcriptionConfig,
      nowMs: 4_000,
    });

    expect(result.recoveredCount).toBe(1);
    expect(saveMeeting).toHaveBeenCalledTimes(1);
    await expect(
      verifySealedCaptureJournalTranscriptEvidence(root, meetingId),
    ).resolves.toMatchObject({ segmentCount: 1 });
  });

  it('executes short coverage repair requested for an empty valid checkpoint', async () => {
    const root = await makeRoot();
    const meetingId = 'meeting-short-coverage-repair';
    let manifest = await createCaptureJournal(root, {
      meetingId,
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (manifest.schemaVersion !== 3) throw new Error('expected v3 journal');
    manifest = await authorizeCaptureJournalInterval(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
    });
    const receipts = {} as Record<
      'mic' | 'system',
      Awaited<ReturnType<typeof completeCaptureJournalCapturedChunk>>['receipt']
    >;
    for (const source of ['mic', 'system'] as const) {
      manifest = await persistCaptureJournalRawChunk(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        source,
        sequence: 0,
        format: 'wav',
        data: Buffer.from(`${source}-raw`),
      });
      const raw = manifest.intervals[0].sources[source];
      if (raw.disposition !== 'raw_durable') throw new Error('expected raw');
      const completed = await completeCaptureJournalCapturedChunk(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        source,
        sequence: 0,
        rawChecksumSha256: raw.rawChecksumSha256,
        repairData: Buffer.from(`${source}-repair`),
      });
      manifest = completed.manifest;
      receipts[source] = completed.receipt;
    }
    const transcriptionConfig = {
      backend: 'mlx_preview',
      preset: 'balanced',
      model: 'small',
      device: 'mlx',
      computeType: 'float16',
      languageMode: 'detected' as const,
      requestedLanguage: null,
      pipelineVersion: 'live_chunk_v1' as const,
    };
    const configKey = createHash('sha256')
      .update(canonicalizeTranscriptCheckpointConfig(transcriptionConfig))
      .digest('hex');
    const checkpointDigests = {} as Record<'mic' | 'system', string>;
    for (const source of ['mic', 'system'] as const) {
      const saved = await appendCaptureTranscriptCheckpoint(root, {
        receipt: receipts[source],
        expectedManifestRevision: manifest.revision,
        transcriptionConfigKey: configKey,
        sidecar: {
          schemaVersion: 1,
          meetingId,
          source,
          sequence: 0,
          chunkChecksumSha256: receipts[source].checksumSha256,
          chunkStartSec: 0,
          chunkEndSec: 2,
          transcriptionConfig,
          backendResult: { detectedLanguage: 'en', providerLabel: 'local' },
          segments: [],
        },
      });
      manifest = saved.manifest;
      checkpointDigests[source] = saved.checkpoint.transcriptChecksumSha256;
    }
    const activityEvidence = await buildEvidence();
    manifest = await updateCaptureJournalActivityEvidence(root, {
      meetingId,
      activityEvidence,
    });
    const activityInputs = {
      chunkStartSec: 0,
      chunkEndSec: 2,
      evidence: {
        clock: activityEvidence.clock,
        thresholds: activityEvidence.thresholds,
        algorithmVersion: activityEvidence.algorithmVersion,
        serializationVersion: activityEvidence.serializationVersion,
        windows: activityEvidence.windows,
      },
    };
    const savedFrame = await appendCaptureTranscriptAcceptanceFrame(root, {
      meetingId,
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      micCheckpointChecksumSha256: checkpointDigests.mic,
      systemCheckpointChecksumSha256: checkpointDigests.system,
      activityEvidenceDigestSha256: createHash('sha256')
        .update(JSON.stringify(activityInputs))
        .digest('hex'),
      sidecar: {
        schemaVersion: 1,
        meetingId,
        sequence: 0,
        arbitrationVersion: 'chunk_arbitration_v1',
        activityInputs,
        segments: [],
      },
    });
    manifest = await stopCaptureJournal(root, {
      meetingId,
      generation: savedFrame.manifest.generation,
      expectedRevision: savedFrame.manifest.revision,
    });

    const transcribeChunk = vi.fn(async () => ({
      detectedLanguage: 'en',
      providerLabel: 'local',
      segments: [],
    }));
    const saveMeeting = vi.fn();
    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting,
      stitchWavSegments: async (_segments, outputTag) =>
        join(root, `${outputTag}.wav`),
      transcribeChunk,
      transcriptionConfig,
      nowMs: 4_000,
    });

    expect(result.recoveredCount).toBe(1);
    expect(result.failedRecoveryCount).toBe(0);
    expect(transcribeChunk).toHaveBeenCalledTimes(1);
    expect(transcribeChunk).toHaveBeenCalledWith(
      expect.stringContaining('mic-000000.wav'),
      transcriptionConfig,
      2,
    );
    const recoveredManifest = await readCaptureJournalManifest(root, meetingId);
    if (recoveredManifest.schemaVersion !== 3) {
      throw new Error('expected recovered v3 journal');
    }
    expect(
      recoveredManifest.transcriptCheckpoints.find(
        (checkpoint) => checkpoint.source === 'mic',
      )?.repairAttempted,
    ).toBe(true);
  });

  it('re-evaluates correlated speech after replacing its source checkpoint', async () => {
    const runScenario = async (replaceCorrelatedSource: boolean) => {
      const root = await makeRoot();
      const meetingId = replaceCorrelatedSource
        ? 'meeting-invalidated-correlation'
        : 'meeting-stable-correlation';
      const chunkEndSec = replaceCorrelatedSource ? 4 : 2;
      let manifest = await createCaptureJournal(root, {
        meetingId,
        startedAtMs: 1_000,
        schemaVersion: 3,
      });
      if (manifest.schemaVersion !== 3) throw new Error('expected v3 journal');
      manifest = await authorizeCaptureJournalInterval(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec,
      });
      const receipts = {} as Record<
        'mic' | 'system',
        Awaited<
          ReturnType<typeof completeCaptureJournalCapturedChunk>
        >['receipt']
      >;
      for (const source of ['mic', 'system'] as const) {
        manifest = await persistCaptureJournalRawChunk(root, {
          meetingId,
          generation: manifest.generation,
          expectedRevision: manifest.revision,
          source,
          sequence: 0,
          format: 'wav',
          data: Buffer.from(`${source}-raw`),
        });
        const raw = manifest.intervals[0].sources[source];
        if (raw.disposition !== 'raw_durable') throw new Error('expected raw');
        const completed = await completeCaptureJournalCapturedChunk(root, {
          meetingId,
          generation: manifest.generation,
          expectedRevision: manifest.revision,
          source,
          sequence: 0,
          rawChecksumSha256: raw.rawChecksumSha256,
          repairData: Buffer.from(`${source}-repair`),
        });
        manifest = completed.manifest;
        receipts[source] = completed.receipt;
      }
      const transcriptionConfig = {
        backend: 'mlx_preview',
        preset: 'balanced',
        model: 'small',
        device: 'mlx',
        computeType: 'float16',
        languageMode: 'detected' as const,
        requestedLanguage: null,
        pipelineVersion: 'live_chunk_v1' as const,
      };
      const configKey = createHash('sha256')
        .update(canonicalizeTranscriptCheckpointConfig(transcriptionConfig))
        .digest('hex');
      const micSegments = [
        {
          start: 0.25,
          end: replaceCorrelatedSource ? 0.45 : 0.9,
          text: 'Synthetic accepted source',
        },
      ];
      const checkpointDigests = {} as Record<'mic' | 'system', string>;
      for (const source of ['mic', 'system'] as const) {
        const saved = await appendCaptureTranscriptCheckpoint(root, {
          receipt: receipts[source],
          expectedManifestRevision: manifest.revision,
          transcriptionConfigKey: configKey,
          sidecar: {
            schemaVersion: 1,
            meetingId,
            source,
            sequence: 0,
            chunkChecksumSha256: receipts[source].checksumSha256,
            chunkStartSec: 0,
            chunkEndSec,
            transcriptionConfig,
            backendResult: { detectedLanguage: 'en', providerLabel: 'local' },
            segments: source === 'mic' ? micSegments : [],
          },
        });
        manifest = saved.manifest;
        checkpointDigests[source] = saved.checkpoint.transcriptChecksumSha256;
      }
      const activityEvidence = await buildCaptureActivityEvidence(
        [
          ...(replaceCorrelatedSource
            ? [{ startTime: 0.25, endTime: 3.7, speaker: 'Me' as const }]
            : []),
          {
            startTime: replaceCorrelatedSource ? 3.7 : 0.5,
            endTime: replaceCorrelatedSource ? 4 : 1,
            speaker: 'Them' as const,
          },
        ],
        {
          clock: {
            kind: 'meeting_relative_seconds',
            origin: 'recording_start',
          },
          thresholds: {
            rms: 0.02,
            dominanceRatio: 1.4,
            minimumSwitchIntervalMs: 250,
          },
          algorithmVersion: 'speaker_activity_v1',
        },
      );
      manifest = await updateCaptureJournalActivityEvidence(root, {
        meetingId,
        activityEvidence,
      });
      const activityInputs = {
        chunkStartSec: 0,
        chunkEndSec,
        evidence: {
          clock: activityEvidence.clock,
          thresholds: activityEvidence.thresholds,
          algorithmVersion: activityEvidence.algorithmVersion,
          serializationVersion: activityEvidence.serializationVersion,
          windows: activityEvidence.windows,
        },
      };
      const savedFrame = await appendCaptureTranscriptAcceptanceFrame(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        sequence: 0,
        micCheckpointChecksumSha256: checkpointDigests.mic,
        systemCheckpointChecksumSha256: checkpointDigests.system,
        activityEvidenceDigestSha256: createHash('sha256')
          .update(JSON.stringify(activityInputs))
          .digest('hex'),
        sidecar: {
          schemaVersion: 1,
          meetingId,
          sequence: 0,
          arbitrationVersion: 'chunk_arbitration_v1',
          activityInputs,
          segments: micSegments.map((segment) => ({
            source: 'mic' as const,
            ...segment,
          })),
        },
      });
      await stopCaptureJournal(root, {
        meetingId,
        generation: savedFrame.manifest.generation,
        expectedRevision: savedFrame.manifest.revision,
      });
      const transcribeChunk = vi.fn(async () => ({
        detectedLanguage: 'en',
        providerLabel: 'local',
        segments: [],
      }));
      const result = await recoverInterruptedCaptureJournals(root, {
        getMeeting: () => null,
        saveMeeting: vi.fn(),
        stitchWavSegments: async (_segments, outputTag) =>
          join(root, `${outputTag}.wav`),
        transcribeChunk,
        transcriptionConfig,
        nowMs: 6_000,
      });
      return { result, transcribeChunk };
    };

    const stable = await runScenario(false);
    expect(stable.result).toMatchObject({
      recoveredCount: 1,
      failedRecoveryCount: 0,
    });
    expect(stable.transcribeChunk).not.toHaveBeenCalled();

    const invalidated = await runScenario(true);
    expect(invalidated.result).toMatchObject({
      recoveredCount: 1,
      failedRecoveryCount: 0,
    });
    expect(invalidated.transcribeChunk).toHaveBeenCalledTimes(2);
    expect(
      invalidated.transcribeChunk.mock.calls.map(([path]) => path),
    ).toEqual([
      expect.stringContaining('mic-000000.wav'),
      expect.stringContaining('system-000000.wav'),
    ]);
  });

  it('continues recovering later journals after one stitch operation fails', async () => {
    const root = await makeRoot();
    for (const meetingId of ['meeting-a', 'meeting-b']) {
      await createCaptureJournal(root, { meetingId, startedAtMs: 1_000 });
      await appendCaptureJournalChunk(root, {
        meetingId,
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 1,
        format: 'wav',
        data: Buffer.from(`${meetingId}-mic`),
      });
    }

    const savedMeetingIds: string[] = [];
    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting: (meeting) => savedMeetingIds.push(meeting.id),
      stitchWavSegments: async (_segments, outputTag) => {
        if (outputTag.startsWith('meeting-a-')) {
          throw new Error('synthetic stitch failure');
        }
        return join(root, `${outputTag}.wav`);
      },
      nowMs: 5_000,
    });

    expect(result).toMatchObject({
      recoveredCount: 1,
      failedRecoveryCount: 1,
    });
    expect(savedMeetingIds).toEqual(['meeting-b']);
  });

  it('continues recovering later journals after one meeting save fails', async () => {
    const root = await makeRoot();
    for (const meetingId of ['meeting-a', 'meeting-b']) {
      await createCaptureJournal(root, { meetingId, startedAtMs: 1_000 });
      await appendCaptureJournalChunk(root, {
        meetingId,
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 1,
        format: 'wav',
        data: Buffer.from(`${meetingId}-mic`),
      });
    }

    const savedMeetingIds: string[] = [];
    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting: async (meeting) => {
        if (meeting.id === 'meeting-a') {
          throw new Error('synthetic async save failure');
        }
        savedMeetingIds.push(meeting.id);
      },
      stitchWavSegments: async (_segments, outputTag) =>
        join(root, `${outputTag}.wav`),
      nowMs: 5_000,
    });

    expect(result).toMatchObject({
      recoveredCount: 1,
      failedRecoveryCount: 1,
    });
    expect(savedMeetingIds).toEqual(['meeting-b']);
  });

  it('rejects an escaped chunk path before reads and recovers later journals', async () => {
    const root = await makeRoot();
    for (const meetingId of ['meeting-a', 'meeting-b']) {
      await createCaptureJournal(root, { meetingId, startedAtMs: 1_000 });
      await appendCaptureJournalChunk(root, {
        meetingId,
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 1,
        format: 'wav',
        data: Buffer.from(`${meetingId}-mic`),
      });
    }

    const sentinelPath = join(root, 'sentinel.wav');
    await writeFile(sentinelPath, Buffer.from('meeting-a-mic'));
    const manifestPath = join(
      root,
      'meeting-a',
      'capture-journal',
      'manifest.json',
    );
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      entries: Array<{ relativePath: string }>;
    };
    parsed.entries[0].relativePath = 'sentinel.wav';
    await writeFile(manifestPath, JSON.stringify(parsed));

    const savedMeetingIds: string[] = [];
    const stitchWavSegments = vi.fn(
      async (_segments: Array<{ path: string }>, outputTag: string) =>
        join(root, `${outputTag}.wav`),
    );
    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting: (meeting) => savedMeetingIds.push(meeting.id),
      stitchWavSegments,
      nowMs: 5_000,
    });

    expect(result).toMatchObject({
      recoveredCount: 1,
      skippedInvalidManifestCount: 1,
    });
    expect(stitchWavSegments).toHaveBeenCalledTimes(1);
    const stitchedSegments = stitchWavSegments.mock.calls.flatMap(
      ([segments]) => segments,
    );
    expect(stitchedSegments).not.toContainEqual(
      expect.objectContaining({ path: sentinelPath }),
    );
    expect(savedMeetingIds).toEqual(['meeting-b']);
  });

  it('recovers a sealed journal when its meeting was not saved', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 1,
      format: 'wav',
      data: Buffer.from('mic-0'),
    });
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: await buildEvidence(),
    });
    await sealCaptureJournal(root, {
      meetingId: 'meeting-123',
      endedAtMs: 2_000,
    });

    const saveMeeting = vi.fn();
    const stitchWavSegments = vi.fn(
      async (_segments: Array<{ path: string }>, outputTag: string) =>
        join(root, `${outputTag}.wav`),
    );
    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting,
      stitchWavSegments,
      nowMs: 3_000,
    });

    expect(result).toMatchObject({
      recoveredCount: 1,
      skippedSealedCount: 0,
    });
    expect(saveMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'meeting-123',
        transcript_status: 'needs_attention',
        transcript_integrity_json: expect.any(String),
      }),
    );
    const recovered = saveMeeting.mock.calls[0]?.[0];
    const integrity = JSON.parse(recovered.transcript_integrity_json) as {
      state: string;
      evidenceProvenance: { kind: string };
      activityEvidence?: { digestSha256: string };
    };
    expect(integrity).toMatchObject({
      state: 'needs_attention',
      evidenceProvenance: { kind: 'sealed_capture_activity_v2' },
      activityEvidence: {
        digestSha256: (await buildEvidence()).digestSha256,
      },
    });
  });

  it('updates an existing recovery-required meeting with recovered audio', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 1,
      format: 'wav',
      data: Buffer.from('mic-0'),
    });
    const degraded = buildRecoverableSealFailureMeeting({
      snapshot: {
        meetingId: 'meeting-123',
        recordingStartedAtMs: 1_000,
        recordingEndedAtMs: 2_000,
      },
      title: 'Keep my title',
      userNotes: 'Keep my notes',
      endReason: 'manual',
      failureReason: 'capture_journal_write_failed',
    }) as PersistedMeeting;
    degraded.folder_id = 'folder-keep';
    degraded.is_favorite = true;
    const saveMeeting = vi.fn();

    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => degraded,
      saveMeeting,
      stitchWavSegments: async (_segments, outputTag) =>
        join(root, `${outputTag}.wav`),
      nowMs: 3_000,
    });

    expect(result).toMatchObject({
      recoveredCount: 1,
      skippedExistingCount: 0,
    });
    expect(saveMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'meeting-123',
        title: 'Keep my title',
        user_notes: 'Keep my notes',
        end_reason: 'manual',
        folder_id: 'folder-keep',
        is_favorite: true,
        audio_path: join(root, 'meeting-123-mic-recovered.wav'),
        transcript_status: 'needs_attention',
        finalization_status: 'finalized',
        finalization_error_category: null,
      }),
    );
  });

  it('skips a sealed journal after its meeting was saved', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: await buildEvidence(),
    });
    await sealCaptureJournal(root, {
      meetingId: 'meeting-123',
      endedAtMs: 2_000,
    });

    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => ({ id: 'meeting-123' }) as PersistedMeeting,
      saveMeeting: vi.fn(),
      stitchWavSegments: vi.fn(),
      nowMs: 3_000,
    });

    expect(result).toMatchObject({
      recoveredCount: 0,
      skippedSealedCount: 1,
    });
  });

  it.each([
    {
      name: 'legacy v1',
      mutate: (manifest: Record<string, unknown>) => {
        manifest.schemaVersion = 1;
        Reflect.deleteProperty(manifest, 'activityEvidence');
      },
      source: 'legacy_provisional_segments',
      reason: 'capture_activity_missing',
    },
    {
      name: 'sealed missing v2 evidence',
      mutate: (manifest: Record<string, unknown>) => {
        manifest.lifecycleState = 'sealed';
        Reflect.deleteProperty(manifest, 'activityEvidence');
      },
      source: 'capture_activity_missing',
      reason: 'capture_activity_missing',
    },
    {
      name: 'malformed v2 evidence',
      mutate: (manifest: Record<string, unknown>) => {
        manifest.activityEvidence = { source: 'capture_activity_v2' };
      },
      source: 'capture_activity_corrupt',
      reason: 'capture_activity_corrupt',
    },
    {
      name: 'null v2 evidence',
      mutate: (manifest: Record<string, unknown>) => {
        manifest.activityEvidence = null;
      },
      source: 'capture_activity_corrupt',
      reason: 'capture_activity_corrupt',
    },
    {
      name: 'unsupported v2 evidence',
      mutate: (manifest: Record<string, unknown>) => {
        manifest.activityEvidence = {
          schemaVersion: 3,
          source: 'capture_activity_v3',
          serializationVersion: 2,
        };
      },
      source: 'capture_activity_unsupported',
      reason: 'capture_activity_unsupported',
    },
    {
      name: 'digest-mismatched v2 evidence',
      mutate: (manifest: Record<string, unknown>) => {
        const evidence = manifest.activityEvidence as Record<string, unknown>;
        evidence.digestSha256 = '0'.repeat(64);
      },
      source: 'capture_activity_corrupt',
      reason: 'capture_activity_corrupt',
    },
  ])(
    'recovers audio with content-free uncertainty for $name',
    async ({ mutate, source, reason }) => {
      const root = await makeRoot();
      await createCaptureJournal(root, {
        meetingId: 'meeting-evidence',
        startedAtMs: 1_000,
      });
      await appendCaptureJournalChunk(root, {
        meetingId: 'meeting-evidence',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 2,
        format: 'wav',
        data: Buffer.from('synthetic-audio'),
      });
      await updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-evidence',
        activityEvidence: await buildEvidence(),
      });
      const manifestPath = join(
        root,
        'meeting-evidence',
        'capture-journal',
        'manifest.json',
      );
      const manifest = JSON.parse(
        await readFile(manifestPath, 'utf8'),
      ) as Record<string, unknown>;
      mutate(manifest);
      await writeFile(manifestPath, JSON.stringify(manifest));

      const { result, integrity } = await recoverSingleMeeting(root);

      expect(result.recoveredCount).toBe(1);
      const provenanceKind =
        source === 'legacy_provisional_segments'
          ? 'legacy_provisional_segments'
          : source === 'capture_activity_missing'
            ? 'missing'
            : source === 'capture_activity_unsupported'
              ? 'unsupported'
              : 'corrupt';
      expect(integrity).toEqual(
        expect.objectContaining({
          evidenceProvenance: expect.objectContaining({
            kind: provenanceKind,
          }),
          causes: expect.arrayContaining([{ code: reason }]),
        }),
      );
      expect(integrity.activityEvidence).toBeUndefined();
      expect(JSON.stringify(integrity)).not.toContain('provisionalSegments');
    },
  );

  it('skips invalid chunk artifacts and records recovery gaps', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
      format: 'wav',
      data: Buffer.from('mic-0'),
    });
    const manifest = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 1,
      chunkStartSec: 2,
      chunkEndSec: 4,
      format: 'wav',
      data: Buffer.from('mic-1'),
    });

    await truncate(join(root, manifest.entries[1].relativePath), 1);

    const stitchWavSegments = vi
      .fn()
      .mockImplementation(async (segments, outputTag: string) => {
        expect(segments).toHaveLength(1);
        return join(root, `${outputTag}.wav`);
      });
    const saveMeeting = vi.fn();

    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting,
      stitchWavSegments,
      nowMs: 5_000,
    });

    expect(result.recoveredCount).toBe(1);
    expect(saveMeeting).toHaveBeenCalledTimes(1);
    const recoveredMeeting = saveMeeting.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    const integrity = JSON.parse(
      String(recoveredMeeting.transcript_integrity_json),
    ) as {
      causes: Array<{ code: string; sourceScope?: string }>;
      recovery: {
        gapDetected: boolean;
        sourceScope: string;
        acknowledgedChunkCount: number;
        recoveredChunkCount: number;
      };
    };

    expect(integrity.recovery).toMatchObject({
      gapDetected: true,
      sourceScope: 'mic',
      acknowledgedChunkCount: 2,
      recoveredChunkCount: 1,
    });
    expect(integrity.causes).toContainEqual({
      code: 'capture_gap_detected',
      sourceScope: 'mic',
    });

    const recoveredPath = String(recoveredMeeting.audio_path);
    expect(recoveredPath).toContain('meeting-123-mic-recovered.wav');
    expect(
      await stat(join(root, manifest.entries[0].relativePath)),
    ).toBeTruthy();
  });

  it('skips checksum-mismatched chunks even when byte count still matches', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
      format: 'wav',
      data: Buffer.from('mic-0'),
    });
    const manifest = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 1,
      chunkStartSec: 2,
      chunkEndSec: 4,
      format: 'wav',
      data: Buffer.from('mic-1'),
    });

    await writeFile(
      join(root, manifest.entries[1].relativePath),
      Buffer.from('mic-x'),
    );

    const stitchWavSegments = vi
      .fn()
      .mockImplementation(async (segments, outputTag: string) => {
        expect(segments).toHaveLength(1);
        return join(root, `${outputTag}.wav`);
      });
    const saveMeeting = vi.fn();

    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting,
      stitchWavSegments,
      nowMs: 5_000,
    });

    expect(result.recoveredCount).toBe(1);
    expect(saveMeeting).toHaveBeenCalledTimes(1);
    const recoveredMeeting = saveMeeting.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    const integrity = JSON.parse(
      String(recoveredMeeting.transcript_integrity_json),
    ) as {
      causes: Array<{ code: string; sourceScope?: string }>;
      recovery: {
        gapDetected: boolean;
        sourceScope: string;
        acknowledgedChunkCount: number;
        recoveredChunkCount: number;
      };
    };

    expect(integrity.recovery).toMatchObject({
      gapDetected: true,
      sourceScope: 'mic',
      acknowledgedChunkCount: 2,
      recoveredChunkCount: 1,
    });
    expect(integrity.causes).toContainEqual({
      code: 'capture_gap_detected',
      sourceScope: 'mic',
    });
  });
});
