import { CircleStop, Mic, MonitorSpeaker } from 'lucide-react';
import type {
  CaptureHealth,
  LiveTranscriptIntegrity,
} from './recordingWorkspaceModel';

type Props = {
  status: 'recording' | 'processing';
  elapsedLabel: string;
  statusMessage: string;
  microphone: CaptureHealth;
  systemAudio: CaptureHealth;
  liveTranscriptIntegrity: LiveTranscriptIntegrity;
  title: string;
  onTitleChange: (title: string) => void;
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
  title,
  onTitleChange,
  onFinish,
}: Props) => (
  <header className="recording-capture-bar drag-region">
    <div
      className="recording-status no-drag"
      aria-live={liveTranscriptIntegrity === 'lagging' ? 'assertive' : 'polite'}
    >
      <span
        className={`recording-dot recording-dot--${status}`}
        aria-hidden="true"
      />
      <strong>
        {status === 'processing' ? 'Preparing meeting' : 'Recording'}
      </strong>
      <time>{elapsedLabel}</time>
      <span className="recording-status-message">{statusMessage}</span>
    </div>
    <label className="recording-title no-drag">
      <span className="sr-only">Meeting title</span>
      <input
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="Untitled meeting"
        disabled={status === 'processing'}
      />
    </label>
    <div className="recording-actions no-drag">
      <Health icon={Mic} label="Microphone" state={microphone} />
      <Health icon={MonitorSpeaker} label="System audio" state={systemAudio} />
      <button
        type="button"
        className="recording-finish"
        onClick={onFinish}
        disabled={status === 'processing'}
      >
        <CircleStop aria-hidden="true" size={16} />
        {status === 'processing' ? 'Processing' : 'Finish recording'}
      </button>
    </div>
  </header>
);
