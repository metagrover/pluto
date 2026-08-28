import type React from 'react';

interface ProjectDossierProps {
  projectId: string;
  projectName?: string;
  onBack: () => void;
}

export const ProjectDossier: React.FC<ProjectDossierProps> = ({
  projectId: _projectId,
  projectName,
  onBack,
}) => {
  return (
    <div className="flex h-full w-full gap-8">
      {/* Main Column */}
      <div className="flex-1 space-y-8">
        <button
          type="button"
          onClick={onBack}
          className="text-pro-text-muted hover:text-pro-text-main"
        >
          ← Back
        </button>
        <h2 className="text-2xl font-semibold text-pro-text-main">
          {projectName || 'Loading project...'}
        </h2>

        <section>
          <h3 className="text-lg font-medium">Quick Overview</h3>
          <p className="text-pro-text-muted">Loading overview...</p>
        </section>

        <section>
          <h3 className="text-lg font-medium">Status Update</h3>
          <p className="text-pro-text-muted">Loading status...</p>
        </section>
      </div>

      {/* Right Sidebar */}
      <div className="w-80 border-l border-pro-border/30 pl-8 space-y-8">
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-pro-text-muted">
            Pluto's Insights
          </h3>
          <p className="text-pro-text-main mt-4">No insights generated yet.</p>
        </section>
      </div>
    </div>
  );
};
