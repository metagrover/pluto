import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent } from '../../../electron/calendar/types';
import {
  type LiveConversationSnapshot,
  liveConversationTranscriptSegments,
} from '../../services/liveTranscription/liveConversationProjection';
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
  onOpenMeeting?: (id: string) => void;
  askPlutoConversation?: MeetingAskPlutoConversationMessage[];
  setAskPlutoConversation?: React.Dispatch<
    React.SetStateAction<MeetingAskPlutoConversationMessage[]>
  >;
  askPlutoMinimized?: boolean;
  setAskPlutoMinimized?: (isMinimized: boolean) => void;
  onOpenSettings?: (
    tab?: 'personal' | 'meetings' | 'intelligence' | 'advanced',
  ) => void;
}

export const ZenMode = ({
  isStarting,
  isProcessing,
  onEndMeeting,
  onBackHome,
  onOpenSettings,
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
      onOpenMeeting,
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
  const addParticipant = (name?: string) => {
    const participant = (
      typeof name === 'string' ? name : participantInput
    ).trim();
    if (!participant) return;
    setMeetingParticipants((previous) =>
      previous.some((p) => p.trim().toLowerCase() === participant.toLowerCase())
        ? previous
        : [...previous, participant],
    );
    setParticipantInput('');
  };
  const askPlutoTranscript = model.liveConversation
    ? liveConversationTranscriptSegments(model.liveConversation)
    : liveTranscript;
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
          onOpenMeeting={onOpenMeeting}
        />
        <LiveTranscript
          segments={model.transcript}
          interimText={model.interimText}
          integrity={liveTranscriptIntegrity}
          conversation={model.liveConversation}
          onOpenSettings={onOpenSettings}
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
            transcript: askPlutoTranscript,
            interimText,
          }}
        />
      </div>
    </main>
  );
};
