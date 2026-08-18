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
    <div className="max-w-3xl mx-auto pb-24 pt-6 font-sans">
      {/* Overview Section */}
      <div className="mb-12">
        <p className="text-[19px] md:text-[21px] font-normal leading-[1.7] text-pro-text-main/90 tracking-[-0.01em]">
          {highlightEntities(doc.overview)}
        </p>
      </div>

      {/* Continuity */}
      {valueSignals?.continuity && valueSignals.continuity.length > 0 && (
        <div className="mb-16 bg-stone-50/80 dark:bg-stone-900/40 border border-stone-200/50 dark:border-stone-800/50 rounded-2xl p-6">
          <h3 className="text-[12px] font-bold uppercase tracking-[0.15em] text-stone-500 mb-4 flex items-center gap-2">
            <LinkIcon size={14} className="text-stone-400" />
            Previous Context
          </h3>
          <ul className="space-y-3">
            {valueSignals.continuity.map((link) => (
              <li
                key={link}
                className="text-[15px] leading-relaxed text-stone-700 dark:text-stone-300 pl-5 relative"
              >
                <span className="absolute left-0 top-[0.6em] w-1.5 h-1.5 rounded-full bg-stone-300 dark:bg-stone-600" />
                {highlightEntities(link)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Topics */}
      <div className="space-y-12">
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

      {/* Action Items */}
      {doc.all_action_items.length > 0 && (
        <div className="mt-20 pt-16 border-t border-stone-200 dark:border-stone-800">
          <h2 className="text-[24px] font-bold text-pro-text-main tracking-tight mb-8">
            Action Items
          </h2>
          <div className="flex flex-col gap-4">
            {doc.all_action_items.map((item, i) => (
              <ActionItemCard
                key={`global-action-${item.text}-${item.assignee ?? 'none'}-${item.due ?? 'none'}`}
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
    <div className="group">
      {/* Topic Header */}
      <div className="mb-5">
        <h2 className="text-[22px] md:text-[26px] font-semibold tracking-tight text-pro-text-main flex items-baseline gap-3 mb-2">
          {topic.title}
          {topic.transcript_range && (
            <span className="text-[13px] font-medium text-stone-400 dark:text-stone-500 tracking-wide tabular-nums">
              {formatTime(topic.transcript_range[0])} -{' '}
              {formatTime(topic.transcript_range[1])}
            </span>
          )}
        </h2>
        {topic.summary && (
          <p className="text-[16px] leading-[1.65] font-normal text-stone-600 dark:text-stone-400">
            {highlightEntities(topic.summary)}
          </p>
        )}
      </div>

      {/* Key Points */}
      {topic.key_points.length > 0 && (
        <div className="space-y-3 mb-8">
          {topic.key_points.map((point, kpi) => (
            <EditableItem
              key={`${point.text}-${point.speaker ?? 'unknown'}`}
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

      {/* Decisions & Questions */}
      {(topic.decisions.length > 0 || topic.open_questions.length > 0) && (
        <div className="space-y-2 mt-4">
          {topic.decisions.map((decision, di) => (
            <EditableItem
              key={`${decision.text}-${decision.decided_by ?? 'unknown'}`}
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

          {topic.open_questions.map((q) => (
            <div
              key={q}
              className="group relative flex gap-3 pl-2 py-1.5 transition-colors"
            >
              <div className="flex-1">
                <p className="text-[15px] leading-[1.65] font-normal text-pro-text-main/90">
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-amber-100/50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-500 mr-2.5 align-text-bottom">
                    Question
                  </span>
                  {highlightEntities(q)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
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
      <div className="flex gap-3 items-start w-full -ml-3 p-3 rounded-xl bg-stone-50/80 dark:bg-stone-900/50 shadow-sm ring-1 ring-black/5 dark:ring-white/10 transition-all">
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="flex-1 min-h-[60px] text-[16px] leading-[1.65] bg-transparent border-none outline-none resize-none text-pro-text-main p-0 focus:ring-0"
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
        <div className="flex gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="p-1.5 rounded-md text-pro-accent hover:bg-pro-accent/10 transition-colors"
          >
            <Check size={16} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            disabled={isSaving}
            className="p-1.5 rounded-md text-pro-text-muted hover:bg-stone-200/50 dark:hover:bg-stone-800 transition-colors"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    );
  }

  if (type === 'decision') {
    return (
      <div className="group relative flex gap-3 pl-2 py-1.5 transition-colors">
        <div className="flex-1">
          <p className="text-[15px] leading-[1.65] font-normal text-pro-text-main/90 pr-12 inline-block">
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-indigo-50/80 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 mr-2.5 align-text-bottom">
              Decision
            </span>
            {highlightEntities(currentText)}
            {(decidedBy || fromUserNotes) && (
              <span className="ml-2 text-[12px] font-medium text-stone-500 inline-flex items-center gap-1 before:content-['•'] before:mr-1 before:text-stone-300 dark:before:text-stone-700">
                {decidedBy}
              </span>
            )}
            {hasEdit && (
              <span
                className="ml-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-indigo-500/80"
                title="Edited by you"
              >
                <Pencil size={8} /> Edited
              </span>
            )}
          </p>
        </div>
        <div className="absolute right-0 top-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          {hasEdit && (
            <button
              type="button"
              onClick={handleRevert}
              className="p-1.5 rounded-md text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-red-500 transition-colors"
            >
              <Undo size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="p-1.5 rounded-md text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-indigo-500 transition-colors"
          >
            <Pencil size={14} />
          </button>
        </div>
      </div>
    );
  }

  // Standard Point
  return (
    <div className="group relative flex gap-3 items-start transition-colors">
      <span className="mt-[0.6em] w-1.5 h-1.5 shrink-0 rounded-full bg-stone-300 dark:bg-stone-600" />
      <div className="flex-1">
        <p className="text-[15px] leading-[1.65] font-normal text-pro-text-main/90 pr-12 inline-block">
          {highlightEntities(currentText)}
          {(speaker || fromUserNotes) && (
            <span className="ml-2 text-[12px] font-medium text-stone-500 inline-flex items-center gap-1 before:content-['•'] before:mr-1 before:text-stone-300 dark:before:text-stone-700">
              {speaker}
              {fromUserNotes && (
                <span className="ml-1 text-[9px] font-bold text-amber-600/60 uppercase tracking-widest bg-amber-50/50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-md">
                  From notes
                </span>
              )}
            </span>
          )}
          {hasEdit && (
            <span
              className="ml-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-pro-text-muted/50"
              title="Edited by you"
            >
              <Pencil size={8} /> Edited
            </span>
          )}
        </p>
      </div>

      <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 h-6">
        {hasEdit && (
          <button
            type="button"
            onClick={handleRevert}
            className="p-1.5 rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-500 transition-colors"
            title="Revert to original"
          >
            <Undo size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="p-1.5 rounded-md text-stone-400 hover:bg-stone-100 hover:text-pro-accent transition-colors"
          title="Edit point"
        >
          <Pencil size={14} />
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
    <div className="group flex gap-4 items-start p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-pro-bg shadow-sm hover:shadow-md hover:border-stone-300 dark:hover:border-stone-700 transition-all">
      <div className="w-[18px] h-[18px] rounded-[4px] border-2 border-stone-300 dark:border-stone-600 flex items-center justify-center shrink-0 mt-[3px] group-hover:border-stone-400 transition-colors">
        {/* Unchecked state for pure read-only look, user can't actually check it here but it implies action */}
      </div>
      <div className="flex-1">
        <p className="text-[16px] leading-[1.6] font-medium text-pro-text-main/90">
          {highlightEntities(currentText)}
          {hasEdit && (
            <span
              className="ml-2 inline-block text-stone-400"
              title="Edited by you"
            >
              <Pencil size={10} />
            </span>
          )}
        </p>

        {(item.assignee || item.due || item.topic) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
            {item.assignee && (
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-stone-500">
                <UserCircle size={14} className="text-stone-400" />{' '}
                {item.assignee}
              </span>
            )}
            {item.due && (
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-rose-500">
                <Calendar size={14} className="text-rose-400" /> {item.due}
              </span>
            )}
            {item.topic && (
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-stone-400 max-w-[200px] truncate">
                <Hash size={14} className="text-stone-300" /> {item.topic}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};
