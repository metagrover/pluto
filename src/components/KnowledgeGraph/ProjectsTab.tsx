import type React from 'react';
import { useEffect, useState } from 'react';
import { type Entity, getEntitiesByType } from '../../api/knowledgeGraph';

export const ProjectsTab: React.FC = () => {
  const [projects, setProjects] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      setLoading(true);
      try {
        const data = await getEntitiesByType('project');
        setProjects(data);
      } catch (error) {
        console.error('Failed to fetch projects:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-pro-bg rounded-[2.5rem]" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="text-4xl">📁</div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-pro-text-main">
            No Projects Yet
          </h3>
          <p className="text-sm text-pro-text-muted">
            Active work streams and project names will be automatically
            extracted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8">
      {projects.map((project) => (
        <div
          key={project.id}
          className="p-8 bg-white border border-pro-border rounded-[2.5rem] shadow-sm hover:shadow-premium transition-all overflow-hidden relative group"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-pro-accent/5 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none group-hover:bg-pro-accent/10 transition-colors" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-4 flex-1">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-pro-bg flex items-center justify-center text-lg">
                  📁
                </div>
                <div className="text-[10px] font-black text-pro-accent uppercase tracking-[0.2em]">
                  Work Stream
                </div>
              </div>
              <h3 className="text-2xl font-black text-pro-text-main">
                {project.name}
              </h3>
              <p className="text-[14px] text-pro-text-muted font-medium max-w-xl leading-relaxed">
                {JSON.parse(project.metadata || '{}').context ||
                  'No description available for this work stream.'}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                className="px-6 py-2.5 rounded-xl bg-pro-text-main text-white text-[11px] font-black uppercase tracking-widest hover:bg-pro-accent transition-all active-push shadow-lg"
              >
                View Workspace
              </button>
              <button
                type="button"
                className="w-11 h-11 rounded-xl bg-pro-bg flex items-center justify-center hover:bg-white border border-transparent hover:border-pro-border transition-all"
              >
                ⚙️
              </button>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t border-pro-border/40 flex flex-wrap gap-8">
            <div className="space-y-1">
              <p className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest leading-none">
                Status
              </p>
              <p className="text-xs font-bold text-green-500 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Active
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest leading-none">
                Activity
              </p>
              <p className="text-xs font-bold text-pro-text-main">
                3 Meetings this week
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest leading-none">
                Last Discussed
              </p>
              <p className="text-xs font-bold text-pro-text-muted">
                Today at 2:30 PM
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
