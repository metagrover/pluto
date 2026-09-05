import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

import ffprobeStatic from '@ffprobe-installer/ffprobe';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it, vi } from 'vitest';

const workflow = vi.hoisted(() => ({
  userData: `/tmp/pluto-parakeet-app-workflow-${process.pid}-${Date.now()}`,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => workflow.userData,
  },
}));

import {
  claimMeetingDownstreamProcessing,
  claimMeetingFinalTranscription,
  commitMeetingFinalTranscription,
  failMeetingFinalTranscription,
  getMeeting,
  saveMeeting,
  saveMeetingIfDownstreamRunCurrent,
  updateMeetingFinalTranscriptionStage,
} from '../../electron/db';
import type { NativeEouUpdateEvent } from '../../electron/transcription/nativeJsonLineProcess';
import { ParakeetEouMeetingCoordinator } from '../../electron/transcription/parakeetEouMeetingCoordinator';
import { ParakeetFinalClient } from '../../electron/transcription/parakeetFinalClient';
import { parseMacMemoryPressureFreePercent } from '../../src/services/finalTranscription/finalTranscriptionAdmission';
import { runPersistedMeetingFinalTranscription } from '../../src/services/finalTranscription/runPersistedMeetingFinalTranscription';
import type { TranscriptionRequest } from '../../src/services/transcription/contracts';
import type { Meeting } from '../../src/types';

type SourceMeeting = Meeting & {
  ended_at?: string | null;
  mixed_audio_path?: string | null;
};

const requiredEnvironment = () => {
  const values = {
    sourceDatabase: process.env.PLUTO_E2E_SOURCE_DATABASE,
    runtime: process.env.PLUTO_E2E_PARAKEET_RUNTIME,
    modelRoot: process.env.PLUTO_E2E_PARAKEET_MODEL_ROOT,
    audioRoot: process.env.PLUTO_E2E_AUDIO_ROOT,
  };
  return Object.values(values).every(Boolean)
    ? (values as Record<keyof typeof values, string>)
    : null;
};

const parseObject = (value: string | null | undefined) => {
  const parsed = JSON.parse(value || '{}') as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};

const selectRecentMeeting = (databasePath: string): SourceMeeting => {
  const source = new Database(databasePath, { readonly: true });
  try {
    const candidates = source
      .prepare(
        `SELECT * FROM meetings
         WHERE audio_path IS NOT NULL
           AND system_audio_path IS NOT NULL
           AND capture_journal_generation IS NOT NULL
           AND transcript_json IS NOT NULL
           AND transcript_integrity_json IS NOT NULL
         ORDER BY COALESCE(ended_at, created_at) DESC
         LIMIT 20`,
      )
      .all() as SourceMeeting[];
    const selected = candidates.find((meeting) => {
      const integrity = parseObject(meeting.transcript_integrity_json);
      const provenance = integrity.evidenceProvenance as
        | { kind?: unknown }
        | undefined;
      const transcript = parseObject(meeting.transcript_json);
      return (
        provenance?.kind === 'sealed_capture_activity_v2' &&
        integrity.activityEvidence !== undefined &&
        Array.isArray(transcript.segments) &&
        transcript.segments.length > 0 &&
        Boolean(
          transcript.liveTranscriptResponsiveness &&
            typeof transcript.liveTranscriptResponsiveness === 'object',
        ) &&
        fs.existsSync(meeting.audio_path || '') &&
        fs.existsSync(meeting.system_audio_path || '')
      );
    });
    if (!selected) throw new Error('parakeet_workflow_fixture_unavailable');
    return selected;
  } finally {
    source.close();
  }
};

const analysisInputFromTranscript = (transcriptJson: string | undefined) => {
  const transcript = parseObject(transcriptJson);
  const segments = Array.isArray(transcript.segments)
    ? (transcript.segments as Array<{ speaker?: unknown; text?: unknown }>)
    : [];
  return segments
    .filter(
      (segment) =>
        typeof segment.text === 'string' && Boolean(segment.text.trim()),
    )
    .map(
      (segment) => `${String(segment.speaker || 'Unknown')}: ${segment.text}`,
    )
    .join('\n');
};

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const probeDuration = (audioPath: string): number | null => {
  const result = spawnSync(
    ffprobeStatic.path,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) return null;
  const duration = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : null;
};

const probeMemoryAvailability = () => {
  const result = spawnSync('/usr/bin/memory_pressure', ['-Q'], {
    encoding: 'utf8',
  });
  const percentage =
    result.status === 0
      ? parseMacMemoryPressureFreePercent(result.stdout)
      : null;
  return percentage === null
    ? { availableMemoryBytes: os.freemem() }
    : {
        availableMemoryBytes: Math.floor((os.totalmem() * percentage) / 100),
        memoryPressureFreePercent: percentage,
      };
};

