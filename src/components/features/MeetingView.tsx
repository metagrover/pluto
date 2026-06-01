import {
  BarChart3,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { getMeetingAlerts, updateAlertStatus } from '../../api/intelligence';
import {
  ENTITY_ICONS,
  type Entity,
  type EntityMeeting,
  type ValueGainSignals,
  extractAndProcessEntities,
  getEntityMeetings,
  getEntityTypeLabel,
  getMeetingEntities,
  getRelatedEntities,
  updateEntityStatus,
} from '../../api/knowledgeGraph';
import type {
  AnalysisDocument,
  AnalysisDocumentV3,
  Meeting,
  TranscriptSegment,
} from '../../types';
import {
  analysisDocumentToMarkdown,
  analysisDocumentV3ToMarkdown,
  parseAnalysisDocumentJson,
  parseAnalysisDocumentV3Json,
  parseUserEditsJson,
  resolveMeetingAnalysis,
} from '../../utils/analysisDocument';
import {
  buildAnalysisTranscriptFromJson,
  isTranscriptJsonEffectivelyEmpty,
  parseTranscriptSegments,
} from '../../utils/transcript';
import { EntitySidebar } from '../KnowledgeGraph/EntitySidebar';
import { FollowUpDrafts } from './FollowUpDrafts';
import { V3AnalysisViewer } from './V3AnalysisViewer';
import { buildFollowUpDraftContext } from './followUpDraftContext';
import { getMeetingParticipants } from './followUpDraftParticipants';
import {
  type MeetingActionEntity,
  type MeetingLinkedAttentionItem,
  buildMeetingActionItems,
} from './meetingActionItems';

interface MeetingViewProps {
  selectedMeeting: Meeting | undefined;
  editingTitle: boolean;
  setEditingTitle: (val: boolean) => void;
  titleValue: string;
  setTitleValue: (val: string) => void;
  fetchMeetings: () => void;
  handleCopySummary: (text: string) => void;
  copySuccess: boolean;
  handleDeleteMeeting: (id: string | number) => void;
  highlightEntities: (text: string) => ReactNode;
  transcriptVisible: boolean;
  setTranscriptVisible: (val: boolean) => void;
}

export const MeetingView = ({
  selectedMeeting,
  editingTitle,
  setEditingTitle,
  titleValue,
  setTitleValue,
  fetchMeetings,
  handleCopySummary,
  copySuccess,
  handleDeleteMeeting,
  highlightEntities,
  transcriptVisible,
  setTranscriptVisible,
}: MeetingViewProps) => {
  if (!selectedMeeting) return null;

  const transcriptBodyRef = useRef<HTMLDivElement>(null);
  const [transcriptBodyHeight, setTranscriptBodyHeight] = useState(0);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [entityMeetings, setEntityMeetings] = useState<EntityMeeting[]>([]);
  const [relatedEntities, setRelatedEntities] = useState<
    (Entity & { relationship: string; direction: 'outgoing' | 'incoming' })[]
  >([]);
  const [entityDetailsLoading, setEntityDetailsLoading] = useState(false);
  const [entityDetailsError, setEntityDetailsError] = useState<string | null>(
    null,
  );
  const [isRegeneratingNotes, setIsRegeneratingNotes] = useState(false);
  const [regenerateNotesError, setRegenerateNotesError] = useState<
    string | null
  >(null);
  const [meetingEntities, setMeetingEntities] = useState<MeetingActionEntity[]>(
    [],
  );
  const [meetingAttentionItems, setMeetingAttentionItems] = useState<
    MeetingLinkedAttentionItem[]
  >([]);
  const [meetingEntitiesLoading, setMeetingEntitiesLoading] = useState(false);
  const [meetingActionError, setMeetingActionError] = useState<string | null>(
    null,
  );
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [pendingAttentionId, setPendingAttentionId] = useState<string | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!transcriptVisible) {
      setTranscriptBodyHeight(0);
      return;
    }
    const el = transcriptBodyRef.current;
    if (!el) return;
    setTranscriptBodyHeight(0);
    const frame = requestAnimationFrame(() => {
      setTranscriptBodyHeight(el.scrollHeight);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    transcriptVisible,
    selectedMeeting?.transcript_json,
    selectedMeeting?.enhanced_notes,
    selectedMeeting?.user_notes,
  ]);

  useEffect(() => {
    if (!transcriptVisible) return;
    const handleResize = () => {
      const el = transcriptBodyRef.current;
      if (el) setTranscriptBodyHeight(el.scrollHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [transcriptVisible]);

  useEffect(() => {
    setSelectedEntity(null);
    setMeetingEntities([]);
    setEntityMeetings([]);
    setRelatedEntities([]);
    setEntityDetailsError(null);
    setIsRegeneratingNotes(false);
    setRegenerateNotesError(null);
    setMeetingActionError(null);
    setPendingActionId(null);
    setPendingAttentionId(null);
  }, [selectedMeeting.id]);

  useEffect(() => {
    let cancelled = false;

    const fetchMeetingEntities = async () => {
      setMeetingEntitiesLoading(true);
      try {
        const [entitiesResult, alertsResult] = await Promise.allSettled([
          getMeetingEntities(String(selectedMeeting.id)),
          getMeetingAlerts(String(selectedMeeting.id)),
        ]);

        const data =
          entitiesResult.status === 'fulfilled'
            ? (entitiesResult.value as MeetingActionEntity[])
            : null;
        if (!cancelled) {
          if (data) {
            setMeetingEntities(data);
          }
          if (alertsResult.status === 'fulfilled') {
            const linkedAlerts = Array.isArray(alertsResult.value)
              ? (
                  alertsResult.value as Array<{
                    id?: unknown;
                    status?: unknown;
                    related_entity_ids?: unknown;
                  }>
                )
                  .filter(
                    (
                      item,
                    ): item is {
                      id: string;
                      status: 'active' | 'dismissed' | 'snoozed';
                      related_entity_ids: string[];
                    } =>
                      typeof item.id === 'string' &&
                      (item.status === 'active' ||
                        item.status === 'dismissed' ||
                        item.status === 'snoozed') &&
                      Array.isArray(item.related_entity_ids),
                  )
                  .map((item) => ({
                    id: item.id,
                    status: item.status,
                    related_entity_ids: item.related_entity_ids,
                  }))
              : [];
            setMeetingAttentionItems(linkedAlerts);
          } else {
            console.error(
              'Failed to fetch meeting attention items:',
              alertsResult.reason,
            );
            setMeetingAttentionItems([]);
          }
        }
        if (entitiesResult.status === 'rejected') {
          throw entitiesResult.reason;
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to fetch meeting action items:', error);
          setMeetingActionError('Could not load linked follow-ups.');
        }
      } finally {
        if (!cancelled) {
          setMeetingEntitiesLoading(false);
        }
      }
    };

    const handleEntitiesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ meetingId?: string | number }>)
        .detail;
      if (!detail?.meetingId) return;
      if (String(detail.meetingId) !== String(selectedMeeting.id)) return;
      void fetchMeetingEntities();
    };

    void fetchMeetingEntities();
    window.addEventListener('MEETING_ENTITIES_UPDATED', handleEntitiesUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(
        'MEETING_ENTITIES_UPDATED',
        handleEntitiesUpdated,
      );
    };
  }, [selectedMeeting.id]);

  useEffect(() => {
    let cancelled = false;

    const fetchMeetingEntities = async () => {
      try {
        const entities = await getMeetingEntities(String(selectedMeeting.id));
        if (cancelled) return;
        setMeetingEntities(entities);
      } catch (error) {
        if (cancelled) return;
        console.error(
          'Failed to fetch meeting entities for follow-up drafts:',
          error,
        );
        setMeetingEntities([]);
      }
    };

    const handleEntitiesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ meetingId?: string | number }>)
        .detail;
      if (!detail?.meetingId) return;
      if (String(detail.meetingId) !== String(selectedMeeting.id)) return;
      void fetchMeetingEntities();
    };

    void fetchMeetingEntities();
    window.addEventListener('MEETING_ENTITIES_UPDATED', handleEntitiesUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(
        'MEETING_ENTITIES_UPDATED',
        handleEntitiesUpdated,
      );
    };
  }, [selectedMeeting.id]);

  useEffect(() => {
    if (!selectedEntity) {
      setEntityMeetings([]);
      setRelatedEntities([]);
      setEntityDetailsLoading(false);
      setEntityDetailsError(null);
      return;
    }

    let cancelled = false;
    setEntityDetailsLoading(true);
    setEntityDetailsError(null);

    Promise.all([
      getEntityMeetings(selectedEntity.id),
      getRelatedEntities(selectedEntity.id),
    ])
      .then(([meetings, related]) => {
        if (cancelled) return;
        setEntityMeetings(meetings);
        setRelatedEntities(related);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to fetch entity details:', error);
        setEntityDetailsError('Could not load entity details.');
      })
      .finally(() => {
        if (cancelled) return;
        setEntityDetailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEntity]);

  const { version, v2, v3 } = resolveMeetingAnalysis(selectedMeeting);
  const editsMap = parseUserEditsJson(selectedMeeting.user_edits_json);

  const canonicalAnalysisMarkdown = v3
    ? analysisDocumentV3ToMarkdown(v3)
    : v2
      ? analysisDocumentToMarkdown(v2)
      : selectedMeeting.enhanced_notes || selectedMeeting.user_notes || '';

  const summaryParagraphs = v2?.summary?.length
    ? v2.summary
    : ['No summary was generated for this meeting.'];
  const keyPoints = v2?.key_points || [];
  const actionItems =
    v3?.all_action_items.map((item) => {
      const details = [
        item.assignee ? `Owner: ${item.assignee}` : '',
        item.due ? `Due: ${item.due}` : '',
      ]
        .filter(Boolean)
        .join(' | ');
      return details ? `${item.text} (${details})` : item.text;
    }) ||
    v2?.action_items ||
    [];
  const decisions =
    v3?.all_decisions.map((decision) => decision.text) || v2?.decisions || [];
  const followUpDraftContext = buildFollowUpDraftContext({
    fallbackActionItems: actionItems,
    linkedEntities: meetingEntities,
  });
  const followUpDraftParticipants = Array.from(
    new Set([
      ...followUpDraftContext.participants,
      ...getMeetingParticipants(selectedMeeting),
    ]),
  );
  const totalEntityMentions = entityMeetings.reduce(
    (sum, meeting) => sum + meeting.mention_count,
    0,
  );
  const meetingActionItems = buildMeetingActionItems({
    meetingEntities,
    linkedAttentionItems: meetingAttentionItems,
    fallbackActionItems: actionItems,
  });

  const formatEntityMeetingDate = (meeting: EntityMeeting): string => {
    const value = meeting.started_at || meeting.created_at;
    if (!value) return 'Unknown date';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown date';
    return parsed.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const regenerateEnhancedNotes = async () => {
    if (isRegeneratingNotes) return;

    setRegenerateNotesError(null);
    const transcript = buildAnalysisTranscriptFromJson(
      selectedMeeting.transcript_json,
    );
    if (!transcript.trim()) {
      setRegenerateNotesError(
        'No transcript is available for enhanced note generation.',
      );
      return;
    }

    setIsRegeneratingNotes(true);
    try {
      const artifacts = (await window.ipcRenderer.invoke(
        'GENERATE_ANALYSIS_V2',
        {
          transcript,
          userNotes: selectedMeeting.user_notes || '',
        },
      )) as { markdown?: unknown; analysis?: unknown; signals?: unknown };

      let normalizedAnalysis: AnalysisDocument | AnalysisDocumentV3 | null =
        null;
      if (artifacts?.analysis != null) {
        const strAnalysis = JSON.stringify(artifacts.analysis);
        normalizedAnalysis =
          parseAnalysisDocumentV3Json(strAnalysis) ||
          parseAnalysisDocumentJson(strAnalysis);
      }

      if (!normalizedAnalysis) {
        setRegenerateNotesError(
          'Enhanced note generation returned an invalid response. Check LLM settings and try again.',
        );
        return;
      }
      if (normalizedAnalysis.quality.fallback_used) {
        setRegenerateNotesError(
          'Enhanced note generation failed. Verify LLM provider/API settings, then retry.',
        );
        return;
      }
      const enhancedNotes =
        typeof artifacts?.markdown === 'string' && artifacts.markdown.trim()
          ? artifacts.markdown
          : normalizedAnalysis.analysis_schema_version === 3
            ? analysisDocumentV3ToMarkdown(
                normalizedAnalysis as AnalysisDocumentV3,
              )
            : analysisDocumentToMarkdown(
                normalizedAnalysis as AnalysisDocument,
              );
      const normalizedSignals: ValueGainSignals | undefined =
        artifacts?.signals != null &&
        typeof artifacts.signals === 'object' &&
        !Array.isArray(artifacts.signals)
          ? {
              analysis_schema_version:
                typeof (
                  artifacts.signals as { analysis_schema_version?: unknown }
                ).analysis_schema_version === 'number'
                  ? (artifacts.signals as { analysis_schema_version?: number })
                      .analysis_schema_version
                  : undefined,
              continuity: Array.isArray(
                (artifacts.signals as { continuity?: unknown }).continuity,
              )
                ? (artifacts.signals as { continuity?: string[] }).continuity ||
                  []
                : [],
              accountability_risks: Array.isArray(
                (artifacts.signals as { accountability_risks?: unknown })
                  .accountability_risks,
              )
                ? (
                    artifacts.signals as {
                      accountability_risks?: string[];
                    }
                  ).accountability_risks || []
                : [],
              decision_impacts: Array.isArray(
                (artifacts.signals as { decision_impacts?: unknown })
                  .decision_impacts,
              )
                ? (artifacts.signals as { decision_impacts?: string[] })
                    .decision_impacts || []
                : [],
              extra_tags: Array.isArray(
                (artifacts.signals as { extra_tags?: unknown }).extra_tags,
              )
                ? (
                    artifacts.signals as {
                      extra_tags?: Array<{ tag: string; confidence: number }>;
                    }
                  ).extra_tags
                : undefined,
            }
          : undefined;

      await window.ipcRenderer.invoke('SAVE_MEETING', {
        ...selectedMeeting,
        enhanced_notes: enhancedNotes,
        analysis_json: JSON.stringify(normalizedAnalysis),
        analysis_schema_version:
          normalizedAnalysis.analysis_schema_version ??
          selectedMeeting.analysis_schema_version ??
          null,
        analysis_format_pass: normalizedAnalysis.quality.format_pass,
        analysis_retry_count: normalizedAnalysis.quality.retry_count,
        analysis_fallback_used: normalizedAnalysis.quality.fallback_used,
        value_signals_json:
          artifacts?.signals != null
            ? JSON.stringify(artifacts.signals)
            : selectedMeeting.value_signals_json || null,
      });
      try {
        window.dispatchEvent(
          new CustomEvent('MEETING_ENTITIES_PROCESSING', {
            detail: { meetingId: String(selectedMeeting.id), processing: true },
          }),
        );
        await extractAndProcessEntities(
          transcript,
          String(selectedMeeting.id),
          {
            summary: enhancedNotes,
            valueSignals: normalizedSignals,
          },
        );
        window.dispatchEvent(
          new CustomEvent('MEETING_ENTITIES_UPDATED', {
            detail: { meetingId: String(selectedMeeting.id) },
          }),
        );
      } catch (entityError) {
        console.error(
          'Regenerated notes saved, but entity extraction failed:',
          entityError,
        );
      } finally {
        window.dispatchEvent(
          new CustomEvent('MEETING_ENTITIES_PROCESSING', {
            detail: {
              meetingId: String(selectedMeeting.id),
              processing: false,
            },
          }),
        );
      }
      await fetchMeetings();
    } catch (error) {
      console.error('Failed to regenerate enhanced notes:', error);
      setRegenerateNotesError(
        'Could not regenerate enhanced notes. Please try again.',
      );
    } finally {
      setIsRegeneratingNotes(false);
    }
  };

  const toggleMeetingActionItem = async (
    actionId: string,
    completed: boolean,
  ) => {
    if (pendingActionId) return;

    setMeetingActionError(null);
    setPendingActionId(actionId);
    const nextStatus = completed ? 'active' : 'completed';

    setMeetingEntities((prev) =>
      prev.map((entity) =>
        entity.id === actionId ? { ...entity, status: nextStatus } : entity,
      ),
    );

    try {
      await updateEntityStatus(actionId, nextStatus);
      window.dispatchEvent(
        new CustomEvent('MEETING_ENTITIES_UPDATED', {
          detail: { meetingId: String(selectedMeeting.id) },
        }),
      );
    } catch (error) {
      console.error('Failed to update meeting action item status:', error);
      setMeetingActionError('Could not update this follow-up right now.');
      setMeetingEntities((prev) =>
        prev.map((entity) =>
          entity.id === actionId
            ? {
                ...entity,
                status: completed ? 'completed' : 'active',
              }
            : entity,
        ),
      );
    } finally {
      setPendingActionId(null);
    }
  };

  const toggleMeetingActionDismissal = async (
    attentionItemId: string,
    nextStatus: 'active' | 'dismissed' | 'snoozed',
  ) => {
    if (pendingAttentionId) return;

    setMeetingActionError(null);
    setPendingAttentionId(attentionItemId);
    const previous = meetingAttentionItems.find(
      (item) => item.id === attentionItemId,
    );
    const previousStatus = previous?.status ?? 'active';

    setMeetingAttentionItems((prev) =>
      prev.map((item) =>
        item.id === attentionItemId ? { ...item, status: nextStatus } : item,
      ),
    );

    try {
      await updateAlertStatus(attentionItemId, nextStatus);
      window.dispatchEvent(
        new CustomEvent('MEETING_ENTITIES_UPDATED', {
          detail: { meetingId: String(selectedMeeting.id) },
        }),
      );
    } catch (error) {
      console.error('Failed to update meeting follow-up dismissal:', error);
      setMeetingActionError('Could not update this follow-up right now.');
      setMeetingAttentionItems((prev) =>
        prev.map((item) =>
          item.id === attentionItemId
            ? {
                ...item,
                status: previousStatus,
              }
            : item,
        ),
      );
    } finally {
      setPendingAttentionId(null);
    }
  };

  return (
    <div
      key={selectedMeeting.id}
      className="max-w-4xl mx-auto w-full space-y-20 animate-in pb-32"
    >
      {/* Clean Hero Header */}
      <div className="flex flex-col md:flex-row items-start justify-between gap-8 border-b border-pro-border/40 pb-12">
        <div className="space-y-4 flex-1">
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-bold text-pro-accent uppercase tracking-widest bg-pro-accent/5 px-2 py-1 rounded">
              Synthesis Ready
            </span>
            <span className="text-[10px] text-pro-text-muted/60 font-medium uppercase tracking-widest">
              {new Date(
                selectedMeeting?.created_at ||
                  selectedMeeting?.started_at ||
                  Date.now(),
              ).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
          {editingTitle ? (
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={async () => {
                setEditingTitle(false);
                if (
                  titleValue.trim() &&
                  selectedMeeting &&
                  titleValue !== selectedMeeting.title
                ) {
                  // Save to database
                  await window.ipcRenderer.invoke('SAVE_MEETING', {
                    ...selectedMeeting,
                    title: titleValue.trim(),
                  });
                  // Refresh meetings list
                  fetchMeetings();
                } else if (!titleValue.trim()) {
                  setTitleValue(selectedMeeting?.title || 'Untitled Session');
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  setTitleValue(selectedMeeting?.title || 'Untitled Session');
                  setEditingTitle(false);
                }
              }}
              className="text-4xl font-extrabold tracking-tight text-pro-text-main leading-tight bg-transparent border-b-2 border-pro-accent outline-none w-full"
            />
          ) : (
            <h1
              onClick={() => {
                setEditingTitle(true);
                setTitleValue(selectedMeeting?.title || 'Untitled Session');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingTitle(true);
                  setTitleValue(selectedMeeting?.title || 'Untitled Session');
                }
              }}
              className="text-2xl md:text-4xl font-extrabold tracking-tight text-pro-text-main leading-tight cursor-text hover:text-pro-accent/80 transition-colors"
            >
              {selectedMeeting?.title || 'Untitled Session'}
            </h1>
          )}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-2 px-3 py-1 bg-pro-accent/10 rounded-full border border-pro-accent/20 ml-2 shadow-sm">
              <BarChart3 className="w-3 h-3 text-pro-accent" />
              <div className="flex items-center gap-0.5 h-3">
                {Array.from({ length: 8 }, (_, barIndex) => barIndex).map(
                  (barIndex) => (
                    <div
                      key={barIndex}
                      className="w-0.5 rounded-full bg-pro-accent/60 animate-pulse"
                      style={{
                        height: `${Math.random() * 8 + 4}px`,
                        animationDelay: `${barIndex * 0.1}s`,
                      }}
                    />
                  ),
                )}
              </div>
              <p className="text-[10px] font-black text-pro-accent uppercase tracking-widest ml-1 opacity-90">
                {selectedMeeting?.duration_seconds
                  ? `${Math.floor(selectedMeeting.duration_seconds / 60)}m ${selectedMeeting.duration_seconds % 60}s`
                  : 'Biometric Audio'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={regenerateEnhancedNotes}
            disabled={isRegeneratingNotes}
            className={`w-10 h-10 rounded-xl border flex items-center justify-center text-sm transition-all duration-300 ${
              isRegeneratingNotes
                ? 'bg-pro-bg border-pro-border/40 text-pro-text-muted cursor-not-allowed'
                : 'bg-pro-bg border-pro-border/40 hover:bg-pro-surface text-pro-text-main hover:scale-105'
            }`}
            title={
              isRegeneratingNotes
                ? 'Generating Enhanced Notes...'
                : 'Regenerate Enhanced Notes'
            }
          >
            {isRegeneratingNotes ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 opacity-70" />
            )}
          </button>
          <button
            type="button"
            onClick={() => handleCopySummary(canonicalAnalysisMarkdown)}
            className={`w-10 h-10 rounded-xl border flex items-center justify-center text-sm transition-all duration-300 ${copySuccess ? 'bg-green-500 border-green-600 text-white scale-110' : 'bg-pro-bg border-pro-border/40 hover:bg-pro-surface text-pro-text-main hover:scale-105'}`}
            title="Copy Summary"
          >
            {copySuccess ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4 opacity-60" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedMeeting) {
                const summaryText = canonicalAnalysisMarkdown;
                const content = `Session: ${selectedMeeting.title}\nDate: ${selectedMeeting.created_at}\n\nSummary:\n${summaryText}\n\nTranscript:\n${selectedMeeting.transcript_json}`;
                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `pluto-session-${selectedMeeting.id}.txt`;
                a.click();
              }
            }}
            className="w-10 h-10 rounded-xl bg-pro-bg border border-pro-border/40 flex items-center justify-center text-pro-text-main/60 hover:text-pro-text-main hover:bg-pro-surface transition-all"
            title="Export Session"
          >
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
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => handleDeleteMeeting(selectedMeeting.id)}
            className="w-10 h-10 rounded-xl bg-red-500/5 border border-red-500/20 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-95"
            title="Delete Meeting"
          >
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
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
      {regenerateNotesError ? (
        <p className="-mt-4 text-xs font-semibold text-red-600">
          {regenerateNotesError}
        </p>
      ) : null}

      {/* Discovery Hub - Related Entities (Knowledge Graph) */}
      <div className="mb-12 space-y-6">
        <FollowUpDrafts
          meeting={selectedMeeting}
          actionItems={followUpDraftContext.actionItems}
          decisions={decisions}
          entityContext={followUpDraftContext.entityContext}
          participants={followUpDraftParticipants}
          fetchMeetings={fetchMeetings}
        />

        <EntitySidebar
          meetingId={String(selectedMeeting.id)}
          onEntityClick={(entity) => {
            setSelectedEntity(entity);
          }}
        />
        {selectedEntity && (
          <div className="bg-pro-surface/70 border border-pro-border/50 rounded-3xl p-6 md:p-8 shadow-sm space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-[10px] font-black text-pro-text-muted/50 uppercase tracking-[0.2em]">
                  Entity Detail
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">
                    {ENTITY_ICONS[selectedEntity.type]}
                  </span>
                  <div>
                    <h3 className="text-xl font-black text-pro-text-main">
                      {selectedEntity.name}
                    </h3>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-pro-text-muted/60">
                      {getEntityTypeLabel(selectedEntity.type)}
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntity(null)}
                className="h-8 px-3 rounded-full border border-pro-border text-[10px] font-black uppercase tracking-widest text-pro-text-muted/60 hover:text-pro-text-main hover:border-pro-accent/30 transition-colors"
              >
                Close
              </button>
            </div>

            {entityDetailsLoading ? (
              <div className="p-5 rounded-2xl border border-pro-border/50 bg-pro-bg/50 text-[12px] font-semibold text-pro-text-muted/60">
                Loading mentions and related entities...
              </div>
            ) : entityDetailsError ? (
              <div className="p-5 rounded-2xl border border-red-200 bg-red-50/50 text-[12px] font-semibold text-red-600">
                {entityDetailsError}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-pro-accent/10 text-[10px] font-black uppercase tracking-widest text-pro-accent">
                    {entityMeetings.length} meetings
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-stone-100 text-[10px] font-black uppercase tracking-widest text-pro-text-muted/70">
                    {totalEntityMentions} mentions
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-stone-100 text-[10px] font-black uppercase tracking-widest text-pro-text-muted/70">
                    {relatedEntities.length} connections
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-pro-text-muted/40">
                      All Mentions Across Meetings
                    </h4>
                    <div className="space-y-3">
                      {entityMeetings.length === 0 ? (
                        <p className="p-4 rounded-2xl border border-dashed border-pro-border text-[12px] text-pro-text-muted/60">
                          No prior meeting mentions found.
                        </p>
                      ) : (
                        entityMeetings.map((meeting) => (
                          <div
                            key={meeting.id}
                            className="p-4 rounded-2xl border border-pro-border/50 bg-pro-surface/70 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-[13px] font-bold text-pro-text-main truncate">
                                {meeting.title || 'Untitled Session'}
                              </p>
                              <span className="text-[10px] font-bold uppercase tracking-widest text-pro-text-muted/50">
                                {formatEntityMeetingDate(meeting)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-pro-text-muted/60">
                                {meeting.mention_count} mention
                                {meeting.mention_count === 1 ? '' : 's'}
                              </span>
                              {String(meeting.id) ===
                                String(selectedMeeting.id) && (
                                <span className="text-[9px] font-black uppercase tracking-widest text-pro-accent">
                                  Current Meeting
                                </span>
                              )}
                            </div>
                            {meeting.context ? (
                              <p className="text-[12px] text-pro-text-muted/80 line-clamp-3">
                                {meeting.context}
                              </p>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-pro-text-muted/40">
                      Connected Entities
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {relatedEntities.length === 0 ? (
                        <p className="w-full p-4 rounded-2xl border border-dashed border-pro-border text-[12px] text-pro-text-muted/60">
                          No relationships inferred yet.
                        </p>
                      ) : (
                        relatedEntities.map((related) => (
                          <button
                            key={`${related.id}-${related.relationship}-${related.direction}`}
                            type="button"
                            onClick={() => setSelectedEntity(related)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-pro-border bg-pro-surface text-[11px] font-bold text-pro-text-main hover:border-pro-accent/30 hover:text-pro-accent transition-colors"
                            title={`${related.direction === 'outgoing' ? 'Links to' : 'Linked from'} ${related.name}`}
                          >
                            <span>{ENTITY_ICONS[related.type]}</span>
                            <span className="truncate max-w-[120px]">
                              {related.name}
                            </span>
                            <span className="text-[9px] font-black uppercase tracking-widest text-pro-text-muted/50">
                              {related.relationship.replace(/_/g, ' ')}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Summary & Analysis Section */}
      {version === 3 && v3 ? (
        <V3AnalysisViewer
          meetingId={selectedMeeting.id}
          doc={v3}
          editsMap={editsMap}
          highlightEntities={highlightEntities}
          onEditSaved={fetchMeetings}
        />
      ) : v2 ? (
        <div className="space-y-16">
          <div className="grid grid-cols-12 gap-8 items-start overflow-visible">
            {/* Left Column: Executive Summary & Key Points */}
            <div className="col-span-12 lg:col-span-7 space-y-12">
              {/* Executive Summary */}
              <div className="space-y-4">
                <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
                  Executive Summary
                </h2>
                <div className="text-xl font-medium leading-[1.6] text-pro-text-main/90 bg-pro-surface/40 backdrop-blur-sm p-8 rounded-[2rem] border border-pro-border/40 shadow-sm">
                  {summaryParagraphs.map((line, i) => (
                    <p
                      key={`${line}-${line.length}`}
                      className={i > 0 ? 'mt-4' : ''}
                    >
                      {highlightEntities(line)}
                    </p>
                  ))}
                </div>
              </div>

              {/* Key Insights / Points */}
              <div className="space-y-6">
                <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                  Key Insights
                </h2>
                <div className="space-y-4">
                  {(keyPoints.length > 0
                    ? keyPoints
                    : ['No key points were captured.']
                  ).map((item) => (
                    <div
                      key={`${item}-${item.length}`}
                      className="p-6 rounded-2xl bg-pro-surface border border-pro-border shadow-sm flex gap-4 group hover:border-pro-accent/30 transition-all"
                    >
                      <span className="text-pro-accent group-hover:scale-125 transition-transform shrink-0 pt-0.5">
                        ◆
                      </span>
                      <p className="text-[15px] font-medium leading-relaxed text-pro-text-main/80">
                        {highlightEntities(item)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Decisions Section */}
              <div className="space-y-6">
                <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em]">
                  Decisions
                </h2>
                <div className="p-8 rounded-[2rem] bg-indigo-50/30 dark:bg-pro-surface/50 border border-indigo-100/50 dark:border-pro-border/30 space-y-4">
                  {(decisions.length > 0
                    ? decisions
                    : ['No explicit decisions were made.']
                  ).map((item) => (
                    <div
                      key={`${item}-${item.length}`}
                      className="flex gap-3 items-baseline"
                    >
                      <span className="text-indigo-500 font-bold leading-none -translate-y-[3px]">
                        ↳
                      </span>
                      <p className="text-[14px] font-semibold text-indigo-900/80 dark:text-indigo-200/90 leading-relaxed">
                        {highlightEntities(item)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Action Items */}
            <div className="col-span-12 lg:col-span-5 space-y-12 lg:sticky lg:top-24 lg:self-start">
              <div className="space-y-6">
                <h2 className="text-[10px] font-black text-pro-text-muted/40 uppercase tracking-[0.2em] flex items-center gap-2">
                  Action Items
                </h2>
                {meetingActionError ? (
                  <p className="-mt-2 text-xs font-semibold text-red-600">
                    {meetingActionError}
                  </p>
                ) : null}
                <div className="space-y-4">
                  {(meetingActionItems.length > 0
                    ? meetingActionItems
                    : ['No concrete action items were explicitly committed.']
                  ).map((item) =>
                    typeof item === 'string' ? (
                      <div
                        key={`${item}-${item.length}`}
                        className="p-6 rounded-2xl bg-pro-surface border border-pro-border shadow-premium flex gap-4 group hover:border-pro-accent/30 transition-all card-hover-effect"
                      >
                        <div className="w-6 h-6 rounded-lg border border-pro-border flex items-center justify-center shrink-0 mt-0.5 group-hover:border-pro-accent group-hover:bg-pro-accent/5 transition-all">
                          <Check className="w-3.5 h-3.5 text-pro-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-[15px] font-medium leading-relaxed text-pro-text-main/80">
                          {highlightEntities(item)}
                        </p>
                      </div>
                    ) : (
                      <div
                        key={item.id}
                        className={`p-6 rounded-2xl border shadow-premium flex gap-4 transition-all card-hover-effect ${
                          item.attentionStatus === 'dismissed'
                            ? 'bg-amber-500/5 border-amber-500/20'
                            : item.attentionStatus === 'snoozed'
                              ? 'bg-sky-500/5 border-sky-500/20'
                              : 'bg-pro-surface border-pro-border'
                        }`}
                      >
                        <button
                          type="button"
                          disabled={
                            !item.actionable ||
                            pendingActionId === item.id ||
                            pendingAttentionId === item.attentionItemId ||
                            meetingEntitiesLoading
                          }
                          onClick={() =>
                            item.actionable
                              ? toggleMeetingActionItem(
                                  item.id,
                                  item.status === 'completed',
                                )
                              : undefined
                          }
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-all ${
                            item.status === 'completed'
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                              : 'border-pro-border text-pro-accent hover:border-pro-accent hover:bg-pro-accent/5'
                          } ${
                            !item.actionable ||
                            pendingActionId === item.id ||
                            pendingAttentionId === item.attentionItemId
                              ? 'cursor-not-allowed opacity-70'
                              : ''
                          }`}
                          aria-label={item.toggleLabel ?? 'Meeting follow-up'}
                          title={item.toggleLabel ?? undefined}
                        >
                          {pendingActionId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                                item.status === 'completed'
                                  ? 'bg-emerald-500/10 text-emerald-600'
                                  : item.status === 'overdue'
                                    ? 'bg-red-500/10 text-red-500'
                                    : item.status === 'stale'
                                      ? 'bg-amber-500/10 text-amber-600'
                                      : item.status === 'fallback'
                                        ? 'bg-pro-bg text-pro-text-muted'
                                        : 'bg-pro-accent/10 text-pro-accent'
                              }`}
                            >
                              {item.status === 'fallback'
                                ? 'Summary'
                                : item.status}
                            </span>
                            {item.assignee ? (
                              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-pro-text-muted/65">
                                Owner: {item.assignee}
                              </span>
                            ) : null}
                            {item.attentionStatus === 'dismissed' ? (
                              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
                                Dismissed
                              </span>
                            ) : item.attentionStatus === 'snoozed' ? (
                              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">
                                Snoozed
                              </span>
                            ) : null}
                            {item.dueLabel ? (
                              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-pro-text-muted/65">
                                {item.dueLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-[15px] font-medium leading-relaxed text-pro-text-main/80">
                            {highlightEntities(item.title)}
                          </p>
                          {item.context ? (
                            <p className="text-[12px] font-medium leading-relaxed text-pro-text-muted">
                              {highlightEntities(item.context)}
                            </p>
                          ) : null}
                          {item.attentionItemId &&
                          (item.dismissLabel || item.snoozeLabel) ? (
                            <div className="flex flex-wrap gap-3">
                              {item.dismissLabel ? (
                                <button
                                  type="button"
                                  disabled={
                                    pendingAttentionId ===
                                      item.attentionItemId ||
                                    meetingEntitiesLoading
                                  }
                                  onClick={() =>
                                    toggleMeetingActionDismissal(
                                      item.attentionItemId as string,
                                      item.attentionStatus === 'dismissed'
                                        ? 'active'
                                        : 'dismissed',
                                    )
                                  }
                                  className={`text-[11px] font-black uppercase tracking-[0.16em] transition-colors ${
                                    pendingAttentionId === item.attentionItemId
                                      ? 'cursor-not-allowed text-pro-text-muted/50'
                                      : item.attentionStatus === 'dismissed'
                                        ? 'text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200'
                                        : 'text-pro-text-muted/70 hover:text-pro-accent'
                                  }`}
                                >
                                  {pendingAttentionId === item.attentionItemId
                                    ? 'Updating...'
                                    : item.dismissLabel}
                                </button>
                              ) : null}
                              {item.snoozeLabel ? (
                                <button
                                  type="button"
                                  disabled={
                                    pendingAttentionId ===
                                      item.attentionItemId ||
                                    meetingEntitiesLoading
                                  }
                                  onClick={() =>
                                    toggleMeetingActionDismissal(
                                      item.attentionItemId as string,
                                      item.attentionStatus === 'snoozed'
                                        ? 'active'
                                        : 'snoozed',
                                    )
                                  }
                                  className={`text-[11px] font-black uppercase tracking-[0.16em] transition-colors ${
                                    pendingAttentionId === item.attentionItemId
                                      ? 'cursor-not-allowed text-pro-text-muted/50'
                                      : item.attentionStatus === 'snoozed'
                                        ? 'text-sky-700 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200'
                                        : 'text-pro-text-muted/70 hover:text-sky-600 dark:hover:text-sky-300'
                                  }`}
                                >
                                  {pendingAttentionId === item.attentionItemId
                                    ? 'Updating...'
                                    : item.snoozeLabel}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Empty State vs Content */}
      {!v2 &&
      !v3 &&
      !selectedMeeting?.enhanced_notes &&
      !selectedMeeting?.user_notes &&
      (!selectedMeeting?.transcript_json ||
        isTranscriptJsonEffectivelyEmpty(selectedMeeting.transcript_json)) ? (
        <div className="flex-1 flex flex-col items-center justify-center p-20 text-center space-y-6 opacity-60">
          <div className="w-16 h-16 rounded-2xl bg-stone-100 flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-stone-300" />
          </div>
          <h3 className="text-xl font-bold text-pro-text-main">
            No Content Recorded
          </h3>
          <p className="text-sm text-pro-text-muted max-w-sm">
            No audio was detected during this session, so no transcript or
            summary could be generated.
          </p>
        </div>
      ) : (
        <div
          className={`flex-1 flex flex-col ${transcriptVisible ? 'lg:flex-row' : 'lg:flex-col'} h-auto overflow-visible relative`}
        >
          {/* Right: Transcript (Collapsible) - Visual polish */}
          <div className="relative bg-pro-bg lg:bg-transparent z-20 flex-1 border-l border-pro-border/40 lg:border-l-0">
            {transcriptVisible && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-pro-bg dark:bg-pro-bg z-20" />
            )}
            <div className="flex flex-col">
              {transcriptVisible && (
                <div
                  className="sticky z-30 bg-pro-bg dark:bg-pro-bg pt-6"
                  style={{ top: '-65px' }}
                >
                  <div className="bg-pro-surface dark:bg-pro-bg shadow-md dark:shadow-none border-b border-transparent dark:border-transparent overflow-hidden">
                    <div className="p-6 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-pro-accent/10 flex items-center justify-center text-pro-accent">
                          <MessageSquare size={14} />
                        </div>
                        <div>
                          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-pro-text-main">
                            Transcript
                          </h3>
                          <p className="text-[9px] font-bold text-pro-text-muted uppercase tracking-widest mt-0.5">
                            Verbatim Record
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTranscriptVisible(false)}
                        className="lg:hidden p-2 hover:bg-black/5 rounded-full transition-colors"
                      >
                        <ChevronDown className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div
                className={`transition-[max-height,opacity] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden ${
                  transcriptVisible
                    ? 'opacity-100'
                    : 'opacity-0 pointer-events-none'
                }`}
                style={{
                  maxHeight: transcriptVisible ? transcriptBodyHeight : 0,
                }}
              >
                <div
                  ref={transcriptBodyRef}
                  className="px-8 pb-10 pt-6 bg-stone-50/30 dark:bg-transparent"
                >
                  <div className="space-y-8 max-w-xl mx-auto pt-4">
                    {(() => {
                      if (!selectedMeeting?.transcript_json) return null;
                      let segments: TranscriptSegment[] = [];
                      try {
                        segments = parseTranscriptSegments(
                          selectedMeeting.transcript_json,
                        ) as TranscriptSegment[];
                      } catch (e) {
                        console.error('Failed to parse transcript', e);
                        return null;
                      }

                      if (segments.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-20 opacity-40">
                            <Sparkles className="w-5 h-5 text-pro-accent/20 mx-auto mb-3" />
                            <p className="text-pro-text-muted/40 font-bold uppercase tracking-widest text-[9px]">
                              No biometric voice data found
                            </p>
                          </div>
                        );
                      }

                      const mergedSegments: TranscriptSegment[] = [];
                      for (const segment of segments) {
                        const lastSegment =
                          mergedSegments[mergedSegments.length - 1];
                        if (
                          lastSegment &&
                          String(lastSegment.speaker) ===
                            String(segment.speaker)
                        ) {
                          lastSegment.text += ` ${segment.text}`;
                        } else {
                          mergedSegments.push({ ...segment });
                        }
                      }

                      return mergedSegments.map((s: TranscriptSegment) => {
                        const segmentKey = `${String(s.speaker ?? 'unknown')}-${s.start}-${s.end}-${s.text}`;
                        return (
                          <div
                            key={segmentKey}
                            className="group flex gap-12 transition-all"
                          >
                            <div className="w-20 shrink-0 pt-1 text-right">
                              <span className="text-[10px] font-black text-pro-accent uppercase tracking-[0.2em] opacity-40 group-hover:opacity-100 transition-opacity">
                                {s.speaker || 'Unknown'}
                              </span>
                            </div>
                            <div className="flex-1">
                              <p className="text-pro-text-main text-lg leading-[1.8] font-medium opacity-80 group-hover:opacity-100 transition-opacity">
                                {highlightEntities(s.text)}
                              </p>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>

              {/* Expansion Action Bar - Refined Gradient & integrated button */}
              {transcriptVisible && (
                <div className="relative flex items-end justify-center pb-8 transition-all duration-700 pt-16 pb-24">
                  <button
                    type="button"
                    onClick={() => setTranscriptVisible(!transcriptVisible)}
                    className="group relative px-8 py-3 bg-pro-surface border border-pro-border/60 shadow-[0_4px_24px_rgba(0,0,0,0.04)] rounded-full hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] hover:border-pro-accent/20 transition-all flex items-center gap-3 active:scale-95"
                  >
                    <span className="text-[10px] font-black text-pro-text-main/80 uppercase tracking-widest group-hover:text-pro-text-main transition-colors">
                      Collapse Transcript
                    </span>
                    <div className="w-5 h-5 rounded-full bg-pro-accent/5 flex items-center justify-center transition-transform duration-500 rotate-180">
                      <ChevronDown className="w-3 h-3 text-pro-accent" />
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          {!transcriptVisible && (
            <div className="flex w-full items-center justify-center py-6">
              <button
                type="button"
                onClick={() => setTranscriptVisible(true)}
                className="group relative px-8 py-3 bg-pro-surface border border-pro-border/60 shadow-[0_4px_24px_rgba(0,0,0,0.04)] rounded-full hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] hover:border-pro-accent/20 transition-all flex items-center gap-3 active:scale-95"
              >
                <span className="text-[10px] font-black text-pro-text-main/80 uppercase tracking-widest group-hover:text-pro-text-main transition-colors">
                  Explore Full Transcript
                </span>
                <div className="w-5 h-5 rounded-full bg-pro-accent/5 flex items-center justify-center transition-transform duration-500">
                  <ChevronDown className="w-3 h-3 text-pro-accent" />
                </div>
                <div className="absolute -right-2 -top-2 flex items-center justify-center w-5 h-5 bg-pro-accent text-white rounded-full text-[9px] font-bold shadow-sm animate-in zoom-in duration-300 delay-100">
                  +
                </div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Discreet Footer */}
      <div className="pt-12 flex items-center justify-between border-t border-pro-border/20 px-4">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest">
              Encrypted
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-pro-accent/30" />
            <span className="text-[9px] font-bold text-pro-text-muted/40 uppercase tracking-widest">
              Local Engine v4.2
            </span>
          </div>
        </div>
        <div className="text-[9px] font-bold text-pro-text-muted/20 uppercase tracking-widest">
          Pluto Persistence Layer
        </div>
      </div>
    </div>
  );
};
