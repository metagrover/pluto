import { Maximize2 } from 'lucide-react';

type VoiceActivity = 'idle' | 'active' | 'lagging';

type Props = {
  title: string;
  voiceActivity: VoiceActivity;
  onExpand: () => void;
};

const voiceActivityLabel: Record<VoiceActivity, string> = {
  idle: 'Voice input idle',
  active: 'Voice input active',
  lagging: 'Voice input lagging',
};

export const RecordingNamePopover = ({
  title,
  voiceActivity,
  onExpand,
}: Props) => {
  const displayTitle = title.trim() || 'Meeting';

  return (
    <div
      className="recording-name-popover no-drag"
      aria-label="Active recording"
      onClick={onExpand}
    >
      <span
        className={`recording-name-status-dot recording-name-status-dot--${voiceActivity}`}
        aria-label={voiceActivityLabel[voiceActivity]}
      />
      <span className="recording-name-field no-drag" title={displayTitle}>
        {displayTitle}
      </span>
      <button
        type="button"
        className="recording-name-expand no-drag"
        onClick={(event) => {
          event.stopPropagation();
          onExpand();
        }}
        aria-label="Expand note"
      >
        <Maximize2 aria-hidden="true" size={15} />
      </button>
    </div>
  );
};
