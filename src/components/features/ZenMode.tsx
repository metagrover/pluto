import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent } from '../../../electron/calendar/types';
import type { LiveConversationSnapshot } from '../../services/liveTranscription/liveConversationProjection';
import type { MeetingAskPlutoConversationMessage } from '../../types/askPluto';
import { LiveTranscript } from './LiveTranscript';
import { MeetingAskPlutoDock } from './MeetingAskPlutoDock';
import { RecordingCaptureBar } from './RecordingCaptureBar';
import { RecordingMeetingRail } from './RecordingMeetingRail';
import {
  type CaptureHealthState,
  type LiveTranscriptIntegrity,
  type LiveTranscriptSegment,
  buildRecordingWorkspaceModel,
} from './recordingWorkspaceModel';

interface ZenModeProps {
  isStarting: boolean;
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
  liveConversation?: LiveConversationSnapshot | null;
  interimText?: string;
  captureHealth: CaptureHealthState;
  liveTranscriptIntegrity: LiveTranscriptIntegrity;
  recordingStartedAtMs: number | null;
  calendarEvent?: CalendarEvent | null;
  askPlutoConversation?: MeetingAskPlutoConversationMessage[];
  setAskPlutoConversation?: React.Dispatch<
    React.SetStateAction<MeetingAskPlutoConversationMessage[]>
  >;
  askPlutoMinimized?: boolean;
  setAskPlutoMinimized?: (isMinimized: boolean) => void;
}

export const ZenMode = ({
  isStarting,
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
  liveConversation = null,
  interimText = '',
  captureHealth,
  liveTranscriptIntegrity,
  recordingStartedAtMs,
  calendarEvent = null,
  askPlutoConversation,
  setAskPlutoConversation,
  askPlutoMinimized,
  setAskPlutoMinimized,
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
        isStarting,
        isProcessing,
        microphone: captureHealth.microphone,
        systemAudio: captureHealth.systemAudio,
        captureDurability: captureHealth.captureDurability,
        liveTranscriptIntegrity,
        segments: liveTranscript,
        interimText,
        liveConversation,
      }),
    [
      captureHealth,
      interimText,
      isStarting,
      isProcessing,
      liveTranscript,
      liveConversation,
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
          calendarEvent={calendarEvent}
        />
        <LiveTranscript
          segments={model.transcript}
          interimText={model.interimText}
          integrity={liveTranscriptIntegrity}
          conversation={model.liveConversation}
        />
        <MeetingAskPlutoDock
          conversation={askPlutoConversation}
          onConversationChange={setAskPlutoConversation}
          isMinimized={askPlutoMinimized}
          onMinimizedChange={setAskPlutoMinimized}
          liveContext={{
            title: meetingTitle,
            participants: meetingParticipants,
            notes: currentNotes,
            transcript: liveTranscript,
            interimText,
          }}
        />
      </div>
    </main>
  );
};
