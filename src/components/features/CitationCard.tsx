import type React from 'react';
import { getTrustStatusMeta } from '../../utils/trustStatus';
import type { TrustStatus } from '../../utils/trustStatus';

export interface CitationChain {
  claim: string;
  meeting_id: string;
  meeting_title: string;
  source_type?: 'meeting' | 'artifact';
  source_id?: string;
  entity_id?: string;
  evidence_span?: string;
  evidence_valid: boolean;
  trust_status: TrustStatus;
  evidence_kind?:
    | 'overview'
    | 'section'
    | 'commitment'
    | 'note'
    | 'artifact'
    | 'transcript'
    | 'live';
  section_id?: string;
  section_heading?: string;
  timestamp_ms?: number;
  timestamp_end_ms?: number;
  source_revision?: string;
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
  const trustMeta = getTrustStatusMeta(citation.trust_status);
  const trustTone =
    trustMeta.tone === 'success'
      ? 'bg-[#10B981]/10 border-[#10B981]/20 text-[#10B981]'
      : trustMeta.tone === 'warning'
        ? 'bg-amber-500/10 border-amber-500/20 text-amber-600'
        : trustMeta.tone === 'accent'
          ? 'bg-pro-accent/10 border-pro-accent/20 text-pro-accent'
          : 'bg-red-500/10 border-red-500/20 text-red-500';
  const trustDot =
    trustMeta.tone === 'success'
      ? 'bg-[#10B981] shadow-lg'
      : trustMeta.tone === 'warning'
        ? 'bg-amber-500 shadow-lg'
        : trustMeta.tone === 'accent'
          ? 'bg-pro-accent shadow-lg'
          : 'bg-red-500 shadow-lg';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-4 rounded-2xl border transition-all cursor-pointer group flex flex-col gap-3 ${
        isActive
          ? 'bg-black/[0.04] dark:bg-white/[0.05] border-black/10 dark:border-white/10 shadow-sm'
          : 'bg-black/[0.02] dark:bg-white/[0.02] border-transparent hover:border-black/5 dark:hover:border-white/5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
      } text-left w-full`}
    >
      <div className="flex items-start justify-between w-full">
        <div className="flex flex-col gap-0.5 pr-3 overflow-hidden">
          <h4 className="text-[13px] font-semibold text-pro-text-main truncate group-hover:text-pro-accent transition-colors">
            {citation.meeting_title}
          </h4>
          <span className="text-[10px] text-pro-text-muted/60">Source Log</span>
        </div>

        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border shadow-[0_1px_2px_rgba(0,0,0,0.05)] shrink-0 ${trustTone}`}
          title={trustMeta.description}
        >
          <div className={`w-1.5 h-1.5 rounded-full ${trustDot}`} />
          <span className="text-[9px] font-semibold uppercase tracking-wide">
            {trustMeta.label}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-pro-text-muted/80 leading-relaxed">
        {trustMeta.description}
      </p>

      {citation.evidence_span && (
        <blockquote className="text-[12px] text-pro-text-muted italic border-l-[3px] border-pro-accent/40 pl-3 py-0.5">
          "{citation.evidence_span}"
        </blockquote>
      )}

      <div className="flex flex-col gap-2 pt-2 border-t border-black/5 dark:border-white/5">
        <div className="flex items-start gap-2">
          <span className="text-[10px] font-semibold text-pro-accent shrink-0 pt-0.5">
            Claim
          </span>
          <span className="text-[11px] text-pro-text-muted leading-relaxed line-clamp-2">
            {citation.claim}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigateToMeeting(citation.meeting_id);
          }}
          className="self-end text-[10px] font-semibold cursor-pointer text-pro-text-muted/70 hover:text-pro-accent transition-colors flex items-center gap-1 group/btn mt-1"
        >
          View Context
          <span className="group-hover/btn:translate-x-1 transition-transform">
            →
          </span>
        </button>
      </div>
    </button>
  );
};
