import { ArrowLeft, CircleStop, Mic, MonitorSpeaker } from 'lucide-react';
import { WindowDragRegion } from '../layout/WindowDragRegion';
import type {
  CaptureHealth,
  LiveTranscriptIntegrity,
} from './recordingWorkspaceModel';

type Props = {
  status: 'starting' | 'recording' | 'processing';
  elapsedLabel: string;
  statusMessage: string;
  microphone: CaptureHealth;
  systemAudio: CaptureHealth;
  liveTranscriptIntegrity: LiveTranscriptIntegrity;
  onBackHome?: () => void;
  onFinish: () => void;
};

const Health = ({
  icon: Icon,
  label,
  state,
}: { icon: typeof Mic; label: string; state: CaptureHealth }) => (
  <span className={`recording-health recording-health--${state}`}>
    <Icon aria-hidden="true" size={14} />
    <span>{label}</span>
    <span className="sr-only">: {state}</span>
  </span>
);

export const RecordingCaptureBar = ({
  status,
  elapsedLabel,
  statusMessage,
  microphone,
  systemAudio,
  liveTranscriptIntegrity,
  onBackHome,
  onFinish,
}: Props) => (
  <header className="recording-capture-bar">
    <WindowDragRegion className="absolute inset-x-0 top-0 h-10" />
    <div
      className="recording-status no-drag"
      aria-live={liveTranscriptIntegrity === 'lagging' ? 'assertive' : 'polite'}
    >
      {onBackHome && (
        <button
          type="button"
          className="recording-back-home no-drag"
          onClick={onBackHome}
          aria-label="Back home"
          title="Back home"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          <span className="sr-only">Back home</span>
        </button>
      )}
      <span
        className={`recording-dot recording-dot--${status}`}
        aria-hidden="true"
      />
      <strong>
        {status === 'starting'
          ? 'Starting recording'
          : status === 'processing'
            ? 'Preparing meeting'
            : 'Recording'}
      </strong>
      <time>{elapsedLabel}</time>
      <span className="recording-status-message">{statusMessage}</span>
    </div>
    <WindowDragRegion className="recording-capture-drag" />
    <div className="recording-actions no-drag">
      <Health icon={Mic} label="Microphone" state={microphone} />
      <Health icon={MonitorSpeaker} label="System audio" state={systemAudio} />
      <button
        type="button"
        className="recording-finish"
        onClick={onFinish}
        disabled={status !== 'recording'}
      >
        <CircleStop aria-hidden="true" size={16} />
        {status === 'starting'
          ? 'Starting'
          : status === 'processing'
            ? 'Processing'
            : 'Finish recording'}
      </button>
    </div>
  </header>
);
