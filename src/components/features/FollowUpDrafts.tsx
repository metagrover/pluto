import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Mail,
  MessageSquare,
  Send,
  Sparkles,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { getMeetingEntities } from '../../api/knowledgeGraph';

interface FollowUpDraftsProps {
  meetingId: string | number;
  meetingTitle: string;
  actionItems: string[];
  decisions: string[];
}

const DRAFT_TYPES = [
  { id: 'client', title: 'Client Recap Email', icon: Mail },
  { id: 'internal', title: 'Internal Summary', icon: Send },
  { id: 'slack', title: 'Slack Update', icon: MessageSquare },
];

export const FollowUpDrafts: React.FC<FollowUpDraftsProps> = ({
  meetingId,
  meetingTitle,
  actionItems,
  decisions,
}) => {
  const [participants, setParticipants] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    getMeetingEntities(String(meetingId)).then((entities) =>
      setParticipants(
        entities.filter((e) => e.type === 'person').map((e) => e.name),
      ),
    );
    setDrafts({}); // Clear drafts when meeting changes to trigger regeneration
  }, [meetingId]);

  const generateDefaults = useCallback(() => {
    const people = participants.join(', ') || 'Team';
    const actions = actionItems.map((i) => `- ${i}`).join('\n') || '- None';
    const decs = decisions.map((i) => `- ${i}`).join('\n') || '- None';

    setDrafts({
      client: `Subject: Recap: ${meetingTitle}\n\nHi ${people},\n\nDecisions:\n${decs}\n\nNext Steps:\n${actions}`,
      internal: `Team, session on ${meetingTitle}:\n\nParticipants: ${people}\n\nDecisions:\n${decs}\n\nActions:\n${actions}`,
      slack: `*Recap: ${meetingTitle}*\n\n*Decisions:*\n${decs}\n\n*Action Items:*\n${actions}`,
    });
  }, [participants, meetingTitle, actionItems, decisions]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only generate defaults when there are no drafts or meeting changes, to avoid overwriting manual edits.
  useEffect(() => {
    if (Object.keys(drafts).length === 0) {
      generateDefaults();
    }
  }, [generateDefaults, meetingId]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopyId(id);
    setTimeout(() => setCopyId(null), 2000);
  };

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      const res = await window.ipcRenderer.invoke('GENERATE_FOLLOW_UPS', {
        meetingTitle,
        participants,
        actionItems,
        decisions,
        customPrompt: customPrompt.trim() || undefined,
      });
      if (res?.drafts) {
        const nextDrafts: Record<string, string> = {};
        res.drafts.forEach((d: { content: string }, i: number) => {
          nextDrafts[DRAFT_TYPES[i]?.id || `draft-${i}`] = d.content;
        });
        setDrafts(nextDrafts);
      }
    } catch (e) {
      console.error(e);
      generateDefaults();
    } finally {
      setLoading(false);
    }
  };

  if (!actionItems.length && !decisions.length && !loading) {
    return (
      <div className="p-8 border border-dashed border-pro-border/40 rounded-[2rem] bg-pro-surface/20 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-pro-bg flex items-center justify-center mx-auto text-pro-text-muted/30">
          <Sparkles className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold text-pro-text-main/60 uppercase tracking-widest">
            No follow-ups needed
          </p>
          <p className="text-xs text-pro-text-muted/50">
            Capture action items or decisions to generate follow-up drafts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
          Follow-up Drafts
        </h2>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 hover:bg-pro-surface rounded-md text-pro-text-muted"
        >
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {DRAFT_TYPES.map(({ id, title, icon: Icon }) => (
              <div key={id} className="flex flex-col space-y-2">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2 text-pro-accent">
                    <Icon size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      {title}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(id, drafts[id])}
                    className={`p-1 rounded-lg transition-all ${copyId === id ? 'bg-green-500 text-white' : 'text-pro-text-muted hover:text-pro-text-main'}`}
                  >
                    {copyId === id ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
                <textarea
                  value={drafts[id] || ''}
                  onChange={(e) =>
                    setDrafts({ ...drafts, [id]: e.target.value })
                  }
                  className="flex-1 min-h-[160px] p-3 rounded-xl bg-pro-surface border border-pro-border/40 text-[12px] leading-relaxed text-pro-text-main/80 focus:border-pro-accent/40 outline-none resize-none shadow-sm"
                />
              </div>
            ))}
          </div>

          <div className="p-4 rounded-2xl bg-pro-accent/5 border border-pro-accent/10 flex flex-col md:flex-row items-center gap-4">
            <input
              placeholder="Refine drafts: 'More formal', 'Shorten for Slack'..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="flex-1 bg-pro-bg border border-pro-border/40 rounded-xl px-4 py-2 text-xs text-pro-text-main focus:border-pro-accent/40 outline-none"
            />
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-pro-text-main text-white dark:bg-pro-accent dark:text-[#1A2340] text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              {loading ? 'Refining...' : 'Regenerate'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
