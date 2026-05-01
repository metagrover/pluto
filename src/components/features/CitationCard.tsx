import type React from 'react';

export interface CitationChain {
  claim: string;
  meeting_id: string;
  meeting_title: string;
  entity_id?: string;
  evidence_span?: string;
  evidence_valid: boolean;
}

interface CitationCardProps {
  citation: CitationChain;
  isActive: boolean;
  onClick: () => void;
  onNavigateToMeeting: (meetingId: string) => void;
}

export const CitationCard: React.FC<CitationCardProps> = ({
  citation,
  isActive,
  onClick,
  onNavigateToMeeting,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-5 rounded-2xl border transition-all cursor-pointer group flex flex-col gap-4 ${
        isActive
          ? 'bg-pro-surface border-pro-accent/40 shadow-[0_8px_30px_rgba(0,0,0,0.12)] -translate-y-1'
          : 'bg-pro-surface/40 border-pro-border/40 hover:border-pro-border/80 hover:bg-pro-surface/80 selection-none'
      } text-left w-full`}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1 pr-4">
          <h4 className="text-[13px] font-bold text-pro-text-main leading-tight group-hover:text-pro-accent transition-colors">
            {citation.meeting_title}
          </h4>
          <span className="text-[10px] font-black uppercase tracking-widest text-pro-text-muted/60">
            Source Log
          </span>
        </div>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border shadow-sm shrink-0 ${
            citation.evidence_valid
              ? 'bg-[#10B981]/10 border-[#10B981]/20 text-[#10B981]'
              : 'bg-red-500/10 border-red-500/20 text-red-500'
          }`}
        >
          <div
            className={`w-1.5 h-1.5 rounded-full ${citation.evidence_valid ? 'bg-[#10B981] shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`}
          />
          <span className="text-[9px] font-black uppercase tracking-widest">
            {citation.evidence_valid ? 'Verified' : 'Flagged'}
          </span>
        </div>
      </div>

      {citation.evidence_span && (
        <blockquote className="text-[13px] text-pro-text-muted/80 italic border-l-[3px] border-pro-accent/40 pl-4 py-1 my-1">
          "{citation.evidence_span}"
        </blockquote>
      )}

      <div className="flex flex-col gap-3 pt-2 border-t border-pro-border/30">
        <div className="flex items-start gap-2">
          <span className="text-[10px] font-black text-pro-accent uppercase tracking-widest shrink-0 pt-0.5">
            Claim:
          </span>
          <span className="text-[11px] text-pro-text-muted font-medium bg-pro-bg/50 px-2.5 py-1 rounded-md line-clamp-2">
            {citation.claim}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigateToMeeting(citation.meeting_id);
          }}
          className="self-end text-[10px] font-black cursor-pointer uppercase tracking-widest text-pro-text-muted hover:text-pro-accent transition-colors flex items-center gap-1 group/btn"
        >
          Context{' '}
          <span className="group-hover/btn:translate-x-1 transition-transform">
            →
          </span>
        </button>
      </div>
    </button>
  );
};
