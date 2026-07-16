import { mkdtemp, rm, stat, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendCaptureJournalChunk,
  createCaptureJournal,
  sealCaptureJournal,
} from '../../electron/captureJournal';
import { recoverInterruptedCaptureJournals } from '../../electron/captureJournalRecovery';

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

    expect(
      JSON.parse(String(recoveredMeeting?.transcript_integrity_json)),
    ).toMatchObject({
      recovery_source: 'capture_journal',
      journal_lifecycle_state: 'recording',
      gap_detected: false,
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

  it('ignores sealed journals during startup recovery', async () => {
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
    await sealCaptureJournal(root, {
      meetingId: 'meeting-123',
      endedAtMs: 2_000,
    });

    const result = await recoverInterruptedCaptureJournals(root, {
      getMeeting: () => null,
      saveMeeting: vi.fn(),
      stitchWavSegments: vi.fn(),
      nowMs: 3_000,
    });

    expect(result).toMatchObject({
      recoveredCount: 0,
      skippedSealedCount: 1,
    });
  });

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
});
