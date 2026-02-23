import type React from 'react';
import { useEffect, useState } from 'react';
import {
  type Entity,
  getEntitiesByType,
  updateEntityStatus,
} from '../../api/knowledgeGraph';

export const TasksTab: React.FC = () => {
  const [tasks, setTasks] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const data = await getEntitiesByType('action_item');
      // Sort: active first, then by date
      const sorted = [...data].sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });
      setTasks(sorted);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleTask = async (task: Entity) => {
    const newStatus = task.status === 'active' ? 'completed' : 'active';
    try {
      await updateEntityStatus(task.id, newStatus);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t)),
      );
    } catch (error) {
      console.error('Failed to update task status:', error);
    }
  };

  if (loading && tasks.length === 0) {
    return (
      <div className="animate-pulse space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 bg-pro-bg rounded-2xl" />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="text-4xl">✅</div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-pro-text-main">Clean Slate</h3>
          <p className="text-sm text-pro-text-muted">
            No action items found in your meetings yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] mb-1">
            Accountability Engine
          </h3>
          <p className="text-sm font-medium text-pro-text-muted">
            Tracking {tasks.filter((t) => t.status === 'active').length} active
            commitments
          </p>
        </div>
        <button
          type="button"
          className="h-10 px-6 rounded-xl bg-pro-bg border border-pro-border text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all"
        >
          Sync Linear
        </button>
      </div>

      <div className="space-y-4">
        {tasks.map((task) => {
          const metadata = JSON.parse(task.metadata || '{}');
          const isCompleted = task.status === 'completed';

          return (
            <div
              key={task.id}
              className={`
                group p-5 rounded-2xl border transition-all flex items-start gap-5
                ${isCompleted ? 'bg-pro-bg/30 border-pro-border/40 grayscale-[0.8] opacity-60' : 'bg-white border-pro-border shadow-sm hover:shadow-md hover:border-pro-accent/20'}
              `}
            >
              <button
                type="button"
                onClick={() => toggleTask(task)}
                className={`
                  mt-1 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all shrink-0
                  ${isCompleted ? 'bg-pro-accent border-pro-accent text-white' : 'border-pro-border group-hover:border-pro-accent/40 bg-white'}
                `}
              >
                {isCompleted && (
                  <svg
                    aria-hidden="true"
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>

              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <h4
                    className={`text-[15px] font-bold tracking-tight leading-snug ${isCompleted ? 'line-through text-pro-text-muted' : 'text-pro-text-main'}`}
                  >
                    {metadata.full_description || task.name}
                  </h4>
                  {task.due_date && (
                    <span
                      className={
                        'text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded bg-stone-100 text-stone-500 shrink-0'
                      }
                    >
                      Due{' '}
                      {new Date(task.due_date).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-6">
                  {metadata.assignee_name && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-pro-text-muted/40 uppercase font-black tracking-widest">
                        Assignee
                      </span>
                      <span className="text-[11px] font-bold text-pro-accent">
                        {metadata.assignee_name}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-pro-text-muted/40 uppercase font-black tracking-widest">
                      Origin
                    </span>
                    <span className="text-[11px] font-bold text-pro-text-muted hover:text-pro-text-main cursor-pointer transition-colors">
                      Meeting Archive
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
