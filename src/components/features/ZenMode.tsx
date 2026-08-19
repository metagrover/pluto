import { useEffect, useMemo, useState } from 'react';
import { LiveTranscript } from './LiveTranscript';
import { RecordingCaptureBar } from './RecordingCaptureBar';
import { RecordingMeetingRail } from './RecordingMeetingRail';
import {
  type CaptureHealthState,
  type LiveTranscriptIntegrity,
  type LiveTranscriptSegment,
  buildRecordingWorkspaceModel,
} from './recordingWorkspaceModel';

interface ZenModeProps {
  isProcessing: boolean;
  onEndMeeting: () => void;
  onBackHome: () => void;
  meetingTitle: string;
  setMeetingTitle: (value: string) => void;
  meetingParticipants: string[];
  setMeetingParticipants: (
    value: string[] | ((previous: string[]) => string[]),
  ) => void;
  participantInput: string;
  setParticipantInput: (value: string) => void;
  currentNotes: string;
  setCurrentNotes: (value: string) => void;
  liveTranscript: LiveTranscriptSegment[];
  interimText?: string;
  captureHealth: CaptureHealthState;
  liveTranscriptIntegrity: LiveTranscriptIntegrity;
  recordingStartedAtMs: number | null;
}

export const ZenMode = ({
  isProcessing,
  onEndMeeting,
  onBackHome,
  meetingTitle,
  setMeetingTitle,
  meetingParticipants,
  setMeetingParticipants,
  participantInput,
  setParticipantInput,
  currentNotes,
  setCurrentNotes,
  liveTranscript,
  interimText = '',
  captureHealth,
  liveTranscriptIntegrity,
  recordingStartedAtMs,
}: ZenModeProps) => {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const model = useMemo(
    () =>
      buildRecordingWorkspaceModel({
        startedAtMs: recordingStartedAtMs,
        nowMs,
        isProcessing,
        microphone: captureHealth.microphone,
        systemAudio: captureHealth.systemAudio,
        captureDurability: captureHealth.captureDurability,
        liveTranscriptIntegrity,
        segments: liveTranscript,
        interimText,
      }),
    [
      captureHealth,
      interimText,
      isProcessing,
      liveTranscript,
      liveTranscriptIntegrity,
      nowMs,
      recordingStartedAtMs,
    ],
  );
  const addParticipant = () => {
    const participant = participantInput.trim();
    if (!participant) return;
    setMeetingParticipants((previous) => [...previous, participant]);
    setParticipantInput('');
  };
  return (
    <main className="recording-workspace">
      <RecordingCaptureBar
        status={model.status}
        elapsedLabel={model.elapsedLabel}
        statusMessage={model.statusMessage}
        microphone={model.microphone}
        systemAudio={model.systemAudio}
        liveTranscriptIntegrity={liveTranscriptIntegrity}
        onBackHome={onBackHome}
        onFinish={onEndMeeting}
      />
      <div className="recording-workspace-grid">
        <RecordingMeetingRail
          title={meetingTitle}
          onTitleChange={setMeetingTitle}
          participants={meetingParticipants}
          participantInput={participantInput}
          onParticipantInputChange={setParticipantInput}
          onAddParticipant={addParticipant}
          onRemoveParticipant={(index) =>
            setMeetingParticipants((previous) =>
              previous.filter((_, current) => current !== index),
            )
          }
          notes={currentNotes}
          onNotesChange={setCurrentNotes}
        />
        <LiveTranscript
          segments={model.transcript}
          interimText={model.interimText}
        />
      </div>
    </main>
  );
};
