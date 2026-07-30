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
  createCaptureJournal,
  sealCaptureJournal,
  updateCaptureJournalActivityEvidence,
} from '../../electron/captureJournal';
import { recoverInterruptedCaptureJournals } from '../../electron/captureJournalRecovery';
import type { PersistedMeeting } from '../../electron/db';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

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
        activityEvidenceSource: string;
        activityEvidence?: unknown;
        reasons: string[];
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
      recovery_source: 'capture_journal',
      journal_lifecycle_state: 'recording',
      gap_detected: false,
      activityEvidenceSource: 'capture_activity_v2',
      reasons: [],
      recovered_sources: {
        mic: {
          acknowledgedChunkCount: 1,
          recoveredChunkCount: 1,
        },
        system: {
          acknowledgedChunkCount: 1,
          recoveredChunkCount: 1,
        },
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
      journal_lifecycle_state: string;
      activityEvidenceSource: string;
      activityEvidence?: { digestSha256: string };
    };
    expect(integrity).toMatchObject({
      journal_lifecycle_state: 'sealed',
      activityEvidenceSource: 'capture_activity_v2',
      activityEvidence: {
        digestSha256: (await buildEvidence()).digestSha256,
      },
    });
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
      expect(integrity).toEqual(
        expect.objectContaining({
          activityEvidenceSource: source,
          reasons: [reason],
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
      gap_detected: boolean;
      recovered_sources: {
        mic: {
          gapCount: number;
          recoveredChunkCount: number;
        };
      };
      recovery_gaps: Array<{
        source: string;
        sequence: number;
        reason: string;
      }>;
    };

    expect(integrity.gap_detected).toBe(true);
    expect(integrity.recovered_sources.mic).toMatchObject({
      gapCount: 1,
      recoveredChunkCount: 1,
    });
    expect(integrity.recovery_gaps).toContainEqual({
      source: 'mic',
      sequence: 1,
      reason: 'byte_count_mismatch',
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
      gap_detected: boolean;
      recovered_sources: {
        mic: {
          gapCount: number;
          recoveredChunkCount: number;
        };
      };
      recovery_gaps: Array<{
        source: string;
        sequence: number;
        reason: string;
      }>;
    };

    expect(integrity.gap_detected).toBe(true);
    expect(integrity.recovered_sources.mic).toMatchObject({
      gapCount: 1,
      recoveredChunkCount: 1,
    });
    expect(integrity.recovery_gaps).toContainEqual({
      source: 'mic',
      sequence: 1,
      reason: 'checksum_mismatch',
    });
  });
});
