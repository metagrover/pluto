import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
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

interface Draft {
  id: string;
  title: string;
  content: string;
  icon: React.ReactNode;
}

export const FollowUpDrafts: React.FC<FollowUpDraftsProps> = ({
  meetingId,
  meetingTitle,
  actionItems,
  decisions,
}) => {
  const [participants, setParticipants] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({});
  const [customPrompt, setCustomPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    const fetchParticipants = async () => {
      try {
        const entities = await getMeetingEntities(String(meetingId));
        const people = entities
          .filter((e) => e.type === 'person')
          .map((e) => e.name);
        setParticipants(people);
      } catch (error) {
        console.error('Failed to fetch participants for follow-ups:', error);
      }
    };
    fetchParticipants();
  }, [meetingId]);

  const generateDefaultDrafts = useCallback(() => {
    const participantList =
      participants.length > 0 ? participants.join(', ') : 'Team';
    const actionList =
      actionItems.length > 0
        ? actionItems.map((item) => `- ${item}`).join('\n')
        : '- No specific action items';
    const decisionList =
      decisions.length > 0
        ? decisions.map((item) => `- ${item}`).join('\n')
        : '- No specific decisions recorded';

    const clientEmail = `Subject: Recap: ${meetingTitle}\n\nHi ${participantList},\n\nThank you for the productive discussion today regarding ${meetingTitle}.\n\nKey Decisions:\n${decisionList}\n\nNext Steps:\n${actionList}\n\nPlease let me know if I missed anything.\n\nBest regards,\n[Your Name]`;

    const internalEmail = `Subject: Internal Notes: ${meetingTitle}\n\nTeam,\n\nHere's a quick summary from our session on ${meetingTitle}:\n\nParticipants: ${participantList}\n\nSummary of Decisions:\n${decisionList}\n\nAction Items:\n${actionList}\n\nLet's keep the momentum going.`;

    const slackUpdate = `*Recap: ${meetingTitle}*\n\nGood session today! Here's what we landed on:\n\n*Decisions:*\n${decisionList}\n\n*Action Items:*\n${actionList}`;

    setDrafts([
      {
        id: 'client-email',
        title: 'Client Recap Email',
        content: clientEmail,
        icon: <Mail className="w-4 h-4" />,
      },
      {
        id: 'internal-email',
        title: 'Internal Summary',
        content: internalEmail,
        icon: <Send className="w-4 h-4" />,
      },
      {
        id: 'slack-update',
        title: 'Slack Update',
        content: slackUpdate,
        icon: <MessageSquare className="w-4 h-4" />,
      },
    ]);
  }, [participants, meetingTitle, actionItems, decisions]);

  useEffect(() => {
    generateDefaultDrafts();
  }, [generateDefaultDrafts]);

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopyStatus({ ...copyStatus, [id]: true });
    setTimeout(() => {
      setCopyStatus((prev) => ({ ...prev, [id]: false }));
    }, 2000);
  };

  const handleDraftChange = (id: string, newContent: string) => {
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, content: newContent } : d)),
    );
  };

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      // Use IPC to call LLM if available, otherwise just use default
      const result = await window.ipcRenderer.invoke('GENERATE_FOLLOW_UPS', {
        meetingTitle,
        participants,
        actionItems,
        decisions,
        customPrompt: customPrompt.trim() || undefined,
      });

      if (result && Array.isArray(result.drafts)) {
        setDrafts(
          result.drafts.map(
            (d: { title: string; content: string }, i: number) => ({
              id: drafts[i]?.id || `draft-${i}`,
              title: d.title || drafts[i]?.title || 'Draft',
              content: d.content,
              icon: drafts[i]?.icon || <Sparkles className="w-4 h-4" />,
            }),
          ),
        );
      } else {
        generateDefaultDrafts();
      }
    } catch (error) {
      console.error('Failed to regenerate follow-ups:', error);
      // Fallback to default on error
      generateDefaultDrafts();
    } finally {
      setLoading(false);
    }
  };

  if (actionItems.length === 0 && decisions.length === 0 && !loading) {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
          Follow-up Drafts
        </h2>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 hover:bg-pro-surface rounded-md transition-colors text-pro-text-muted"
        >
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {drafts.map((draft) => (
              <div key={draft.id} className="flex flex-col space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2 text-pro-accent">
                    {draft.icon}
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      {draft.title}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(draft.id, draft.content)}
                    className={`p-1.5 rounded-lg transition-all duration-300 ${
                      copyStatus[draft.id]
                        ? 'bg-green-500 text-white'
                        : 'hover:bg-pro-surface text-pro-text-muted hover:text-pro-text-main'
                    }`}
                  >
                    {copyStatus[draft.id] ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <textarea
                  value={draft.content}
                  onChange={(e) => handleDraftChange(draft.id, e.target.value)}
                  className="flex-1 min-h-[200px] p-4 rounded-2xl bg-pro-surface border border-pro-border/40 text-[13px] leading-relaxed text-pro-text-main/80 focus:border-pro-accent/40 outline-none transition-all resize-none shadow-sm"
                />
              </div>
            ))}
          </div>

          <div className="p-6 rounded-[2rem] bg-pro-accent/5 border border-pro-accent/10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-pro-accent" />
                <span className="text-[10px] font-black text-pro-accent uppercase tracking-widest">
                  Agentic Refinement
                </span>
              </div>
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-pro-text-main text-white dark:bg-pro-accent dark:text-[#1A2340] text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 active-push"
              >
                {loading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                {loading ? 'Refining...' : 'Regenerate via AI'}
              </button>
            </div>
            <input
              type="text"
              placeholder="e.g., 'Make it more formal', 'Focus on the timeline', 'Shorten for Slack'..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              className="w-full bg-pro-bg border border-pro-border/40 rounded-xl px-4 py-3 text-xs font-medium text-pro-text-main placeholder:text-pro-text-muted/30 focus:border-pro-accent/40 outline-none transition-all"
            />
          </div>
        </div>
      )}
    </div>
  );
};
