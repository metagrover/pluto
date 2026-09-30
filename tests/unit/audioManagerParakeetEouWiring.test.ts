import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AudioManager Parakeet EOU wiring', () => {
  const source = readFileSync('src/components/AudioManager.tsx', 'utf8');

  it('creates and launches the EOU session without blocking microphone acquisition', () => {
    const createIndex = source.indexOf('createDurableEouSession({');
    const startIndex = source.indexOf('eouSession.start()');
    const microphoneIndex = source.indexOf(
      'navigator.mediaDevices.getUserMedia',
    );
    expect(createIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(createIndex);
    expect(startIndex).toBeLessThan(microphoneIndex);
    expect(source.slice(startIndex, microphoneIndex)).not.toContain(
      'await eouSession.start()',
    );
  });

  it('reads persisted audio instead of coupling capture PCM to inference', () => {
    expect(source).toContain("'PARAKEET_EOU_READ_AUDIO'");
    expect(source).toContain('micPcmChunksRef.current.push(copied)');
    expect(source).not.toContain('eouSessionRef.current?.append(');
  });

  it('publishes the reconciled reading projection while retaining raw EOU text', () => {
    expect(source).toContain('processedMicSegmentsRef.current = segments');
    expect(source).toContain('reconcileLiveTranscriptSegments({');
    expect(source).toContain('onLiveTranscript?.(readingSegments)');
    expect(source).toContain("onInterimTranscript?.('')");
    expect(source).not.toContain(
      'const stable = segments.filter((segment) => segment.confirmed)',
    );
    expect(source).toContain('reconcileLiveTranscriptReading({');
    expect(source).toContain('projector.apply({');
    expect(source).toContain('meetingContextIngestion.accept(segments)');
  });

  it('contains presentation failure without returning before raw ingestion', () => {
    const callbackStart = source.indexOf(
      'onSegments: (segments, echoEvidence, reason) =>',
    );
    const callbackEnd = source.indexOf(
      'onUnavailable: (code) =>',
      callbackStart,
    );
    const callback = source.slice(callbackStart, callbackEnd);
    const catchIndex = callback.indexOf('catch (error)');
    const echoOnlyReturn = callback.indexOf("if (reason === 'echo_evidence')");
    const rawAssignment = callback.indexOf(
      'processedMicSegmentsRef.current = segments',
    );
    const rawIngestion = callback.indexOf(
      'meetingContextIngestion.accept(segments)',
    );
    expect(catchIndex).toBeGreaterThan(-1);
    expect(echoOnlyReturn).toBeGreaterThan(catchIndex);
    expect(rawAssignment).toBeGreaterThan(echoOnlyReturn);
    expect(rawIngestion).toBeGreaterThan(rawAssignment);
  });

  it('reads the stable-conversation rollout once before constructing the EOU session', () => {
    const generationIndex = source.indexOf(
      'const eouGeneration = eouGenerationRef.current',
    );
    const rolloutIndex = source.indexOf(
      'await createLiveConversationRollout({',
      generationIndex,
    );
    const sessionIndex = source.indexOf(
      'createDurableEouSession({',
      rolloutIndex,
    );
    expect(generationIndex).toBeGreaterThan(-1);
    expect(rolloutIndex).toBeGreaterThan(generationIndex);
    expect(sessionIndex).toBeGreaterThan(rolloutIndex);
  });

  it('publishes live text before non-blocking context ingestion', () => {
    const publishIndex = source.indexOf('onLiveTranscript?.(readingSegments)');
    const ingestIndex = source.indexOf(
      'meetingContextIngestion.accept(segments)',
    );

    expect(publishIndex).toBeGreaterThan(-1);
    expect(ingestIndex).toBeGreaterThan(publishIndex);
    expect(source.slice(publishIndex, ingestIndex + 80)).not.toContain(
      'await meetingContextIngestion',
    );
  });

  it('persists original EOU rows separately from the merged canonical preview', () => {
    const snapshotStart = source.indexOf('const capturedLiveSegments =');
    const snapshotEnd = source.indexOf(
      'const provisionalMeeting =',
      snapshotStart,
    );
    const snapshot = source.slice(snapshotStart, snapshotEnd);
    expect(snapshotStart).toBeGreaterThan(-1);
    expect(snapshot).toContain('[...processedMicSegmentsRef.current]');
    expect(snapshot).toMatch(
      /mergeConsecutiveSpeakerSegments\(\s*capturedLiveSegments/,
    );
    expect(snapshot).toContain('buildTranscriptJsonPayload(capturedSegments,');
    expect(snapshot).toContain('liveSegments: capturedLiveSegments');
  });

  it('finishes EOU before closing context ingestion', () => {
    const finishIndex = source.indexOf('await eouSessionAtStop?.finish()');
    const closeIndex = source.indexOf(
      'meetingContextIngestionAtStop?.close()',
      finishIndex,
    );

    expect(closeIndex).toBeGreaterThan(finishIndex);
  });

  it('finishes EOU before capture stop and canonical finalization', () => {
    const finishIndex = source.indexOf('await eouSessionAtStop?.finish()');
    const captureStopIndex = source.indexOf("'AUDIO_CAPTURE_JOURNAL_STOP'");
    expect(finishIndex).toBeGreaterThan(-1);
    expect(finishIndex).toBeLessThan(captureStopIndex);
  });

  it('materializes sealed mic and system audio on one canonical timeline', () => {
    const sealIndex = source.indexOf('sealCaptureJournalBeforeFinalization({');
    const micMaterializeIndex = source.indexOf(
      "'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE'",
    );
    const systemMaterializeIndex = source.indexOf(
      "'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE'",
      micMaterializeIndex + 1,
    );
    const saveIndex = source.indexOf("'SAVE_MEETING'", systemMaterializeIndex);
    const materialization = source.slice(micMaterializeIndex, saveIndex);

    expect(micMaterializeIndex).toBeGreaterThan(sealIndex);
    expect(systemMaterializeIndex).toBeGreaterThan(micMaterializeIndex);
    expect(materialization).toContain("source: 'mic'");
    expect(materialization).toContain(
      'if (rebuiltMicPath) primaryAudioPath = rebuiltMicPath',
    );
    expect(materialization).toContain("source: 'system'");
    expect(saveIndex).toBeGreaterThan(systemMaterializeIndex);
  });

  it('persists the sealed handoff and releases capture before materialization', () => {
    const sealIndex = source.indexOf('sealCaptureJournalBeforeFinalization({');
    const handoffSaveIndex = source.indexOf(
      'sealedActivityHandoff.persistMeeting(',
      sealIndex,
    );
    const releaseIndex = source.indexOf(
      "publishCaptureLifecycle({ state: 'idle' })",
      handoffSaveIndex,
    );
    const materializeIndex = source.indexOf(
      "'AUDIO_CAPTURE_JOURNAL_STITCH_SOURCE'",
      releaseIndex,
    );

    expect(handoffSaveIndex).toBeGreaterThan(sealIndex);
    expect(releaseIndex).toBeGreaterThan(handoffSaveIndex);
    expect(materializeIndex).toBeGreaterThan(releaseIndex);
  });

  it('keeps the sealed provisional handoff in a processing state', () => {
    expect(source).toMatch(
      /transcript_status: 'provisional',[\s\S]{0,700}finalization_status: 'processing'/u,
    );
  });

  it('keeps the active EOU session across ordinary AudioManager rerenders', () => {
    const listenerEffectStart = source.indexOf(
      '// Set up event listeners for external control',
    );
    const listenerEffectEnd = source.indexOf(
      '// Expose stopSession and startSession to parent via refs',
      listenerEffectStart,
    );
    const listenerEffect = source.slice(listenerEffectStart, listenerEffectEnd);

    expect(listenerEffect).toContain('startSessionActionRef.current()');
    expect(listenerEffect).toContain('stopSessionActionRef.current()');
    expect(listenerEffect).toMatch(
      /return \(\) => \{[\s\S]*?\n {2}\}, \[\]\);/u,
    );
  });

  it('claims a synchronous start lock before asynchronous readiness', () => {
    const startIndex = source.indexOf('const startSession = async ()');
    const stopIndex = source.indexOf('const stopSession = async', startIndex);
    const startSession = source.slice(startIndex, stopIndex);
    const guardIndex = source.indexOf(
      "captureLifecycleRef.current.state !== 'idle'",
      startIndex,
    );
    const claimIndex = source.indexOf(
      "publishCaptureLifecycle({ state: 'starting' })",
      guardIndex,
    );
    const readinessIndex = source.indexOf(
      "'RECORDING_READINESS_PREPARE'",
      claimIndex,
    );
    const releaseIndex = source.indexOf("state: 'idle'", readinessIndex);

    expect(guardIndex).toBeGreaterThan(startIndex);
    expect(claimIndex).toBeGreaterThan(guardIndex);
    expect(claimIndex).toBeLessThan(readinessIndex);
    expect(releaseIndex).toBeGreaterThan(readinessIndex);
    expect(startSession).not.toContain("'RECORDING_READINESS_STATUS'");
  });

  it('publishes starting feedback before asynchronous readiness', () => {
    const startIndex = source.indexOf('const startSession = async ()');
    const startingIndex = source.indexOf(
      'onStartingChange?.(true)',
      startIndex,
    );
    const readinessIndex = source.indexOf(
      "'RECORDING_READINESS_PREPARE'",
      startIndex,
    );
    const stoppedStartingIndex = source.indexOf(
      'onStartingChange?.(false)',
      readinessIndex,
    );

    expect(startingIndex).toBeGreaterThan(startIndex);
    expect(startingIndex).toBeLessThan(readinessIndex);
    expect(stoppedStartingIndex).toBeGreaterThan(readinessIndex);
  });

  it('does not publish recording until microphone capture is active', () => {
    const startIndex = source.indexOf('const startSession = async ()');
    const microphonePcmIndex = source.indexOf(
      'micPcmChunksRef.current.push(copied)',
      startIndex,
    );
    const recorderStartIndex = source.indexOf(
      'micRecorder.start(CHUNK_SECONDS * 1000)',
      microphonePcmIndex,
    );
    const recordingStartedIndex = source.indexOf(
      'onRecordingStarted?.(startTimeRef.current)',
      startIndex,
    );
    const recordingStateIndex = source.indexOf(
      'setIsRecording(true)',
      startIndex,
    );
    const lifecycleIndex = source.indexOf(
      "publishCaptureLifecycle({ state: 'recording', meetingId })",
      startIndex,
    );

    expect(microphonePcmIndex).toBeGreaterThan(startIndex);
    expect(recorderStartIndex).toBeGreaterThan(microphonePcmIndex);
    expect(recordingStartedIndex).toBeGreaterThan(recorderStartIndex);
    expect(recordingStateIndex).toBeGreaterThan(recorderStartIndex);
    expect(lifecycleIndex).toBeGreaterThan(recordingStateIndex);
  });

  it('publishes the frozen meeting preview before finalization work', () => {
    const stopIndex = source.indexOf('const stopSession = async');
    const previewIndex = source.indexOf('onFinalizationStarted?.({', stopIndex);
    const recorderStopIndex = source.indexOf(
      'const micBlob = await stopRecorder',
      stopIndex,
    );

    expect(previewIndex).toBeGreaterThan(stopIndex);
    expect(previewIndex).toBeLessThan(recorderStopIndex);
  });

  it('does not synthesize silent PCM for empty system intervals and preserves truthful missing evidence', () => {
    expect(source).not.toContain(
      'else if (hasSystemRecorderRef.current && !systemFailureRecorded)',
    );
    expect(source).not.toContain(
      'const silentPcm = new Float32Array(targetSampleCount);',
    );
    expect(source).toContain('const floatChunks = systemPcmChunksRef.current;');
    expect(source).toContain('if (floatChunks.length > 0) {');
    expect(source).toContain(
      'systemBlob = createWavBlob(intervalPcm, 48000, 1);',
    );
  });

  it('does not purge system audio chunks immediately before starting microphone recorder', () => {
    const recorderStartBlock = source.slice(
      source.indexOf(
        'startMicMediaRecorderRef.current = startMicMediaRecorder',
      ),
      source.indexOf('onRecordingStarted?.(startTimeRef.current)'),
    );
    expect(recorderStartBlock).not.toContain(
      'systemPcmChunksRef.current = [];',
    );
  });
});
