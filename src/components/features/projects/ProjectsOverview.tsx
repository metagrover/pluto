import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  FolderPlus,
  GitBranch,
  GitMerge,
  Hash,
  Layers,
  MessageSquare,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  deleteEntity,
  demoteInitiativeToTopic,
  detachTopicFromProject,
  discoverProjectInitiative,
  fileTopicUnderProject,
  getProjectPortfolio,
  mergeProject,
  promoteTopicToInitiative,
  restoreProjectMerge,
  setProjectPortfolioDisposition,
  upsertEntity,
} from '../../../api/knowledgeGraph';
import { readProjectDisplayTitle } from '../../../utils/projectBriefing';
import {
  type ProjectPortfolioEntry,
  buildProjectPortfolio,
  isProjectStarred,
} from '../../../utils/projectPortfolio';
import {
  readProjectPortfolioDisposition,
  readProjectQualification,
} from '../../../utils/projectQualification';
import { PageHeader } from '../../ui/PageHeader';
import { ReportProblemButton } from '../ReportProblemButton';
import { ProjectCommitments } from './ProjectCommitments';
import { ProjectDossier } from './ProjectDossier';

const activityDate = (value: string | null) => {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

const isRecentActivity = (value: string | null) => {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  const diffDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 14;
};

function getProjectMonogram(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'PR';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface MonogramPalette {
  bg: string;
  text: string;
  border: string;
}

const WARM_MONOGRAM_PALETTES: MonogramPalette[] = [
  // Warm Slate
  {
    bg: 'bg-stone-500/10 dark:bg-stone-400/15',
    text: 'text-stone-800 dark:text-stone-200',
    border: 'border-stone-500/20 dark:border-stone-400/25',
  },
  // Editorial Indigo
  {
    bg: 'bg-indigo-500/10 dark:bg-indigo-400/15',
    text: 'text-indigo-900 dark:text-indigo-200',
    border: 'border-indigo-500/20 dark:border-indigo-400/25',
  },
  // Warm Amber / Ochre
  {
    bg: 'bg-amber-500/12 dark:bg-amber-400/15',
    text: 'text-amber-900 dark:text-amber-200',
    border: 'border-amber-500/25 dark:border-amber-400/25',
  },
  // Sage / Forest Green
  {
    bg: 'bg-emerald-500/10 dark:bg-emerald-400/15',
    text: 'text-emerald-900 dark:text-emerald-200',
    border: 'border-emerald-500/20 dark:border-emerald-400/25',
  },
  // Terracotta / Cedar
  {
    bg: 'bg-orange-500/10 dark:bg-orange-400/15',
    text: 'text-orange-900 dark:text-orange-200',
    border: 'border-orange-500/20 dark:border-orange-400/25',
  },
  // Heather / Plum
  {
    bg: 'bg-purple-500/10 dark:bg-purple-400/15',
    text: 'text-purple-900 dark:text-purple-200',
    border: 'border-purple-500/20 dark:border-purple-400/25',
  },
];

function getProjectPalette(
  name: string,
  status?: string | null,
): MonogramPalette {
  if (status === 'completed') {
    return {
      bg: 'bg-emerald-500/10 dark:bg-emerald-400/15',
      text: 'text-emerald-900 dark:text-emerald-200',
      border: 'border-emerald-500/25 dark:border-emerald-400/25',
    };
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return WARM_MONOGRAM_PALETTES[hash % WARM_MONOGRAM_PALETTES.length];
}

type SynthesisState = 'idle' | 'failed' | 'incomplete';
type PortfolioFilter =
  | 'all'
  | 'primary'
  | 'side'
  | 'current'
  | 'topics'
  | 'other'
  | 'completed';

export function ProjectsOverview({
  selectedProjectId = null,
  onOpenMeeting,
  onOpenPerson,
}: {
  selectedProjectId?: string | null;
  onOpenMeeting?: (id: string) => void;
  onOpenPerson?: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState(selectedProjectId);
  const [entries, setEntries] = useState<ProjectPortfolioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [synthesisState, setSynthesisState] = useState<SynthesisState>('idle');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PortfolioFilter>('all');
  const [attempt, setAttempt] = useState(0);
  const explicitRetry = useRef(false);

  // Optimistic starred state: projectId -> boolean
  const [optimisticStarred, setOptimisticStarred] = useState<
    Record<string, boolean>
  >({});

  // Drag-and-drop merge & topic filing state
  const [draggingProject, setDraggingProject] =
    useState<ProjectPortfolioEntry | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(
    null,
  );
  const [confirmMergeData, setConfirmMergeData] = useState<{
    source: ProjectPortfolioEntry;
    destination: ProjectPortfolioEntry;
  } | null>(null);

  // Quick Merge modal state
  const [quickMergeSource, setQuickMergeSource] =
    useState<ProjectPortfolioEntry | null>(null);

  // Unified undo toast state
  const [undoToast, setUndoToast] = useState<{
    message: string;
    onUndo: () => Promise<void>;
  } | null>(null);
  const [fileUnderMenuTopicId, setFileUnderMenuTopicId] = useState<
    string | null
  >(null);
  const [isMerging, setIsMerging] = useState(false);

  const retry = () => {
    explicitRetry.current = true;
    setAttempt((value) => value + 1);
  };

  useEffect(() => setActiveId(selectedProjectId), [selectedProjectId]);

  // Click outside to close file under dropdown
  useEffect(() => {
    if (!fileUnderMenuTopicId) return;
    const handleClick = () => setFileUnderMenuTopicId(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [fileUnderMenuTopicId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shouldRetry = explicitRetry.current;
    explicitRetry.current = false;
    const refresh = async () => {
      const data = await getProjectPortfolio();
      if (!cancelled) {
        setEntries(data);
        setLoading(false);
        setLoadError(false);
      }
      return data;
    };
    const synthesize = async () => {
      if (cancelled || activeId) return;
      setSynthesisState('idle');
      try {
        const retryFailed = shouldRetry;
        shouldRetry = false;
        const result = await discoverProjectInitiative({ retryFailed });
        if (cancelled) return;
        if (result.discovered > 0) await refresh();
        if (result.deferred) {
          timer = setTimeout(synthesize, 5000);
        } else if (result.failed > 0) setSynthesisState('incomplete');
        else if (result.remaining > 0) {
          timer = setTimeout(synthesize, 5000);
        } else setSynthesisState('idle');
      } catch {
        if (!cancelled) setSynthesisState('failed');
      }
    };
    refresh()
      .then(() => {
        if (!cancelled && !activeId) void synthesize();
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeId, attempt]);

  useEffect(
    () =>
      window.ipcRenderer?.on('MEETING_NOTES_UPDATED', () => {
        void getProjectPortfolio()
          .then(setEntries)
          .catch(() => setLoadError(true));
      }),
    [],
  );

  // Auto-dismiss undo toast after 10s
  useEffect(() => {
    if (!undoToast) return;
    const timer = setTimeout(() => {
      setUndoToast(null);
    }, 10000);
    return () => clearTimeout(timer);
  }, [undoToast]);

  const portfolio = useMemo(
    () => buildProjectPortfolio(entries, search),
    [entries, search],
  );

  const reloadPortfolio = async () => {
    const data = await getProjectPortfolio();
    setEntries(data);
    setLoadError(false);
  };

  const isEntryStarred = (entry: ProjectPortfolioEntry) =>
    optimisticStarred[entry.id] ?? isProjectStarred(entry.metadata);

  const starredProjects = useMemo(
    () => portfolio.current.filter((e) => isEntryStarred(e)),
    [portfolio.current, optimisticStarred],
  );

  const sideProjects = useMemo(
    () => portfolio.current.filter((e) => !isEntryStarred(e)),
    [portfolio.current, optimisticStarred],
  );

  const activeSideProjects = useMemo(
    () => sideProjects.filter((e) => e.activity_state === 'active'),
    [sideProjects],
  );

  const dormantProjects = useMemo(
    () => sideProjects.filter((e) => e.activity_state !== 'active'),
    [sideProjects],
  );

  const totalCount = portfolio.current.length + portfolio.completed.length;

  const staleRadarTopics = useMemo(() => {
    return portfolio.radarTopics.filter(
      (topic) =>
        topic.meeting_count <= 1 &&
        topic.days_since_activity !== null &&
        topic.days_since_activity !== undefined &&
        topic.days_since_activity >= 45,
    );
  }, [portfolio.radarTopics]);

  const [isSweeping, setIsSweeping] = useState(false);

  const handleSweepStaleTopics = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!staleRadarTopics.length || isSweeping) return;
    setIsSweeping(true);
    const candidateIds = staleRadarTopics.map((t) => t.id);
    const count = candidateIds.length;
    try {
      for (const id of candidateIds) {
        await setProjectPortfolioDisposition(id, 'dismissed');
      }
      await reloadPortfolio();
      setUndoToast({
        message: `Archived ${count} stale topic${count === 1 ? '' : 's'}`,
        onUndo: async () => {
          for (const id of candidateIds) {
            await setProjectPortfolioDisposition(id, 'confirmed');
          }
          await reloadPortfolio();
        },
      });
    } catch (err) {
      console.error('Failed to sweep stale topics:', err);
    } finally {
      setIsSweeping(false);
    }
  };

  const handleToggleStar = async (
    entry: ProjectPortfolioEntry,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const currentlyStarred = isEntryStarred(entry);
    const nextStarred = !currentlyStarred;

    setOptimisticStarred((prev) => ({ ...prev, [entry.id]: nextStarred }));

    try {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(entry.metadata || '{}');
      } catch {
        parsed = {};
      }

      await upsertEntity({
        id: entry.id,
        type: 'project',
        name: entry.name,
        metadata: {
          ...parsed,
          projectStarred: nextStarred,
          projectStarredUpdatedAt: new Date().toISOString(),
        },
      });
      await reloadPortfolio();
    } catch (err) {
      console.error('Failed to toggle star:', err);
      setOptimisticStarred((prev) => ({
        ...prev,
        [entry.id]: currentlyStarred,
      }));
    }
  };

  const handleFileTopic = async (
    topic: ProjectPortfolioEntry,
    initiative: ProjectPortfolioEntry,
  ) => {
    const topicTitle = readProjectDisplayTitle(topic.metadata, topic.name);
    const initTitle = readProjectDisplayTitle(
      initiative.metadata,
      initiative.name,
    );
    try {
      await fileTopicUnderProject(topic.id, initiative.id);
      await reloadPortfolio();
      setUndoToast({
        message: `Filed "${topicTitle}" under ${initTitle}`,
        onUndo: async () => {
          await detachTopicFromProject(topic.id);
          await reloadPortfolio();
        },
      });
    } catch (err) {
      console.error('Failed to file topic:', err);
    }
  };

  const handleDetachTopic = async (
    topic: ProjectPortfolioEntry,
    initiative: ProjectPortfolioEntry,
  ) => {
    const topicTitle = readProjectDisplayTitle(topic.metadata, topic.name);
    const initTitle = readProjectDisplayTitle(
      initiative.metadata,
      initiative.name,
    );
    try {
      await detachTopicFromProject(topic.id);
      await reloadPortfolio();
      setUndoToast({
        message: `Detached "${topicTitle}" from ${initTitle}`,
        onUndo: async () => {
          await fileTopicUnderProject(topic.id, initiative.id);
          await reloadPortfolio();
        },
      });
    } catch (err) {
      console.error('Failed to detach topic:', err);
    }
  };

  const handlePromoteTopic = async (topic: ProjectPortfolioEntry) => {
    const topicTitle = readProjectDisplayTitle(topic.metadata, topic.name);
    try {
      await promoteTopicToInitiative(topic.id);
      await reloadPortfolio();
      setUndoToast({
        message: `Promoted "${topicTitle}" to a project`,
        onUndo: async () => {
          await demoteInitiativeToTopic(topic.id);
          await reloadPortfolio();
        },
      });
    } catch (err) {
      console.error('Failed to promote topic to initiative:', err);
    }
  };

  // Drag & drop handlers
  const handleDragStart = (
    entry: ProjectPortfolioEntry,
    e: React.DragEvent,
  ) => {
    e.dataTransfer.setData('text/plain', entry.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingProject(entry);
  };

  const handleDragOver = (entry: ProjectPortfolioEntry, e: React.DragEvent) => {
    e.preventDefault();
    if (draggingProject && draggingProject.id !== entry.id) {
      e.dataTransfer.dropEffect = 'move';
      if (dragOverProjectId !== entry.id) {
        setDragOverProjectId(entry.id);
      }
    }
  };

  const handleDragLeave = (entry: ProjectPortfolioEntry) => {
    if (dragOverProjectId === entry.id) {
      setDragOverProjectId(null);
    }
  };

  const handleDrop = async (
    destination: ProjectPortfolioEntry,
    e: React.DragEvent,
  ) => {
    e.preventDefault();
    setDragOverProjectId(null);
    if (draggingProject && draggingProject.id !== destination.id) {
      const isTopic = portfolio.radarTopics.some(
        (t) => t.id === draggingProject.id,
      );
      if (isTopic) {
        await handleFileTopic(draggingProject, destination);
      } else {
        setConfirmMergeData({
          source: draggingProject,
          destination,
        });
      }
      setDraggingProject(null);
    }
  };

  // Execute project merge
  const executeMerge = async (
    source: ProjectPortfolioEntry,
    destination: ProjectPortfolioEntry,
  ) => {
    setIsMerging(true);
    const sourceTitle =
      readProjectDisplayTitle(source.metadata, source.name) || source.name;
    const destTitle =
      readProjectDisplayTitle(destination.metadata, destination.name) ||
      destination.name;
    try {
      await mergeProject(source.id, destination.id);
      setConfirmMergeData(null);
      setQuickMergeSource(null);
      await reloadPortfolio();
      setUndoToast({
        message: `Merged ${sourceTitle} into ${destTitle}`,
        onUndo: async () => {
          await restoreProjectMerge(source.id);
          await reloadPortfolio();
        },
      });
    } catch (err) {
      console.error('Failed to merge projects:', err);
    } finally {
      setIsMerging(false);
    }
  };

  const handleUndo = async () => {
    if (!undoToast) return;
    try {
      await undoToast.onUndo();
      setUndoToast(null);
    } catch (err) {
      console.error('Failed to undo action:', err);
    }
  };

  const handleDeleteProject = async (entry: ProjectPortfolioEntry) => {
    const displayTitle = readProjectDisplayTitle(entry.metadata, entry.name);
    const confirmed = window.confirm(
      `Are you sure you want to delete "${displayTitle}"? This will remove this project and its milestones, and cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await deleteEntity(entry.id);
      await reloadPortfolio();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  if (activeId)
    return (
      <ProjectDossier
        projectId={activeId}
        projectName={entries.find((entry) => entry.id === activeId)?.name}
        onBack={() => setActiveId(null)}
        onOpenMeeting={onOpenMeeting}
        onOpenPerson={onOpenPerson}
        relatedWork={entries.filter(
          (entry) =>
            readProjectQualification(entry.metadata)?.parentProjectId ===
            activeId,
        )}
        onOpenRelatedWork={setActiveId}
        mergeCandidates={entries.filter(
          (entry) =>
            readProjectPortfolioDisposition(entry.metadata) !== 'dismissed',
        )}
        onPortfolioChanged={reloadPortfolio}
      />
    );

  const renderRow = (entry: ProjectPortfolioEntry) => {
    const qualification = readProjectQualification(entry.metadata);
    const displayTitle = readProjectDisplayTitle(entry.metadata, entry.name);
    const date = activityDate(entry.last_mentioned_at);
    const currentFocus =
      entry.current_focus || qualification?.outcome || entry.latest_context;
    const monogram = getProjectMonogram(displayTitle);
    const palette = getProjectPalette(entry.name, entry.status);
    const isRecent = isRecentActivity(entry.last_mentioned_at);
    const starred = isEntryStarred(entry);
    const isDragOver = dragOverProjectId === entry.id;
    const isDragging = draggingProject?.id === entry.id;

    return (
      <div
        key={entry.id}
        role="button"
        tabIndex={0}
        data-project-id={entry.id}
        draggable={true}
        onDragStart={(e) => handleDragStart(entry, e)}
        onDragOver={(e) => handleDragOver(entry, e)}
        onDragLeave={() => handleDragLeave(entry)}
        onDrop={(e) => handleDrop(entry, e)}
        onClick={() => setActiveId(entry.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              setActiveId(entry.id);
            }
          }
        }}
        className={`group/row relative flex w-full cursor-pointer items-start gap-4 p-5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pro-accent ${
          isDragOver
            ? 'ring-2 ring-pro-accent bg-pro-accent/15 z-10'
            : isDragging
              ? 'opacity-40 bg-pro-hover/30'
              : 'hover:bg-pro-hover/40'
        }`}
      >
        {/* Leading Editorial Monogram */}
        <div className="relative shrink-0">
          <div
            aria-hidden="true"
            className={`flex h-10 w-10 items-center justify-center rounded-xl border ${palette.border} ${palette.bg} ${palette.text} font-serif text-[13.5px] font-semibold tracking-tight shadow-2xs transition-transform duration-150 group-hover/row:scale-105`}
          >
            {monogram}
          </div>
          {entry.status === 'completed' && (
            <div
              className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500 text-white shadow-2xs"
              title="Completed"
            >
              <CheckCircle2 className="h-2.5 w-2.5 stroke-[2.5]" />
            </div>
          )}
        </div>

        {/* Content Details */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-snug text-pro-text-main transition-colors duration-150 group-hover/row:text-pro-accent tracking-[-0.01em]">
              {displayTitle}
            </h3>

            {entry.status === 'completed' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Completed
              </span>
            )}
            {entry.health_state === 'falling_behind' && (
              <span className="inline-flex items-center rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700 dark:text-rose-300">
                Falling behind
              </span>
            )}
            {entry.health_state === 'watch' && (
              <span className="inline-flex items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                Watch
              </span>
            )}
          </div>

          {currentFocus && (
            <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-pro-text-muted/90 line-clamp-2">
              {currentFocus}
            </p>
          )}

          {entry.recent_change && (
            <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-pro-border/60 bg-pro-surface/70 px-2.5 py-1.5 text-xs text-pro-text-main/90 max-w-fit shadow-2xs">
              <span className="font-semibold text-pro-text-muted shrink-0">
                Since last time:
              </span>
              <span className="line-clamp-1">{entry.recent_change}</span>
            </div>
          )}

          {Boolean(portfolio.initiativeTopics[entry.id]?.length) &&
            (() => {
              const topics = portfolio.initiativeTopics[entry.id];
              const visible = topics.slice(0, 3);
              const overflow = topics.length - visible.length;
              return (
                <div className="mt-2 flex items-baseline gap-1 text-[11.5px] text-pro-text-muted leading-snug flex-wrap">
                  <span className="font-medium shrink-0">Topics:</span>
                  {visible.map((topic, i) => {
                    const tTitle = readProjectDisplayTitle(
                      topic.metadata,
                      topic.name,
                    );
                    return (
                      <span
                        key={topic.id}
                        className="group/chip inline-flex items-baseline gap-0.5"
                      >
                        {i > 0 && (
                          <span className="select-none text-pro-text-muted/40 mx-0.5">
                            ·
                          </span>
                        )}
                        <span
                          className="truncate max-w-[160px] hover:text-pro-text-main transition-colors cursor-default"
                          title={`Constituent topic: ${tTitle}`}
                        >
                          {tTitle}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDetachTopic(topic, entry);
                          }}
                          title={`Detach "${tTitle}" from ${displayTitle}`}
                          aria-label={`Detach ${tTitle}`}
                          className="rounded p-px text-pro-text-muted/30 hover:text-rose-500 dark:hover:text-rose-400 opacity-0 group-hover/chip:opacity-100 transition-all focus:opacity-100"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    );
                  })}
                  {overflow > 0 && (
                    <span className="text-pro-text-muted/60 select-none">
                      <span className="mx-0.5">·</span>+{overflow} more
                    </span>
                  )}
                </div>
              );
            })()}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-pro-text-muted">
            <>
              <span className="inline-flex items-center gap-1.5 font-medium text-[12px]">
                <MessageSquare className="h-3 w-3 text-pro-text-muted/60" />
                {entry.meeting_count} conversation
                {entry.meeting_count === 1 ? '' : 's'}
              </span>
              {Boolean(entry.open_thread_count) && (
                <span className="inline-flex items-center gap-1.5 text-[12px] before:content-['·'] before:mr-1.5 before:text-pro-border">
                  <GitBranch className="h-3 w-3 text-pro-text-muted/60" />
                  {entry.open_thread_count} open thread
                  {entry.open_thread_count === 1 ? '' : 's'}
                </span>
              )}
              {entry.next_milestone && (
                <span className="text-[12px] before:content-['·'] before:mr-1.5 before:text-pro-border">
                  Next: {entry.next_milestone}
                </span>
              )}
            </>
          </div>
        </div>

        {/* Trailing Controls: Date, Merge, Star, Chevron */}
        <div className="flex shrink-0 items-center gap-2.5 self-start pt-1 sm:pt-0.5">
          {entry.activity_state && entry.activity_state !== 'active' ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-stone-500/20 bg-stone-500/5 px-2 py-0.5 text-xs font-medium tabular-nums text-stone-600 dark:text-stone-400"
              title={`Last discussed: ${date ?? 'Unknown'}`}
            >
              <Clock className="h-3 w-3 text-stone-400 shrink-0" />
              {entry.activity_label ?? date}
            </span>
          ) : date ? (
            <span
              className="inline-flex items-center gap-1.5 px-1 py-0.5 text-xs font-medium tabular-nums text-pro-text-muted"
              title={`Last discussed: ${date}`}
            >
              {isRecent ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                  title="Active recently"
                />
              ) : (
                <Clock className="h-3 w-3 text-pro-text-muted/60 shrink-0" />
              )}
              {date}
            </span>
          ) : null}

          {/* Quick Actions */}
          <div className="flex items-center gap-0.5">
            {/* Quick Merge button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setQuickMergeSource(entry);
              }}
              title="Merge with another project…"
              aria-label={`Merge ${displayTitle} with another project`}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-pro-text-muted/40 opacity-0 transition-all hover:bg-pro-hover hover:text-pro-accent group-hover/row:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pro-accent"
            >
              <GitMerge className="h-3.5 w-3.5" />
            </button>

            {/* Star toggle button */}
            <button
              type="button"
              onClick={(e) => void handleToggleStar(entry, e)}
              title={
                starred ? 'Remove from primary focus' : 'Star as primary focus'
              }
              aria-label={
                starred ? `Unstar ${displayTitle}` : `Star ${displayTitle}`
              }
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pro-accent ${
                starred
                  ? 'text-amber-500 hover:scale-110 opacity-100'
                  : 'text-pro-text-muted/30 opacity-0 group-hover/row:opacity-100 hover:text-amber-500 hover:scale-110 focus:opacity-100'
              }`}
            >
              <Star
                className={`h-4 w-4 ${
                  starred
                    ? 'fill-amber-400 text-amber-500 drop-shadow-xs'
                    : 'text-current'
                }`}
              />
            </button>

            {/* Quick Delete button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleDeleteProject(entry);
              }}
              title="Delete project"
              aria-label={`Delete ${displayTitle}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-pro-text-muted/40 opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 group-hover/row:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <ChevronRight
            aria-hidden="true"
            className="h-4 w-4 text-pro-text-muted/40 transition-all duration-150 group-hover/row:translate-x-1 group-hover/row:text-pro-accent"
          />
        </div>

        {/* Visual drop indicator overlay */}
        {isDragOver && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 py-1 bg-pro-accent text-white text-center text-[11px] font-semibold tracking-wide shadow-sm">
            {draggingProject &&
            portfolio.radarTopics.some((t) => t.id === draggingProject.id)
              ? `Drop to file "${readProjectDisplayTitle(
                  draggingProject.metadata,
                  draggingProject.name,
                )}" into ${displayTitle}`
              : `Drop to merge into ${displayTitle}`}
          </div>
        )}
      </div>
    );
  };

  const renderRadarTopicRow = (topic: ProjectPortfolioEntry) => {
    const displayTitle = readProjectDisplayTitle(topic.metadata, topic.name);
    const date = activityDate(topic.last_mentioned_at);
    const isMenuOpen = fileUnderMenuTopicId === topic.id;
    const isDragging = draggingProject?.id === topic.id;

    return (
      <div
        key={topic.id}
        role="button"
        tabIndex={0}
        data-project-id={topic.id}
        draggable={true}
        onDragStart={(e) => handleDragStart(topic, e)}
        onClick={() => setActiveId(topic.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              setActiveId(topic.id);
            }
          }
        }}
        className={`group/topic relative flex w-full cursor-grab active:cursor-grabbing items-center justify-between gap-4 p-3.5 text-left transition-all duration-150 hover:bg-pro-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pro-accent ${
          isDragging ? 'opacity-40 bg-pro-hover/30' : ''
        }`}
      >
        <div className="flex min-w-0 items-center gap-3 flex-1">
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-pro-border/70 bg-pro-surface text-pro-text-muted"
          >
            <Hash className="h-3.5 w-3.5 text-pro-text-muted/80" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-pro-text-main group-hover/topic:text-pro-accent truncate transition-colors">
                {displayTitle}
              </h3>
              {topic.meeting_count > 0 ? (
                <span className="shrink-0 rounded-full border border-pro-border/60 bg-pro-surface/70 px-1.5 py-0.2 text-[10px] font-medium text-pro-text-muted">
                  {topic.meeting_count} call
                  {topic.meeting_count === 1 ? '' : 's'}
                </span>
              ) : (
                <span className="shrink-0 rounded-full border border-pro-border/50 bg-pro-surface/50 px-1.5 py-0.2 text-[10px] font-medium text-pro-text-muted/80">
                  Reference
                </span>
              )}
              {topic.meeting_count >= 2 && (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-pro-accent/30 bg-pro-accent/10 px-1.5 py-0.2 text-[10px] font-medium text-pro-accent">
                  Suggested initiative
                </span>
              )}
              {topic.activity_state && topic.activity_state !== 'active' && (
                <span className="shrink-0 rounded-full border border-stone-500/20 bg-stone-500/5 px-1.5 py-0.2 text-[10px] font-medium text-stone-500">
                  {topic.activity_label}
                </span>
              )}
            </div>
            {topic.latest_context && (
              <p className="mt-0.5 text-[11.5px] text-pro-text-muted line-clamp-1 max-w-[65ch]">
                {topic.latest_context}
              </p>
            )}
          </div>
        </div>

        <div
          className={`flex shrink-0 items-center gap-2 transition-opacity duration-100 ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover/topic:opacity-100 focus-within:opacity-100'}`}
        >
          {date && (
            <span className="text-[11px] tabular-nums text-pro-text-muted hidden sm:inline-block mr-0.5">
              {date}
            </span>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handlePromoteTopic(topic);
            }}
            title="Promote to standalone initiative"
            aria-label={`Make ${displayTitle} a project`}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all shadow-2xs ${
              topic.meeting_count >= 2
                ? 'border-pro-accent/40 bg-pro-accent/10 text-pro-accent hover:bg-pro-accent hover:text-white'
                : 'border-pro-border/70 bg-pro-surface text-pro-text-main hover:border-pro-accent/60 hover:text-pro-accent'
            }`}
          >
            <FolderPlus className="h-3 w-3" />
            <span>Make project</span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFileUnderMenuTopicId(isMenuOpen ? null : topic.id);
              }}
              title="File under an active initiative"
              aria-label={`File ${displayTitle} under an initiative`}
              aria-expanded={isMenuOpen}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                isMenuOpen
                  ? 'border-pro-accent bg-pro-accent text-white shadow-xs'
                  : 'border-pro-border/70 bg-pro-surface text-pro-text-main hover:border-pro-accent/60 hover:text-pro-accent shadow-2xs'
              }`}
            >
              <Layers className="h-3 w-3" />
              <span>File under…</span>
            </button>

            {isMenuOpen && (
              <div
                role="menu"
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setFileUnderMenuTopicId(null);
                  }
                }}
                className="absolute right-0 top-full mt-1.5 z-40 w-64 rounded-xl border border-pro-border bg-pro-bg p-1.5 shadow-2xl backdrop-blur-md"
              >
                <button
                  type="button"
                  onClick={() => {
                    setFileUnderMenuTopicId(null);
                    void handlePromoteTopic(topic);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-xs font-medium text-pro-accent hover:bg-pro-accent/10 transition-colors"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-pro-accent/30 bg-pro-accent/15 text-pro-accent">
                    <FolderPlus className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-pro-text-main">
                      Promote to project
                    </div>
                    <div className="text-[10px] text-pro-text-muted truncate">
                      Make this a standalone initiative
                    </div>
                  </div>
                </button>

                <div className="my-1 border-t border-pro-border/50" />

                <div className="px-2 py-1.5 text-[11px] font-semibold text-pro-text-muted border-b border-pro-border/50 mb-1">
                  File under initiative:
                </div>
                <div className="max-h-52 overflow-y-auto space-y-0.5">
                  {portfolio.current.length === 0 ? (
                    <p className="p-2 text-xs text-pro-text-muted text-center">
                      No active initiatives available
                    </p>
                  ) : (
                    portfolio.current.map((init) => {
                      const initTitle = readProjectDisplayTitle(
                        init.metadata,
                        init.name,
                      );
                      const monogram = getProjectMonogram(initTitle);
                      const palette = getProjectPalette(init.name, init.status);
                      return (
                        <button
                          key={init.id}
                          type="button"
                          onClick={() => {
                            setFileUnderMenuTopicId(null);
                            void handleFileTopic(topic, init);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-xs text-pro-text-main hover:bg-pro-hover/60 transition-colors"
                        >
                          <div
                            aria-hidden="true"
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border ${palette.border} ${palette.bg} ${palette.text} font-serif text-[10px] font-semibold`}
                          >
                            {monogram}
                          </div>
                          <span className="truncate flex-1 font-medium">
                            {initTitle}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const showPrimarySection =
    (filter === 'all' || filter === 'primary' || filter === 'current') &&
    starredProjects.length > 0;

  const showSideSection =
    (filter === 'all' || filter === 'side' || filter === 'current') &&
    sideProjects.length > 0;

  const showCurrentAllSection =
    (filter === 'all' || filter === 'current') &&
    starredProjects.length === 0 &&
    portfolio.current.length > 0;

  const showTopicRadarSection =
    (filter === 'all' || filter === 'topics' || filter === 'other') &&
    portfolio.radarTopics.length > 0;

  const showCompletedSection =
    (filter === 'all' || filter === 'completed') &&
    portfolio.completed.length > 0;

  return (
    <div data-testid="projects-briefing" className="max-w-4xl mx-auto pb-24">
      <PageHeader title="Projects" className="mb-6">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-64 items-center rounded-lg border border-pro-border/70 bg-pro-surface text-pro-text-muted transition-all duration-150 focus-within:w-72 focus-within:border-pro-accent focus-within:ring-2 focus-within:ring-pro-accent/20">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 h-4 w-4 text-pro-text-muted/70"
            />
            <input
              aria-label="Search projects and discussed work"
              placeholder="Search projects…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-full w-full bg-transparent pl-9 pr-8 text-[13px] text-pro-text-main outline-none placeholder:text-pro-text-muted"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 rounded p-0.5 text-pro-text-muted hover:text-pro-text-main"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </PageHeader>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[14.5px] font-semibold text-pro-text-main">
            {portfolio.current.length} project
            {portfolio.current.length === 1 ? '' : 's'}
            {portfolio.radarTopics.length > 0 && (
              <span className="font-normal text-pro-text-muted/70 text-sm ml-2">
                · {portfolio.radarTopics.length} on radar
              </span>
            )}
          </p>
        </div>

        {/* Filter Navigation */}
        <nav
          aria-label="Portfolio filters"
          className="inline-flex items-center rounded-xl border border-pro-border/70 bg-pro-surface/60 p-1 shadow-2xs backdrop-blur-xs gap-1 overflow-x-auto max-w-full"
        >
          <button
            type="button"
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg px-2.5 py-1 text-xs transition-all duration-150 ${
              filter === 'all'
                ? 'bg-white dark:bg-zinc-800 text-pro-text-main font-semibold shadow-xs'
                : 'text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover/40 font-medium'
            }`}
          >
            <span>All</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-semibold transition-colors ${
                filter === 'all'
                  ? 'bg-pro-accent/15 text-pro-accent'
                  : 'bg-pro-surface text-pro-text-muted border border-pro-border/40'
              }`}
            >
              {totalCount}
            </span>
          </button>

          {starredProjects.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setFilter('primary')}
                aria-pressed={filter === 'primary'}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg px-2.5 py-1 text-xs transition-all duration-150 ${
                  filter === 'primary'
                    ? 'bg-white dark:bg-zinc-800 text-amber-700 dark:text-amber-300 font-semibold shadow-xs'
                    : 'text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover/40 font-medium'
                }`}
              >
                <span>Primary</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-semibold transition-colors ${
                    filter === 'primary'
                      ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                      : 'bg-pro-surface text-pro-text-muted border border-pro-border/40'
                  }`}
                >
                  {starredProjects.length}
                </span>
              </button>

              {sideProjects.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter('side')}
                  aria-pressed={filter === 'side'}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg px-2.5 py-1 text-xs transition-all duration-150 ${
                    filter === 'side'
                      ? 'bg-white dark:bg-zinc-800 text-pro-text-main font-semibold shadow-xs'
                      : 'text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover/40 font-medium'
                  }`}
                >
                  <span>Other initiatives</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-semibold transition-colors ${
                      filter === 'side'
                        ? 'bg-pro-accent/15 text-pro-accent'
                        : 'bg-pro-surface text-pro-text-muted border border-pro-border/40'
                    }`}
                  >
                    {sideProjects.length}
                  </span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setFilter('current')}
              aria-pressed={filter === 'current'}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg px-2.5 py-1 text-xs transition-all duration-150 ${
                filter === 'current'
                  ? 'bg-white dark:bg-zinc-800 text-pro-text-main font-semibold shadow-xs'
                  : 'text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover/40 font-medium'
              }`}
            >
              <span>Themes</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-semibold transition-colors ${
                  filter === 'current'
                    ? 'bg-pro-accent/15 text-pro-accent'
                    : 'bg-pro-surface text-pro-text-muted border border-pro-border/40'
                }`}
              >
                {portfolio.current.length}
              </span>
            </button>
          )}

          {portfolio.radarTopics.length > 0 && (
            <button
              type="button"
              onClick={() => setFilter('topics')}
              aria-pressed={filter === 'topics'}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg px-2.5 py-1 text-xs transition-all duration-150 ${
                filter === 'topics' || filter === 'other'
                  ? 'bg-white dark:bg-zinc-800 text-pro-accent font-semibold shadow-xs'
                  : 'text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover/40 font-medium'
              }`}
            >
              <span>Topics</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-semibold transition-colors ${
                  filter === 'topics' || filter === 'other'
                    ? 'bg-pro-accent/15 text-pro-accent'
                    : 'bg-pro-surface text-pro-text-muted border border-pro-border/40'
                }`}
              >
                {portfolio.radarTopics.length}
              </span>
            </button>
          )}

          {portfolio.completed.length > 0 && (
            <button
              type="button"
              onClick={() => setFilter('completed')}
              aria-pressed={filter === 'completed'}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg px-2.5 py-1 text-xs transition-all duration-150 ${
                filter === 'completed'
                  ? 'bg-white dark:bg-zinc-800 text-emerald-700 dark:text-emerald-300 font-semibold shadow-xs'
                  : 'text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover/40 font-medium'
              }`}
            >
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              <span>Completed</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-semibold transition-colors ${
                  filter === 'completed'
                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                    : 'bg-pro-surface text-pro-text-muted border border-pro-border/40'
                }`}
              >
                {portfolio.completed.length}
              </span>
            </button>
          )}
        </nav>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-pro-border bg-pro-surface/80 px-4 py-3 text-sm text-pro-text-muted"
        >
          <span>
            Pluto couldn’t refresh project context. Your saved information is
            unchanged.
          </span>
          <button
            type="button"
            onClick={retry}
            className="shrink-0 font-medium text-pro-accent underline underline-offset-4 hover:opacity-80"
          >
            Retry refresh
          </button>
        </div>
      )}

      {loading ? (
        <div
          aria-label="Loading projects"
          className="overflow-hidden rounded-xl border border-pro-border/60 bg-pro-surface/30 divide-y divide-pro-border/40"
        >
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="flex items-start gap-4 p-4 animate-pulse"
            >
              <div className="h-10 w-10 rounded-xl bg-pro-hover/70" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-4 w-1/3 rounded bg-pro-hover/70" />
                <div className="h-3 w-2/3 rounded bg-pro-hover/50" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* PRIMARY FOCUS SECTION */}
          {showPrimarySection && (
            <section aria-labelledby="primary-focus-heading" className="mb-12">
              <div className="mb-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                  <h2
                    id="primary-focus-heading"
                    className="text-sm font-semibold text-pro-text-main"
                  >
                    Primary focus
                  </h2>
                  <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    {starredProjects.length} active
                  </span>
                </div>
              </div>
              <div
                data-testid="current-projects"
                className="overflow-hidden rounded-xl border border-pro-border/60 bg-pro-surface/30 divide-y divide-pro-border/40 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
              >
                {starredProjects.map((entry) => renderRow(entry))}
              </div>
            </section>
          )}

          {/* ALL THEMES SECTION (When none starred yet) */}
          {showCurrentAllSection && activeSideProjects.length > 0 && (
            <section
              data-testid="current-projects"
              aria-label="Current projects"
              className="mb-12"
            >
              <div className="overflow-hidden rounded-xl border border-pro-border/60 bg-pro-surface/30 divide-y divide-pro-border/40 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                {activeSideProjects.map((entry) => renderRow(entry))}
              </div>
            </section>
          )}

          {/* ACTIVE INITIATIVES SECTION (When starred projects exist) */}
          {showSideSection &&
            !showCurrentAllSection &&
            activeSideProjects.length > 0 && (
              <section
                aria-labelledby="other-initiatives-heading"
                className="mb-12"
              >
                <div className="mb-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2
                      id="other-initiatives-heading"
                      className="text-sm font-semibold text-pro-text-main"
                    >
                      Active initiatives
                    </h2>
                    <span className="rounded-full border border-pro-border/60 bg-pro-surface px-2 py-0.5 text-[11px] font-medium text-pro-text-muted">
                      {activeSideProjects.length}
                    </span>
                  </div>
                </div>
                <div className="overflow-hidden rounded-xl border border-pro-border/60 bg-pro-surface/30 divide-y divide-pro-border/40 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  {activeSideProjects.map((entry) => renderRow(entry))}
                </div>
              </section>
            )}

          {/* DORMANT INITIATIVES SECTION (Untouched for >30 days) */}
          {(showSideSection || showCurrentAllSection) &&
            dormantProjects.length > 0 && (
              <details
                data-testid="dormant-projects"
                className="group/dormant mb-12 rounded-xl border border-pro-border/60 bg-pro-surface/20 transition-colors"
                open={search ? true : undefined}
              >
                <summary className="flex cursor-pointer select-none items-center justify-between p-4 text-xs font-semibold text-pro-text-muted hover:text-pro-text-main list-none [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2">
                    <ChevronRight className="h-3.5 w-3.5 text-pro-text-muted/60 transition-transform duration-200 group-open/dormant:rotate-90" />
                    <span>Dormant initiatives</span>
                    <span className="rounded-full border border-stone-500/20 bg-stone-500/10 px-2 py-0.5 text-[10.5px] font-medium text-stone-600 dark:text-stone-400">
                      {dormantProjects.length} dormant
                    </span>
                  </div>
                  <span className="text-[11px] font-normal text-pro-text-muted/70">
                    Untouched for over 30 days
                  </span>
                </summary>
                <div className="border-t border-pro-border/40 divide-y divide-pro-border/40">
                  {dormantProjects.map((entry) => renderRow(entry))}
                </div>
              </details>
            )}

          {portfolio.current.length === 0 &&
            ['all', 'current', 'primary', 'side'].includes(filter) && (
              <div className="rounded-xl border border-pro-border/50 bg-pro-surface/20 px-6 py-12 text-center mb-10">
                <h2 className="font-serif text-xl text-pro-text-main">
                  {search
                    ? 'No matching focus themes'
                    : 'No durable themes established yet'}
                </h2>
                <p className="mx-auto mt-3 max-w-[58ch] text-sm leading-relaxed text-pro-text-muted">
                  {search
                    ? 'Suggestions and discussed work remain searchable below.'
                    : 'Pluto keeps one-off plans and topics out of your portfolio until another conversation reinforces them or you confirm them.'}
                </p>
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-pro-border px-3 py-1.5 text-xs font-medium text-pro-text-main hover:bg-pro-hover"
                  >
                    Clear search
                  </button>
                )}
              </div>
            )}

          {/* DISCUSSED TOPICS RADAR / WORK */}
          {showTopicRadarSection && (
            <details
              data-testid="topic-radar"
              className="group/details mt-12 border-t border-pro-border/40 pt-6"
              open={
                search || filter === 'topics' || filter === 'other'
                  ? true
                  : undefined
              }
            >
              <summary className="flex cursor-pointer select-none items-center justify-between rounded-lg py-1.5 text-[13px] font-medium text-pro-text-muted hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent [&::-webkit-details-marker]:hidden list-none">
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-pro-text-muted/70 transition-transform duration-200 group-open/details:rotate-90" />
                  <span
                    id="topic-radar-heading"
                    className="font-semibold text-pro-text-main text-sm"
                  >
                    Discussed work &amp; topics
                  </span>
                  <span className="rounded-full border border-pro-border/60 bg-pro-surface px-2 py-0.5 text-[11px] font-medium text-pro-text-muted">
                    {portfolio.radarTopics.length}
                  </span>
                </div>
                {staleRadarTopics.length > 0 && (
                  <button
                    type="button"
                    disabled={isSweeping}
                    onClick={handleSweepStaleTopics}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-pro-border/80 bg-pro-surface px-2.5 py-1 text-xs font-medium text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-50"
                    title="Archive topics with only 1 meeting and no activity in over 45 days"
                  >
                    <Sparkles className="h-3 w-3 text-amber-500" />
                    <span>
                      {isSweeping
                        ? 'Archiving…'
                        : `Sweep ${staleRadarTopics.length} stale (>45d)`}
                    </span>
                  </button>
                )}
              </summary>
              <p className="mt-2.5 max-w-[68ch] text-xs leading-relaxed text-pro-text-muted">
                Topics stay here until there’s enough context to connect them to
                a project. You can also file them yourself.
              </p>
              <div className="mt-3 overflow-visible rounded-xl border border-pro-border/60 bg-pro-surface/25 divide-y divide-pro-border/40 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                {portfolio.radarTopics.map(renderRadarTopicRow)}
              </div>
            </details>
          )}

          {!loadError &&
            (synthesisState === 'failed' ||
              synthesisState === 'incomplete') && (
              <div
                className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-pro-text-muted"
                aria-live="polite"
              >
                <span>Some project updates couldn’t finish.</span>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="shrink-0 rounded px-2 py-1 font-medium text-pro-accent underline underline-offset-4 hover:bg-pro-hover"
                    onClick={retry}
                  >
                    Retry updates
                  </button>
                  <ReportProblemButton
                    area="project_themes"
                    className="min-h-9 rounded px-2 py-1 font-medium text-pro-text-muted underline underline-offset-4 hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                  />
                </div>
              </div>
            )}

          {showCompletedSection && (
            <details
              className="group/details mt-8 border-t border-pro-border/40 pt-5"
              open={search || filter === 'completed' ? true : undefined}
            >
              <summary className="flex cursor-pointer select-none items-center justify-between rounded-lg py-1.5 text-[13px] font-medium text-pro-text-muted hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent [&::-webkit-details-marker]:hidden list-none">
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-pro-text-muted/70 transition-transform duration-200 group-open/details:rotate-90" />
                  <span>Completed projects</span>
                  <span className="rounded-full border border-pro-border/60 bg-pro-surface px-2 py-0.5 text-[11px] font-medium text-pro-text-muted">
                    {portfolio.completed.length}
                  </span>
                </div>
              </summary>
              <div className="mt-3 overflow-hidden rounded-xl border border-pro-border/60 bg-pro-surface/30 divide-y divide-pro-border/40 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                {portfolio.completed.map((entry) => renderRow(entry))}
              </div>
            </details>
          )}
        </>
      )}

      <ProjectCommitments />

      {/* QUICK MERGE MODAL */}
      {quickMergeSource && (
        <QuickMergeModal
          source={quickMergeSource}
          candidates={entries.filter(
            (e) => readProjectPortfolioDisposition(e.metadata) !== 'dismissed',
          )}
          onMerge={executeMerge}
          onClose={() => setQuickMergeSource(null)}
          isMerging={isMerging}
        />
      )}

      {/* DRAG-AND-DROP MERGE CONFIRMATION MODAL */}
      {confirmMergeData && (
        <MergeConfirmModal
          source={confirmMergeData.source}
          destination={confirmMergeData.destination}
          onConfirm={() =>
            executeMerge(confirmMergeData.source, confirmMergeData.destination)
          }
          onCancel={() => setConfirmMergeData(null)}
          isMerging={isMerging}
        />
      )}

      {/* UNDO TOAST */}
      {undoToast && (
        <UndoToast
          toast={undoToast}
          onUndo={handleUndo}
          onDismiss={() => setUndoToast(null)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-components: QuickMergeModal, MergeConfirmModal, UndoToast
// -----------------------------------------------------------------------------

function QuickMergeModal({
  source,
  candidates,
  onMerge,
  onClose,
  isMerging,
}: {
  source: ProjectPortfolioEntry;
  candidates: ProjectPortfolioEntry[];
  onMerge: (
    source: ProjectPortfolioEntry,
    destination: ProjectPortfolioEntry,
  ) => void;
  onClose: () => void;
  isMerging: boolean;
}) {
  const [search, setSearch] = useState('');
  const [selectedCandidate, setSelectedCandidate] =
    useState<ProjectPortfolioEntry | null>(null);
  const [direction, setDirection] = useState<
    'source_into_target' | 'target_into_source'
  >('source_into_target');

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const eligibleCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates
      .filter((c) => c.id !== source.id)
      .filter((c) => {
        if (!q) return true;
        const title = readProjectDisplayTitle(c.metadata, c.name).toLowerCase();
        return title.includes(q) || c.name.toLowerCase().includes(q);
      });
  }, [candidates, source.id, search]);

  const sourceTitle = readProjectDisplayTitle(source.metadata, source.name);
  const effectiveSource =
    direction === 'source_into_target' ? source : selectedCandidate;
  const effectiveTarget =
    direction === 'source_into_target' ? selectedCandidate : source;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-merge-title"
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-pro-border bg-pro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-pro-border/70 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pro-accent/10 text-pro-accent">
              <GitMerge className="h-4 w-4" />
            </div>
            <div>
              <h3
                id="quick-merge-title"
                className="text-sm font-semibold text-pro-text-main"
              >
                Quick Merge Project
              </h3>
              <p className="text-xs text-pro-text-muted truncate max-w-[320px]">
                {sourceTitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Direction toggle */}
          <div className="flex rounded-lg border border-pro-border/70 bg-pro-surface/50 p-1 text-xs">
            <button
              type="button"
              onClick={() => setDirection('source_into_target')}
              className={`flex-1 rounded-md py-1.5 font-medium transition-all ${
                direction === 'source_into_target'
                  ? 'bg-white dark:bg-zinc-800 text-pro-text-main shadow-xs'
                  : 'text-pro-text-muted hover:text-pro-text-main'
              }`}
            >
              Merge this into another
            </button>
            <button
              type="button"
              onClick={() => setDirection('target_into_source')}
              className={`flex-1 rounded-md py-1.5 font-medium transition-all ${
                direction === 'target_into_source'
                  ? 'bg-white dark:bg-zinc-800 text-pro-text-main shadow-xs'
                  : 'text-pro-text-muted hover:text-pro-text-main'
              }`}
            >
              Merge another into this
            </button>
          </div>

          {/* Search box */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-pro-text-muted/60" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search candidate project to merge…"
              className="w-full rounded-lg border border-pro-border/80 bg-pro-surface/40 py-2 pl-9 pr-4 text-xs text-pro-text-main placeholder:text-pro-text-muted outline-none focus:border-pro-accent focus:ring-2 focus:ring-pro-accent/20"
            />
          </div>

          {/* Candidate list */}
          <div className="max-h-56 overflow-y-auto divide-y divide-pro-border/30 rounded-xl border border-pro-border/60 bg-pro-surface/20">
            {eligibleCandidates.length === 0 ? (
              <p className="p-4 text-center text-xs text-pro-text-muted">
                No matching projects found
              </p>
            ) : (
              eligibleCandidates.map((candidate) => {
                const cTitle = readProjectDisplayTitle(
                  candidate.metadata,
                  candidate.name,
                );
                const isSelected = selectedCandidate?.id === candidate.id;
                const cMonogram = getProjectMonogram(cTitle);
                const cPalette = getProjectPalette(
                  candidate.name,
                  candidate.status,
                );

                return (
                  <button
                    type="button"
                    key={candidate.id}
                    onClick={() => setSelectedCandidate(candidate)}
                    className={`flex w-full items-center gap-3 p-3 text-left transition-colors ${
                      isSelected
                        ? 'bg-pro-accent/10 text-pro-accent'
                        : 'hover:bg-pro-hover/50 text-pro-text-main'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${cPalette.border} ${cPalette.bg} ${cPalette.text} font-serif text-xs font-semibold`}
                    >
                      {cMonogram}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{cTitle}</p>
                      <p className="text-[11px] text-pro-text-muted">
                        {candidate.meeting_count} conversation
                        {candidate.meeting_count === 1 ? '' : 's'}
                      </p>
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="h-4 w-4 text-pro-accent shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Preview banner */}
          {selectedCandidate && effectiveSource && effectiveTarget && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-pro-text-main/90">
              <p className="font-semibold text-amber-800 dark:text-amber-300 mb-1">
                Summary of consolidation:
              </p>
              <p className="text-pro-text-muted leading-relaxed">
                All meetings, notes, context, and action items from{' '}
                <strong className="text-pro-text-main">
                  {readProjectDisplayTitle(
                    effectiveSource.metadata,
                    effectiveSource.name,
                  )}
                </strong>{' '}
                will be merged into{' '}
                <strong className="text-pro-text-main">
                  {readProjectDisplayTitle(
                    effectiveTarget.metadata,
                    effectiveTarget.name,
                  )}
                </strong>
                .
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-pro-border/70 px-5 py-3.5 bg-pro-surface/30">
          <button
            type="button"
            onClick={onClose}
            disabled={isMerging}
            className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedCandidate || isMerging}
            onClick={() => {
              if (effectiveSource && effectiveTarget) {
                onMerge(effectiveSource, effectiveTarget);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-pro-accent px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-pro-accent/90 disabled:opacity-40"
          >
            <GitMerge className="h-3.5 w-3.5" />
            {isMerging ? 'Merging…' : 'Confirm Merge'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MergeConfirmModal({
  source,
  destination,
  onConfirm,
  onCancel,
  isMerging,
}: {
  source: ProjectPortfolioEntry;
  destination: ProjectPortfolioEntry;
  onConfirm: () => void;
  onCancel: () => void;
  isMerging: boolean;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const sourceTitle = readProjectDisplayTitle(source.metadata, source.name);
  const destTitle = readProjectDisplayTitle(
    destination.metadata,
    destination.name,
  );
  const sourceMonogram = getProjectMonogram(sourceTitle);
  const destMonogram = getProjectMonogram(destTitle);
  const sourcePalette = getProjectPalette(source.name, source.status);
  const destPalette = getProjectPalette(destination.name, destination.status);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-confirm-title"
      onClick={onCancel}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-pro-border bg-pro-bg shadow-2xl"
      >
        <div className="border-b border-pro-border/70 px-5 py-4">
          <h3
            id="merge-confirm-title"
            className="text-sm font-semibold text-pro-text-main flex items-center gap-2"
          >
            <GitMerge className="h-4 w-4 text-pro-accent" />
            Confirm Project Merge
          </h3>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            {/* Source */}
            <div className="flex-1 rounded-xl border border-pro-border/70 bg-pro-surface/50 p-3 text-center">
              <div
                className={`mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg border ${sourcePalette.border} ${sourcePalette.bg} ${sourcePalette.text} font-serif text-xs font-semibold`}
              >
                {sourceMonogram}
              </div>
              <p className="text-xs font-medium text-pro-text-main line-clamp-1">
                {sourceTitle}
              </p>
              <p className="text-[11px] text-pro-text-muted mt-0.5">
                {source.meeting_count} meeting
                {source.meeting_count === 1 ? '' : 's'}
              </p>
              <span className="mt-1.5 inline-block text-[10px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-400">
                Source
              </span>
            </div>

            <div className="text-pro-text-muted flex flex-col items-center">
              <ArrowRight className="h-5 w-5" />
            </div>

            {/* Destination */}
            <div className="flex-1 rounded-xl border border-pro-accent/30 bg-pro-accent/5 p-3 text-center">
              <div
                className={`mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg border ${destPalette.border} ${destPalette.bg} ${destPalette.text} font-serif text-xs font-semibold`}
              >
                {destMonogram}
              </div>
              <p className="text-xs font-medium text-pro-text-main line-clamp-1">
                {destTitle}
              </p>
              <p className="text-[11px] text-pro-text-muted mt-0.5">
                {destination.meeting_count} meeting
                {destination.meeting_count === 1 ? '' : 's'}
              </p>
              <span className="mt-1.5 inline-block text-[10px] uppercase tracking-wider font-semibold text-pro-accent">
                Destination
              </span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-pro-text-muted bg-pro-surface/40 p-3 rounded-lg border border-pro-border/50">
            All meetings, context, and commitments from{' '}
            <strong className="text-pro-text-main">{sourceTitle}</strong> will
            be consolidated into{' '}
            <strong className="text-pro-text-main">{destTitle}</strong>. You can
            undo this action immediately after.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-pro-border/70 px-5 py-3.5 bg-pro-surface/30">
          <button
            type="button"
            onClick={onCancel}
            disabled={isMerging}
            className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isMerging}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-pro-accent px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-pro-accent/90 disabled:opacity-40"
          >
            <GitMerge className="h-3.5 w-3.5" />
            {isMerging ? 'Merging…' : `Merge into ${destTitle}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function UndoToast({
  toast,
  onUndo,
  onDismiss,
}: {
  toast: { message: string };
  onUndo: () => void;
  onDismiss: () => void;
}) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <aside
      aria-label="Notification"
      className="fixed bottom-6 right-6 z-[1000] flex items-center gap-3 rounded-xl border border-pro-border/80 bg-pro-surface/95 px-4 py-3 shadow-2xl backdrop-blur-md text-xs text-pro-text-main max-w-md"
    >
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="truncate">{toast.message}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1 rounded-md bg-pro-accent/10 px-2.5 py-1 font-semibold text-pro-accent hover:bg-pro-accent/20 transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Undo
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-1 text-pro-text-muted hover:text-pro-text-main"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </aside>,
    document.body,
  );
}
