import { useEffect, useMemo, useState } from 'react';
import { LiveTranscript } from './LiveTranscript';
import { RecordingCaptureBar } from './RecordingCaptureBar';
import { RecordingMeetingRail } from './RecordingMeetingRail';
import {
  type CaptureHealth,
  type LiveTranscriptIntegrity,
  type LiveTranscriptSegment,
  buildRecordingWorkspaceModel,
} from './recordingWorkspaceModel';

interface ZenModeProps {
  isProcessing: boolean;
  onEndMeeting: () => void;
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
  captureHealth: { microphone: CaptureHealth; systemAudio: CaptureHealth };
  liveTranscriptIntegrity: LiveTranscriptIntegrity;
  recordingStartedAtMs: number | null;
}

export const ZenMode = ({
  isProcessing,
  onEndMeeting,
  meetingTitle,
  setMeetingTitle,
  meetingParticipants,
  setMeetingParticipants,
  participantInput,
  setParticipantInput,
  currentNotes,
  setCurrentNotes,
  liveTranscript,
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
        liveTranscriptIntegrity,
        segments: liveTranscript,
        interimText: '',
      }),
    [
      captureHealth,
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
        title={meetingTitle}
        onTitleChange={setMeetingTitle}
        onFinish={onEndMeeting}
      />
      <div className="recording-workspace-grid">
        <LiveTranscript
          segments={model.transcript}
          interimText={model.interimText}
        />
        <RecordingMeetingRail
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
      </div>
    </main>
  );
};
