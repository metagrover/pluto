import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Mail,
  MessageSquare,
  Save,
  Send,
  Sparkles,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { Meeting } from '../../types';
import { type Drafts, buildDefaultDrafts } from './followUpDraftContext';

interface FollowUpDraftsProps {
  meeting: Meeting;
  overview: string[];
  actionItems: string[];
  decisions: string[];
  discussionPoints: string[];
  participants: string[];
  topicSummaries: string[];
  fetchMeetings: () => void;
}

const DRAFT_TYPES = [
  { id: 'client', title: 'Client Recap Email', icon: Mail },
  { id: 'internal', title: 'Internal Summary', icon: Send },
  { id: 'slack', title: 'Slack Update', icon: MessageSquare },
] as const;

const parseSavedDrafts = (value?: string): Drafts | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Drafts;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.error('Failed to parse saved follow-up drafts:', error);
    return null;
  }
};

export const FollowUpDrafts: React.FC<FollowUpDraftsProps> = ({
  meeting,
  overview,
  actionItems,
  decisions,
  discussionPoints,
  participants,
  topicSummaries,
  fetchMeetings,
}) => {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);

  const meetingTitle = meeting.title;
  const actionItemsKey = actionItems.join('\n');
  const decisionsKey = decisions.join('\n');
  const topicSummariesKey = topicSummaries.join('\n');
  const discussionPointsKey = discussionPoints.join('\n');
  const defaultDrafts = useMemo(
    () =>
      buildDefaultDrafts({
        actionItems: actionItemsKey ? actionItemsKey.split('\n') : [],
        decisions: decisionsKey ? decisionsKey.split('\n') : [],
        discussionPoints: discussionPointsKey
          ? discussionPointsKey.split('\n')
          : [],
        meetingTitle,
        overview,
        participants,
        topicSummaries: topicSummariesKey ? topicSummariesKey.split('\n') : [],
      }),
    [
      actionItemsKey,
      decisionsKey,
      discussionPointsKey,
      meetingTitle,
      overview,
      participants,
      topicSummariesKey,
    ],
  );

  useEffect(() => {
    setDrafts(parseSavedDrafts(meeting.follow_up_drafts_json) || defaultDrafts);
  }, [defaultDrafts, meeting.follow_up_drafts_json]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopyId(id);
    setTimeout(() => setCopyId(null), 2000);
  };

  const saveDrafts = async (updatedDrafts = drafts) => {
    setSaving(true);
    try {
      await window.ipcRenderer.invoke('SAVE_MEETING', {
        ...meeting,
        follow_up_drafts_json: JSON.stringify(updatedDrafts),
      });
      fetchMeetings();
    } catch (e) {
      console.error('Failed to save drafts:', e);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    setDrafts(defaultDrafts);
  };

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      const res = await window.ipcRenderer.invoke('GENERATE_FOLLOW_UPS', {
        meetingTitle,
        overview,
        participants,
        topicSummaries,
        actionItems,
        decisions,
        discussionPoints,
        customPrompt: customPrompt.trim() || undefined,
      });
      if (res?.drafts) {
        const nextDrafts: Drafts = {};
        res.drafts.forEach((d: { content: string }, i: number) => {
          const draftType = DRAFT_TYPES[i];
          if (draftType) nextDrafts[draftType.id] = d.content;
        });
        setDrafts(nextDrafts);
        await saveDrafts(nextDrafts);
      }
    } catch (e) {
      console.error(e);
      resetToDefaults();
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
        <div className="flex items-center gap-4">
          <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
            Follow-up Drafts
          </h2>
          {Object.keys(drafts).length > 0 && (
            <button
              type="button"
              onClick={() => saveDrafts()}
              disabled={saving}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-pro-accent/5 border border-pro-accent/10 text-[9px] font-black text-pro-accent uppercase tracking-widest hover:bg-pro-accent/10 transition-all disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Save size={10} />
              )}
              {saving ? 'Saving...' : 'Save Drafts'}
            </button>
          )}
        </div>
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
                    onClick={() => handleCopy(id, drafts[id] || '')}
                    className={`p-1 rounded-lg transition-all ${copyId === id ? 'bg-green-500 text-white' : 'text-pro-text-muted hover:text-pro-text-main'}`}
                  >
                    {copyId === id ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
                <textarea
                  value={drafts[id] || ''}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [id]: e.target.value,
                    }))
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
