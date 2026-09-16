import { Cloud, Cpu } from 'lucide-react';
import { useInferenceActivity } from '../../api/inferenceActivity';

export const InferenceActivityBadge = () => {
  const activity = useInferenceActivity();
  if (!activity) return null;
  const Icon = activity.location === 'local' ? Cpu : Cloud;
  return (
    <div
      className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-pro-border/80 bg-pro-bg/60 px-3 py-2 text-pro-text-main"
      role="status"
      aria-live="polite"
    >
      <Icon size={13} className="shrink-0 text-pro-accent" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium">
          Processing with {activity.model}
        </span>
        <span className="block text-[10px] text-pro-text-muted">
          {activity.location === 'local' ? 'Local' : 'Cloud'} ·{' '}
          {activity.provider}
        </span>
      </span>
    </div>
  );
};

export const InferenceActivityInline = ({ tasks }: { tasks: string[] }) => {
  const activity = useInferenceActivity(tasks);
  if (!activity) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-pro-border/70 px-2 py-1 text-[10px] text-pro-text-muted">
      {activity.location === 'local' ? <Cpu size={11} /> : <Cloud size={11} />}
      {activity.model} · {activity.location === 'local' ? 'Local' : 'Cloud'}
    </span>
  );
};
