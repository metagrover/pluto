import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AudioManager Parakeet EOU wiring', () => {
  const source = readFileSync('src/components/AudioManager.tsx', 'utf8');

  it('creates and starts the EOU session before microphone acquisition', () => {
    const createIndex = source.indexOf('createEouRendererSession({');
    const startIndex = source.indexOf('await eouSession.start()');
    const microphoneIndex = source.indexOf(
      'navigator.mediaDevices.getUserMedia',
    );
    expect(createIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(createIndex);
    expect(startIndex).toBeLessThan(microphoneIndex);
  });

  it('feeds copied mic PCM and decoded System PCM into EOU', () => {
    expect(source).toContain('const copied = new Float32Array(input)');
    expect(source).toContain("eouSessionRef.current?.append('mic', copied)");
    expect(source).toContain(
      "eouSessionRef.current?.append('system', decoded.samples)",
    );
  });

  it('publishes the reconciled reading projection while retaining raw EOU text', () => {
    expect(source).toContain('processedMicSegmentsRef.current = segments');
    expect(source).toContain('reconcileLiveTranscriptSegments({');
    expect(source).toContain('onLiveTranscript?.(readingSegments)');
    expect(source).toContain("onInterimTranscript?.('')");
    expect(source).not.toContain(
      'const stable = segments.filter((segment) => segment.confirmed)',
    );
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
      "eouSessionRef.current?.append('mic', copied)",
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

  it('contains no recording-time MLX transcription machinery', () => {
    expect(source).not.toContain('LiveTranscriptionQueue');
    expect(source).not.toContain('resolveLiveChunkModel');
    expect(source).not.toContain('resolveLiveChunkComputeType');
    expect(source).not.toContain('TRANSCRIPTION_TRANSCRIBE_PREVIEW');
  });
});
