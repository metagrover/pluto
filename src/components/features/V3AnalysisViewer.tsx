import {
  Calendar,
  Check,
  Hash,
  Link as LinkIcon,
  Pencil,
  Undo,
  UserCircle,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { ValueGainSignals } from '../../api/knowledgeGraph';
import type {
  ActionItemV3,
  AnalysisDocumentV3,
  TopicSection,
  UserEditsMap,
} from '../../types';
import { applyUserEdit } from '../../utils/analysisDocument';

interface V3AnalysisViewerProps {
  meetingId: string | number;
  doc: AnalysisDocumentV3;
  editsMap: UserEditsMap;
  valueSignals?: ValueGainSignals | null;
  highlightEntities: (text: string) => ReactNode;
  onEditSaved: () => void; // Trigger a refetch or state update in parent
}

export const V3AnalysisViewer = ({
  meetingId,
  doc,
  editsMap,
  valueSignals,
  highlightEntities,
  onEditSaved,
}: V3AnalysisViewerProps) => {
  return (
    <div className="space-y-12">
      <div className="bg-pro-surface/40 backdrop-blur-sm p-8 rounded-[2rem] border border-pro-border/40 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Hash className="w-48 h-48" />
        </div>
        <div className="space-y-4 relative z-10">
          <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
            Overview
          </h2>
          <div className="text-xl font-medium leading-[1.6] text-pro-text-main/90">
            {highlightEntities(doc.overview)}
          </div>
        </div>
      </div>

      <div className="space-y-10 pl-2 lg:pl-4 border-l-2 border-pro-border/30">
        {doc.topics.map((topic, i) => (
          <TopicCard
            key={`${i}-${topic.title}`}
            topic={topic}
            index={i}
            meetingId={meetingId}
            editsMap={editsMap}
            highlightEntities={highlightEntities}
            onEditSaved={onEditSaved}
          />
        ))}
      </div>

      {valueSignals?.continuity && valueSignals.continuity.length > 0 && (
        <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200/50 dark:border-blue-800/30 rounded-2xl p-6 mb-8 translate-x-2">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600/80 mb-3 flex items-center gap-2">
            <LinkIcon size={12} className="text-blue-500" />
            Cross-Meeting Continuity
          </h3>
          <ul className="space-y-2">
            {valueSignals.continuity.map((link, j) => (
              <li
                key={j}
                className="text-sm font-medium text-blue-900/80 dark:text-blue-200/80 pl-4 relative"
              >
                <span className="absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
                {highlightEntities(link)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {doc.all_action_items.length > 0 && (
        <div className="pt-8 mt-12 border-t border-pro-border/30 space-y-6">
          <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
            Global Action Items
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {doc.all_action_items.map((item, i) => (
              <ActionItemCard
                key={`global-action-${i}`}
                item={item}
                path={`all_action_items:${i}`}
                editsMap={editsMap}
                highlightEntities={highlightEntities}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Subcomponents ---

const TopicCard = ({
  topic,
  index,
  meetingId,
  editsMap,
  highlightEntities,
  onEditSaved,
}: {
  topic: TopicSection;
  index: number;
  meetingId: string | number;
  editsMap: UserEditsMap;
  highlightEntities: (text: string) => ReactNode;
  onEditSaved: () => void;
}) => {
  return (
    <div className="relative group">
      <div className="absolute -left-[27px] lg:-left-[35px] top-2 w-4 h-4 rounded-full bg-pro-bg border-[3px] border-pro-accent/40 group-hover:border-pro-accent transition-colors shadow-[0_0_10px_rgba(var(--pro-accent-rgb),0.3)]" />

      <div className="space-y-6 bg-pro-bg md:bg-pro-surface/20 p-6 md:p-8 rounded-[2rem] border border-transparent md:border-pro-border/30 transition-all hover:bg-pro-surface/40">
        <div className="space-y-2">
          <h3 className="text-2xl font-black tracking-tight text-pro-text-main flex items-center gap-3">
            {topic.title}
            {topic.transcript_range && (
              <span className="text-[9px] font-bold text-pro-text-muted/40 tracking-widest bg-pro-text-muted/5 px-2 py-1 rounded-md uppercase">
                {formatTime(topic.transcript_range[0])} -{' '}
                {formatTime(topic.transcript_range[1])}
              </span>
            )}
          </h3>
          {topic.summary && (
            <p className="text-[13px] font-medium text-pro-text-muted/80 leading-relaxed">
              {highlightEntities(topic.summary)}
            </p>
          )}
        </div>

        {topic.key_points.length > 0 && (
          <div className="space-y-3">
            {topic.key_points.map((point, kpi) => (
              <EditableItem
                key={kpi}
                path={`topic:${index}:point:${kpi}`}
                originalText={point.text}
                meetingId={meetingId}
                editsMap={editsMap}
                highlightEntities={highlightEntities}
                onEditSaved={onEditSaved}
                type="point"
                speaker={point.speaker}
                fromUserNotes={point.from_user_notes}
              />
            ))}
          </div>
        )}

        {topic.decisions.length > 0 && (
          <div className="space-y-3 mt-6 p-5 rounded-2xl bg-indigo-50/30 dark:bg-indigo-950/10 border border-indigo-100/50 dark:border-indigo-900/30">
            <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-indigo-500/80 mb-4 pb-2 border-b border-indigo-500/10">
              Decisions Made
            </h4>
            {topic.decisions.map((decision, di) => (
              <EditableItem
                key={di}
                path={`topic:${index}:decision:${di}`}
                originalText={decision.text}
                meetingId={meetingId}
                editsMap={editsMap}
                highlightEntities={highlightEntities}
                onEditSaved={onEditSaved}
                type="decision"
                decidedBy={decision.decided_by}
              />
            ))}
          </div>
        )}

        {topic.open_questions.length > 0 && (
          <div className="space-y-2 mt-4">
            <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-500/80 mb-3">
              Open Questions
            </h4>
            {topic.open_questions.map((q, qi) => (
              <div
                key={qi}
                className="text-sm font-medium text-amber-700/80 dark:text-amber-300/80 flex gap-3 items-start"
              >
                <span className="shrink-0 mt-0.5 text-amber-500">?</span>
                <p>{highlightEntities(q)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const EditableItem = ({
  path,
  originalText,
  meetingId,
  editsMap,
  highlightEntities,
  onEditSaved,
  type,
  speaker,
  fromUserNotes,
  decidedBy,
}: {
  path: string;
  originalText: string;
  meetingId: string | number;
  editsMap: UserEditsMap;
  highlightEntities: (text: string) => ReactNode;
  onEditSaved: () => void;
  type: 'point' | 'decision';
  speaker?: string;
  fromUserNotes?: boolean;
  decidedBy?: string;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const currentText = applyUserEdit(originalText, path, editsMap);
  const [editValue, setEditValue] = useState(currentText);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasEdit = !!editsMap[path];

  useEffect(() => {
    if (isEditing) {
      setEditValue(currentText);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(
            currentText.length,
            currentText.length,
          );
        }
      }, 50);
    }
  }, [isEditing, currentText]);

  const handleSave = async () => {
    if (editValue.trim() === currentText) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      if (editValue.trim() === originalText && hasEdit) {
        // Reverting to original
        await window.ipcRenderer.invoke('REVERT_USER_EDIT', {
          meetingId,
          path,
        });
      } else {
        await window.ipcRenderer.invoke('SAVE_USER_EDIT', {
          meetingId,
          path,
          original: originalText,
          edited: editValue.trim(),
        });
      }
      onEditSaved();
      setIsEditing(false);
    } catch (e) {
      console.error('Failed to save edit', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevert = async () => {
    setIsSaving(true);
    try {
      await window.ipcRenderer.invoke('REVERT_USER_EDIT', { meetingId, path });
      onEditSaved();
      setIsEditing(false);
    } catch (e) {
      console.error('Failed to revert', e);
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex gap-2 items-start w-full bg-pro-bg border border-pro-accent/50 rounded-xl p-2 shadow-sm animate-in fade-in zoom-in-95 duration-200">
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="flex-1 min-h-[60px] text-sm bg-transparent border-none outline-none resize-none text-pro-text-main p-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            }
            if (e.key === 'Escape') {
              setIsEditing(false);
            }
          }}
          disabled={isSaving}
        />
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="p-1.5 rounded-lg bg-pro-accent text-white hover:bg-pro-accent/80 transition-colors"
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => setIsEditing(false)}
            disabled={isSaving}
            className="p-1.5 rounded-lg bg-stone-200 dark:bg-stone-800 text-pro-text-muted hover:text-pro-text-main transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-4 items-start relative pb-2 -ml-2 pl-2 rounded-xl hover:bg-pro-text-main/[0.02] transition-colors">
      <span
        className={`shrink-0 pt-0.5 ${type === 'decision' ? 'text-indigo-500 font-bold' : 'text-pro-accent'}`}
      >
        {type === 'decision' ? '↳' : '◆'}
      </span>
      <div className="flex-1 space-y-1">
        <p className="text-[14px] font-medium leading-relaxed text-pro-text-main/90 pr-12">
          {highlightEntities(currentText)}
          {hasEdit && (
            <span
              className="ml-2 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-pro-accent/50 group-hover:text-pro-accent/80 transition-colors"
              title="Edited by you"
            >
              <Pencil size={8} /> Edited
            </span>
          )}
        </p>
        {(speaker || decidedBy || fromUserNotes) && (
          <div className="flex flex-wrap items-center gap-3 mt-1">
            {speaker && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-pro-text-muted/60 uppercase tracking-widest">
                <UserCircle size={10} /> {speaker}
              </span>
            )}
            {decidedBy && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-500/60 uppercase tracking-widest bg-indigo-50/50 dark:bg-indigo-900/20 px-1.5 py-0.5 rounded-sm">
                Owner: {decidedBy}
              </span>
            )}
            {fromUserNotes && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600/60 uppercase tracking-widest bg-amber-50/50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-sm">
                From notes
              </span>
            )}
          </div>
        )}
      </div>

      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 h-6">
        {hasEdit && (
          <button
            onClick={handleRevert}
            className="p-1.5 rounded-md text-pro-text-muted hover:bg-stone-200 dark:hover:bg-stone-800 hover:text-red-500 transition-colors"
            title="Revert to original"
          >
            <Undo size={12} />
          </button>
        )}
        <button
          onClick={() => setIsEditing(true)}
          className="p-1.5 rounded-md text-pro-text-muted hover:bg-stone-200 dark:hover:bg-stone-800 hover:text-pro-accent transition-colors"
          title="Edit point"
        >
          <Pencil size={12} />
        </button>
      </div>
    </div>
  );
};

const ActionItemCard = ({
  item,
  path,
  editsMap,
  highlightEntities,
}: {
  item: ActionItemV3;
  path: string;
  editsMap: UserEditsMap;
  highlightEntities: (t: string) => ReactNode;
}) => {
  const currentText = applyUserEdit(item.text, path, editsMap);
  const hasEdit = !!editsMap[path];

  return (
    <div className="p-5 rounded-2xl bg-pro-surface border border-pro-border shadow-sm flex flex-col gap-3 group hover:border-pro-accent/30 transition-all">
      <div className="flex items-start gap-3">
        <div className="w-5 h-5 rounded border border-pro-border flex items-center justify-center shrink-0 mt-0.5 group-hover:border-pro-accent transition-colors bg-pro-bg shadow-inner">
          <Check className="w-3 h-3 text-pro-accent opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <p className="text-[14px] font-medium leading-relaxed text-pro-text-main/90 flex-1">
          {highlightEntities(currentText)}
        </p>
        {/* Simple edit button for action items, omitting inline textarea for brevity, we could reuse EditableItem if we want, but let's keep action items simple for now or implement full edit. Let's just use a tag indicating edit. */}
        {hasEdit && (
          <Pencil size={10} className="text-pro-accent/40 mt-1 shrink-0" />
        )}
      </div>

      {(item.assignee || item.due || item.topic) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 ml-8 border-t border-pro-border/40 pt-3">
          {item.assignee && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-pro-text-main/70 uppercase tracking-widest bg-pro-accent/10 px-2 py-1 rounded">
              <UserCircle size={10} className="text-pro-accent" />{' '}
              {item.assignee}
            </span>
          )}
          {item.due && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-rose-600/80 dark:text-rose-400/80 uppercase tracking-widest">
              <Calendar size={10} /> {item.due}
            </span>
          )}
          {item.topic && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-pro-text-muted/50 uppercase tracking-widest max-w-[120px] truncate">
              <Hash size={10} /> {item.topic}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};