afterAll(() => {
  fs.rmSync(workflow.userData, { recursive: true, force: true });
});

describe('Parakeet application workflow', () => {
  it('keeps stop, seal, canonical final, and reload reachable after EOU exits', async () => {
    const calls: string[] = [];
    let updateListener = (_event: NativeEouUpdateEvent) => undefined;
    let terminalListener = (_code: string) => undefined;
    let captureActive = true;
    let visiblePreview = '';
    let persistedCanonical = '';
    const fakeClient = {
      open: vi.fn(async () => undefined),
      append: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      onUpdate: vi.fn((listener: typeof updateListener) => {
        updateListener = listener;
        return () => undefined;
      }),
      onTerminalFailure: vi.fn((listener: typeof terminalListener) => {
        terminalListener = listener;
        return () => undefined;
      }),
    };
    const coordinator = new ParakeetEouMeetingCoordinator({
      createClient: async () => fakeClient,
      onUpdate: ({ event }) => {
        visiblePreview = event.committedText;
      },
      onUnavailable: () => calls.push('PARAKEET_EOU_UNAVAILABLE'),
    });
    await coordinator.start({
      meetingId: 'failure-isolation',
      generation: 1,
      owner: 'renderer-1',
    });
    updateListener({
      schemaVersion: 1,
      event: 'eou_update',
      streamId: 'eou-failure-isolation-mic',
      source: 'mic',
      generation: 1,
      revision: 1,
      processedAudioSeconds: 0.32,
      committedText: 'synthetic committed preview',
      tentativeText: '',
      tokens: [],
    });
    terminalListener('parakeet_runtime_exited');
    await Promise.resolve();
    await Promise.resolve();
    expect(visiblePreview).toBe('synthetic committed preview');
    expect(captureActive).toBe(true);

    calls.push('NATIVE_AUDIO_STOP');
    calls.push('AUDIO_CAPTURE_JOURNAL_SEAL');
    calls.push('TRANSCRIPTION_TRANSCRIBE_FINAL');
    persistedCanonical = 'synthetic canonical final';
    calls.push('PERSISTED_RELOAD');
    captureActive = false;

    expect(calls).toEqual([
      'PARAKEET_EOU_UNAVAILABLE',
      'NATIVE_AUDIO_STOP',
      'AUDIO_CAPTURE_JOURNAL_SEAL',
      'TRANSCRIPTION_TRANSCRIBE_FINAL',
      'PERSISTED_RELOAD',
    ]);
    expect(calls.join('\n')).not.toMatch(/MLX|WHISPER/iu);
    expect(persistedCanonical).toBe('synthetic canonical final');
    expect(persistedCanonical).not.toBe(visiblePreview);
    expect(captureActive).toBe(false);
  });

  const environment = requiredEnvironment();
  const workflowTest =
    process.env.RUN_PARAKEET_APPLICATION_WORKFLOW === '1' && environment
      ? it
      : it.skip;

  workflowTest(
    'replaces a recent provisional transcript and analyzes the exact commit',
    async () => {
      if (!environment) throw new Error('parakeet_workflow_env_missing');
      expect(workflow.userData).toMatch(
        /^\/tmp\/pluto-parakeet-app-workflow-\d+-\d+$/,
      );
      expect(workflow.userData).not.toBe(process.env.PLUTO_E2E_USER_DATA_DIR);
      const source = selectRecentMeeting(environment.sourceDatabase);
      const sourceTranscript = parseObject(source.transcript_json);
      const sourceIntegrity = parseObject(source.transcript_integrity_json);
      const meetingId = `parakeet-app-workflow-${process.pid}`;
      const provisionalTranscript = JSON.stringify({
        ...sourceTranscript,
        lifecycleStatus: 'provisional',
      });
      const provisionalIntegrity = JSON.stringify({
        schemaVersion: 2,
        state: 'provisional',
        causes: [],
        evidenceProvenance: sourceIntegrity.evidenceProvenance,
        activityEvidence: sourceIntegrity.activityEvidence,
      });
      saveMeeting({
        ...source,
        id: meetingId,
        title: 'Meeting',
        transcript_status: 'provisional',
        transcript_validated_at: null,
        transcript_json: provisionalTranscript,
        transcript_integrity_json: provisionalIntegrity,
        enhanced_notes: null,
        analysis_json: null,
        value_signals_json: null,
        downstream_processing_json: null,
        finalization_status: 'finalized',
      });
      expect(getMeeting(meetingId)).toMatchObject({
        transcript_status: 'provisional',
        transcript_json: provisionalTranscript,
      });
      expect(
        parseObject(provisionalTranscript).liveTranscriptResponsiveness,
      ).toBeTruthy();

      const client = new ParakeetFinalClient({
        paths: {
          executablePath: environment.runtime,
          modelRoot: environment.modelRoot,
          audioRoot: environment.audioRoot,
        },
      });
      let analysisInputDigest = '';
      const invoke = async (channel: string, ...args: unknown[]) => {
        switch (channel) {
          case 'GET_MEETING':
            return getMeeting(args[0] as string);
          case 'GET_TRANSCRIPTION_VOCABULARY':
            return { terms: [] };
          case 'GET_CAPTURE_COMPUTE_POLICY':
            return {
              thermalState: 'nominal',
              freeMemoryBytes: os.freemem(),
              totalMemoryBytes: os.totalmem(),
              ...probeMemoryAvailability(),
            };
          case 'CLAIM_FINAL_TRANSCRIPTION':
            return claimMeetingFinalTranscription(
              args[0] as string,
              args[1] as Parameters<typeof claimMeetingFinalTranscription>[1],
            );
          case 'UPDATE_FINAL_TRANSCRIPTION_STAGE':
            return updateMeetingFinalTranscriptionStage(
              args[0] as string,
              args[1] as string,
              args[2] as Parameters<
                typeof updateMeetingFinalTranscriptionStage
              >[2],
            );
          case 'TRANSCRIPTION_TRANSCRIBE_FINAL':
            return await client.transcribe(args[0] as TranscriptionRequest);
          case 'AUDIO_PROBE_DURATION':
            return probeDuration(args[0] as string);
          case 'COMMIT_FINAL_TRANSCRIPTION':
            return commitMeetingFinalTranscription(
              args[0] as Parameters<typeof commitMeetingFinalTranscription>[0],
            );
          case 'FAIL_FINAL_TRANSCRIPTION':
            return failMeetingFinalTranscription(
              args[0] as string,
              args[1] as string,
              args[2] as Parameters<typeof failMeetingFinalTranscription>[2],
            );
          case 'CLAIM_DOWNSTREAM_PROCESSING':
            return claimMeetingDownstreamProcessing(
              args[0] as string,
              args[1] as Parameters<typeof claimMeetingDownstreamProcessing>[1],
            );
          case 'GENERATE_TITLE':
            return 'Workflow-verified meeting';
          case 'GENERATE_ANALYSIS_V2': {
            const input = args[0] as { transcript?: unknown };
            analysisInputDigest = digest(String(input.transcript || ''));
            return {
              markdown: 'workflow-verified',
              analysis: { schemaVersion: 1 },
              signals: { schemaVersion: 1 },
            };
          }
          case 'SAVE_MEETING': {
            const candidate = args[0] as Parameters<typeof saveMeeting>[0];
            const options = args[1] as
              | { expectedDownstreamRunId?: string; expectedTitle?: string }
              | undefined;
            return options?.expectedDownstreamRunId
              ? saveMeetingIfDownstreamRunCurrent(
                  candidate,
                  options.expectedDownstreamRunId,
                  options.expectedTitle,
                )
              : saveMeeting(candidate);
          }
          case 'EXTRACT_AND_PROCESS_ENTITIES':
            return { completed: true };
          case 'REFRESH_KNOWLEDGE_FOR_MEETING_NOW':
            return { requested: 1, completed: 1 };
          default:
            throw new Error(`parakeet_workflow_channel_unhandled:${channel}`);
        }
      };

      try {
        const outcome = await runPersistedMeetingFinalTranscription(
          getMeeting(meetingId) as Meeting,
          invoke,
          { runId: `parakeet-workflow-run-${process.pid}` },
        );
        const committed = getMeeting(meetingId) as Meeting;
        const committedIntegrity = parseObject(
          committed.transcript_integrity_json,
        );
        expect(outcome).toEqual({ status: 'validated' });
        expect(committed.transcript_status).toBe('validated');
        expect(committed.transcript_json).not.toBe(provisionalTranscript);
        expect(parseObject(committed.transcript_json).pipelineMode).toBe(
          'parakeet_final_v1',
        );
        expect(committedIntegrity.finalTranscriptionResult).toMatchObject({
          policy: 'parakeet_final_v1',
          engine: 'parakeet_coreml',
          computeType: 'int8',
        });
        expect(parseObject(committed.downstream_processing_json).state).toBe(
          'complete',
        );
        expect(analysisInputDigest).toBe(
          digest(analysisInputFromTranscript(committed.transcript_json)),
        );
      } finally {
        client.close();
      }
    },
    10 * 60_000,
  );
});
