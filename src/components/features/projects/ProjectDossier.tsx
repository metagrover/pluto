import {
  Activity,
  Calendar,
  Check,
  ChevronRight,
  Layers,
  MoreHorizontal,
  Pencil,
  Repeat2,
  Star,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  detachTopicFromProject,
  getProjectBrief,
  mergeProject,
  restoreProjectMerge,
  setProjectPortfolioDisposition,
  triggerDreamingNow,
  updateProjectDisplayTitle,
  upsertEntity,
} from '../../../api/knowledgeGraph';
import {
  DREAMING_STATUS_LABEL,
  type DreamingUiStatus,
} from '../../../utils/dreamingStatus';
import {
  type ProjectBrief,
  cleanPersonRole,
} from '../../../utils/projectBriefing';
import { detectProjectCadence } from '../../../utils/projectCadence';
import {
  type ProjectPortfolioEntry,
  getProjectActivityState,
  isProjectStarred,
  readProjectCadence,
} from '../../../utils/projectPortfolio';
import { readProjectQualification } from '../../../utils/projectQualification';
import { SearchSelect } from '../../ui/SearchSelect';
import { ProjectMilestones } from './ProjectMilestones';

interface ProjectDossierProps {
  projectId: string;
  projectName?: string;
  onBack: () => void;
  onOpenMeeting?: (id: string) => void;
  onOpenPerson?: (id: string) => void;
  relatedWork?: ProjectPortfolioEntry[];
  onOpenRelatedWork?: (id: string) => void;
  mergeCandidates?: ProjectPortfolioEntry[];
  onPortfolioChanged?: () => void | Promise<void>;
}

const quietButton =
  'inline-flex min-h-10 items-center gap-2 rounded px-2 text-sm text-pro-text-muted transition-colors hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-50';

const formatDate = (value: string | null | undefined): string => {
  const date = value ? new Date(value) : null;
  return !date || Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
};

const normalizeProjectCopy = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .toLocaleLowerCase();

const getPersonInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')
    .toLocaleUpperCase();

const getPersonFunctionTag = (role: string | undefined): string | null => {
  const normalized = role?.trim().toLocaleLowerCase();
  if (!normalized) return null;
  if (/\b(?:project|program|programme)\s+lead(?:er)?\b/.test(normalized))
    return 'Project lead';
  if (/\b(?:executive|exec|project)\s+sponsor\b/.test(normalized))
    return 'Executive sponsor';
  if (
    /\b(?:project|program|programme)\s+(?:manager|management|director)\b|\bpmo\b/.test(
      normalized,
    )
  )
    return 'Project management';
  if (
    /\b(?:ai|engineer|engineering|developer|machine learning|software|technical|technology|data)\b/.test(
      normalized,
    )
  )
    return 'Engineering';
  if (/\b(?:product|product management)\b/.test(normalized)) return 'Product';
  if (/\b(?:design|designer|ux|user research)\b/.test(normalized))
    return 'Design';
  if (/\b(?:marketing|growth|communications?)\b/.test(normalized))
    return 'Marketing';
  if (/\b(?:sales|account executive|business development)\b/.test(normalized))
    return 'Sales';
  if (/\b(?:operations|ops)\b/.test(normalized)) return 'Operations';
  if (/\b(?:finance|accounting)\b/.test(normalized)) return 'Finance';
  if (/\b(?:people|human resources|talent)\b/.test(normalized)) return 'People';
  if (/\b(?:legal|counsel)\b/.test(normalized)) return 'Legal';
  return null;
};

const healthTone: Record<ProjectBrief['health']['state'], string> = {
  appears_on_track: 'text-pro-success',
  watch: 'text-pro-warning',
  falling_behind: 'text-pro-urgent',
  not_enough_evidence: 'text-pro-text-muted',
};

interface ProjectMovingPiece {
  id: string;
  text: string;
}

const synthesizeMovingPieceFromContext = (raw: string): string => {
  let cleaned = raw.trim();
  const hasSpeaker = /^[A-Za-z0-9_\s.'-]+:\s*/.test(cleaned);
  // Strip speaker label prefixes
  cleaned = cleaned.replace(/^[A-Za-z0-9_\s.'-]+:\s*/, '');
  // Strip surrounding quotes
  cleaned = cleaned.replace(/^["'“](.*)["'”]$/, '$1').trim();

  // Check if this is an informal/conversational quote that needs synthesis
  const isConversationalQuote =
    hasSpeaker ||
    /^(?:but|and|so|well|yeah|yes|ok|okay|hey|oh|i think|we discussed that|i made|we made|i've|we've)\s+/i.test(
      cleaned,
    ) ||
    /\b(?:sitting in|discussed yesterday|br main)\b/i.test(cleaned);

  if (isConversationalQuote) {
    // Pattern: UI changes on branch
    if (
      /\b(?:ui\s+changes?|frontend|interface)\b/i.test(cleaned) &&
      /\b(?:branch|main|repo|pr)\b/i.test(cleaned)
    ) {
      return 'UI changes implemented and integrated into main branch for review.';
    }

    // Conversational to declarative transformation
    cleaned = cleaned
      .replace(/^(?:but|and|so|well|yeah|yes|ok|okay|hey|oh)\s+/i, '')
      .replace(
        /^(?:i think|i guess|i believe|we discussed that|as discussed)\s+/i,
        '',
      )
      .replace(/\b(?:i|we)\s+made\s+(?:the\s+)?/i, 'Implemented ')
      .replace(/\b(?:i|we)\s+built\s+(?:the\s+)?/i, 'Built ')
      .replace(
        /\b(?:i|we)\s+(?:worked on|am working on|are working on)\s+/i,
        'Work in progress on ',
      )
      .replace(/\b(?:i|we)\s+(?:discussed|talked about)\s+/i, 'Discussion on ')
      .replace(/\b(?:i|we)\s+(?:will|plan to)\s+/i, 'Scheduled to ')
      .replace(
        /\band\s+(?:that's|it's)\s+now\s+sitting\s+in\s+(?:the\s+)?(?:br\s+)?/i,
        'prepared in ',
      )
      .replace(/\bbr\s+main\s+branch\b/i, 'main branch')
      .replace(/\bwe discussed yesterday\b/i, 'recently')
      .trim();
  }

  if (!cleaned) return 'Recent updates discussed in team sync.';
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  if (!/[.!?]$/.test(cleaned)) {
    cleaned += '.';
  }
  return cleaned;
};

const getProjectMovingPieces = (
  current: ProjectBrief | null,
  currentFocusRepeatsOutcome: boolean,
  projectCurrentFocus: string,
  projectOutcome: string,
): ProjectMovingPiece[] => {
  if (!current) return [];
  const pieces: ProjectMovingPiece[] = [];

  // 1. Synthesized recent changes from theme
  if (current.theme?.recentChanges?.length) {
    for (const change of current.theme.recentChanges.slice(0, 2)) {
      const text = change.summary?.trim();
      if (text) {
        pieces.push({
          id: `recent-change-${change.sourceMeetingId || pieces.length}`,
          text: synthesizeMovingPieceFromContext(text),
        });
      }
    }
  }

  // 2. Recent deliverables / completed commitments
  const completedTasks = current.tasks.filter((t) => t.status === 'completed');
  for (const task of completedTasks.slice(0, 2)) {
    if (pieces.length >= 3) break;
    pieces.push({
      id: `task-completed-${task.id}`,
      text: `Completed: ${task.name}`,
    });
  }

  // 3. Active in-flight commitments
  const activeTasks = current.tasks.filter((t) => t.status !== 'completed');
  for (const task of activeTasks.slice(0, 2)) {
    if (pieces.length >= 3) break;
    pieces.push({
      id: `task-active-${task.id}`,
      text: task.name,
    });
  }

  // 4. Open thread decisions
  if (current.theme?.openThreads?.length) {
    for (const thread of current.theme.openThreads.slice(0, 2)) {
      if (pieces.length >= 3) break;
      if (thread.kind === 'decision') {
        pieces.push({
          id: `thread-decision-${pieces.length}`,
          text: `Decided: ${thread.text}`,
        });
      }
    }
  }

  // 5. Recent meeting progress / context synthesis (prevents quote leaks)
  if (pieces.length < 3 && current.meetings[0]?.context) {
    const synthesized = synthesizeMovingPieceFromContext(
      current.meetings[0].context,
    );
    if (!pieces.some((p) => p.text === synthesized)) {
      pieces.push({
        id: 'meeting-progress',
        text: synthesized,
      });
    }
  }

  // 6. Strategic focus or scope alignment (never duplicate projectOutcome)
  if (pieces.length < 3) {
    if (!currentFocusRepeatsOutcome && projectCurrentFocus) {
      const focusText = synthesizeMovingPieceFromContext(projectCurrentFocus);
      if (
        focusText &&
        normalizeProjectCopy(focusText) !==
          normalizeProjectCopy(projectOutcome) &&
        !pieces.some((p) => p.text === focusText)
      ) {
        pieces.push({
          id: 'project-focus',
          text: focusText,
        });
      }
    } else if (current.meetings[0]?.title) {
      const meetingTitle = current.meetings[0].title.trim();
      const scopeText = `Scope and workflow alignment reviewed in ${meetingTitle}.`;
      if (!pieces.some((p) => p.text === scopeText)) {
        pieces.push({
          id: 'meeting-scope',
          text: scopeText,
        });
      }
    }
  }

  // 7. Meeting cadence & coordination momentum
  if (pieces.length < 3) {
    const recurring = current.meetingStats.recurringSeries[0];
    const meetingCount =
      current.meetingStats.meetingCount || current.meetings.length;
    if (recurring) {
      pieces.push({
        id: 'cadence-momentum',
        text: `${recurring.cadence} sync series active across ${recurring.meetingCount} meetings.`,
      });
    } else if (meetingCount > 1) {
      pieces.push({
        id: 'cadence-momentum',
        text: `Active sync cadence across ${meetingCount} meetings with ongoing team alignment.`,
      });
    } else if (meetingCount === 1) {
      pieces.push({
        id: 'cadence-momentum',
        text: 'Initial kickoff meeting conducted; awaiting next review cycle.',
      });
    }
  }

  return pieces.slice(0, 3);
};

export const ProjectDossier = ({
  projectId,
  projectName,
  onBack,
  onOpenMeeting,
  onOpenPerson,
  relatedWork = [],
  onOpenRelatedWork,
  mergeCandidates = [],
  onPortfolioChanged,
}: ProjectDossierProps) => {
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [request, setRequest] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleState, setTitleState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [dispositionState, setDispositionState] = useState<
    'idle' | 'saving' | 'error'
  >('idle');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergePreview, setMergePreview] = useState<ProjectBrief | null>(null);
  const [mergePreviewLoading, setMergePreviewLoading] = useState(false);
  const [mergeState, setMergeState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [lastMerged, setLastMerged] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [dreamingState, setDreamingState] = useState<DreamingUiStatus>('idle');
  const [showAllPeople, setShowAllPeople] = useState(false);
  const prepareGeneration = useRef(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const moreDetailsRef = useRef<HTMLDetailsElement>(null);
  const mergeSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  useEffect(() => {
    prepareGeneration.current += 1;
    setDreamingState('idle');
    setShowAllPeople(false);
  }, [projectId]);

  useEffect(
    () => () => {
      prepareGeneration.current += 1;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    getProjectBrief(projectId)
      .then((next) => {
        if (!active) return;
        setBrief(next);
        setLoadedProjectId(projectId);
        setTitleDraft(next?.project.displayTitle || projectName || 'Project');
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [projectId, projectName, request]);

  const handleDreamNow = async () => {
    const generation = ++prepareGeneration.current;
    const preparedProjectId = projectId;
    setDreamingState('running');
    try {
      const result = await triggerDreamingNow({
        entityId: preparedProjectId,
      });
      if (
        generation !== prepareGeneration.current ||
        preparedProjectId !== projectId
      )
        return;
      if (result.status === 'proposed' || result.status === 'existing') {
        setRequest((r) => r + 1);
        setDreamingState(result.status);
      } else {
        setDreamingState(result.status);
      }
    } catch {
      if (
        generation === prepareGeneration.current &&
        preparedProjectId === projectId
      )
        setDreamingState('error');
    }
  };

  const current = loadedProjectId === projectId ? brief : null;

  const detectedCadence = useMemo(() => {
    return detectProjectCadence({
      meetings: current?.meetings ?? [],
      recurringSeries: current?.meetingStats.recurringSeries ?? [],
      manualOverride: readProjectCadence(current?.project.metadata),
    });
  }, [
    current?.meetings,
    current?.meetingStats.recurringSeries,
    current?.project.metadata,
  ]);

  const activityState = useMemo(() => {
    return getProjectActivityState(
      current?.momentum.lastActivityAt ||
        (current?.meetings[0]?.started_at ??
          current?.meetings[0]?.created_at) ||
        null,
      Date.now(),
      detectedCadence.cadence,
    );
  }, [
    current?.momentum.lastActivityAt,
    current?.meetings,
    detectedCadence.cadence,
  ]);

  const evolutionTouchpoints = useMemo(() => {
    if (!current || !current.meetings.length) return [];
    const orderedMeetings = [...current.meetings].sort(
      (a, b) =>
        (Date.parse(a.started_at || a.created_at || '') || 0) -
        (Date.parse(b.started_at || b.created_at || '') || 0),
    );
    const genesisMeeting = orderedMeetings[0];
    const latestMeeting = orderedMeetings[orderedMeetings.length - 1];

    const completedMilestones = (current.milestones || []).filter(
      (m) => m.status === 'complete',
    );

    const points: Array<{
      id: string;
      label: string;
      date: string | null;
      title: string;
      description?: string | null;
      meetingId?: string;
      type: 'genesis' | 'milestone' | 'pulse';
    }> = [];

    points.push({
      id: `genesis-${genesisMeeting.id}`,
      label: 'Genesis',
      date: genesisMeeting.started_at || genesisMeeting.created_at,
      title: `First discussed in ${genesisMeeting.title || 'Initial meeting'}`,
      description:
        genesisMeeting.context || 'Project originated in discussion.',
      meetingId: genesisMeeting.id,
      type: 'genesis',
    });

    if (completedMilestones.length > 0) {
      const ms = completedMilestones[0];
      points.push({
        id: `milestone-${ms.id}`,
        label: 'Milestone reached',
        date: ms.targetDate,
        title: ms.title,
        description: ms.evidenceQuote || 'Milestone confirmed complete.',
        type: 'milestone',
      });
    } else if (orderedMeetings.length >= 3) {
      const midMeeting =
        orderedMeetings[Math.floor(orderedMeetings.length / 2)];
      points.push({
        id: `mid-${midMeeting.id}`,
        label: 'Intermediate progress',
        date: midMeeting.started_at || midMeeting.created_at,
        title: midMeeting.title || 'Progress check',
        description:
          midMeeting.context || 'Midpoint alignment and scope review.',
        meetingId: midMeeting.id,
        type: 'milestone',
      });
    }

    if (latestMeeting && latestMeeting.id !== genesisMeeting.id) {
      points.push({
        id: `latest-${latestMeeting.id}`,
        label: 'Latest pulse',
        date: latestMeeting.started_at || latestMeeting.created_at,
        title: latestMeeting.title || 'Recent discussion',
        description:
          current.theme?.currentFocus ||
          latestMeeting.context ||
          'Current working direction.',
        meetingId: latestMeeting.id,
        type: 'pulse',
      });
    }

    return points;
  }, [current]);

  const qualification = readProjectQualification(current?.project.metadata);
  const projectOutcome =
    current?.theme?.outcome ||
    qualification?.outcome ||
    'Pluto hasn’t found a clear goal for this project yet.';
  const projectCurrentFocus =
    current?.theme?.currentFocus ||
    qualification?.outcome ||
    (current?.meetings[0]?.context
      ? synthesizeMovingPieceFromContext(current.meetings[0].context)
      : null) ||
    'Review the first meeting and decide whether to keep this as a project.';
  const currentFocusRepeatsOutcome =
    normalizeProjectCopy(projectCurrentFocus) ===
    normalizeProjectCopy(projectOutcome);
  const attentionTasks =
    current?.tasks.filter((task) =>
      current.health.evidenceTaskIds.includes(task.id),
    ) ?? [];
  const projectHealthCopy = (() => {
    if (!current) return { headline: '', summary: '' };
    const count = attentionTasks.length;
    const item =
      count === 1 ? 'milestone or commitment' : 'milestones or commitments';
    if (current.health.state === 'falling_behind') {
      return {
        headline: 'Behind schedule',
        summary: `${count} ${item} ${count === 1 ? 'is' : 'are'} overdue.`,
      };
    }
    if (current.health.state === 'watch') {
      return count > 0
        ? {
            headline: 'Needs attention',
            summary: `${count} ${item} ${count === 1 ? 'is' : 'are'} due in the next two weeks.`,
          }
        : {
            headline: 'Needs attention',
            summary:
              'There are open risks or questions that need a closer look.',
          };
    }
    if (current.health.state === 'appears_on_track') {
      return {
        headline: 'On track',
        summary:
          count > 0
            ? `${count} ${item} ${count === 1 ? 'was' : 'were'} completed recently, and nothing is overdue.`
            : 'Recent progress looks on track, and nothing is overdue.',
      };
    }
    return {
      headline: 'Status not clear yet',
      summary:
        'There isn’t enough recent activity to tell whether this project is on track.',
    };
  })();
  const nextMilestone = current?.milestones.find(
    (milestone) => milestone.status !== 'complete',
  );
  const peopleInvolved = (() => {
    const people = new Map<
      string,
      {
        id: string;
        entityId: string;
        name: string;
        role?: string;
        meetingCount: number;
      }
    >();
    for (const meeting of current?.meetings ?? []) {
      const seen = new Set<string>();
      for (const participant of meeting.participants ?? []) {
        const name = participant.name?.trim();
        const entityId = participant.entity_id?.trim() || '';
        if (
          !name ||
          entityId.toLocaleLowerCase().startsWith('speaker:') ||
          /^(?:speaker(?:\s*\d+)?|unknown|none|n\/a|unassigned)$/i.test(name)
        ) {
          continue;
        }
        const key = name.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const existing = people.get(key);
        const role = cleanPersonRole(participant.role);
        people.set(key, {
          id: existing?.id || entityId || key,
          entityId: existing?.entityId || entityId,
          name: existing?.name || name,
          role: cleanPersonRole(existing?.role) || role,
          meetingCount: (existing?.meetingCount ?? 0) + 1,
        });
      }
    }
    return [...people.values()].sort(
      (left, right) =>
        right.meetingCount - left.meetingCount ||
        left.name.localeCompare(right.name),
    );
  })();
  const displayedPeople = showAllPeople
    ? peopleInvolved
    : peopleInvolved.slice(0, 6);
  const frequentContributors = useMemo(
    () => peopleInvolved.slice(0, 5),
    [peopleInvolved],
  );
  const otherPeopleCount = Math.max(
    0,
    peopleInvolved.length - frequentContributors.length,
  );
  const activeAssignments = (current?.tasks ?? [])
    .flatMap((task) => {
      if (!task.assigned_to || task.status === 'completed') return [];
      const person = peopleInvolved.find(
        (candidate) => candidate.entityId === task.assigned_to,
      );
      return person ? [{ person, task }] : [];
    })
    .slice(0, 2);
  const movingPieces = useMemo(
    () =>
      getProjectMovingPieces(
        current,
        currentFocusRepeatsOutcome,
        projectCurrentFocus,
        projectOutcome,
      ),
    [current, currentFocusRepeatsOutcome, projectCurrentFocus, projectOutcome],
  );
  const projectActivitySummary = movingPieces[0]?.text || projectCurrentFocus;
  const keyPeople = peopleInvolved.slice(0, 3);
  const keyPeopleLabel = new Intl.ListFormat(undefined, {
    style: 'long',
    type: 'conjunction',
  }).format(
    keyPeople.map((person) => {
      const role = cleanPersonRole(person.role);
      return role ? `${person.name} (${role})` : person.name;
    }),
  );
  const projectPeopleSummary = activeAssignments.length
    ? activeAssignments
        .map(
          ({ person, task }) =>
            `${person.name} is responsible for ${task.name}`,
        )
        .join('; ')
    : keyPeople.length > 0
      ? `${keyPeopleLabel} ${keyPeople.length === 1 ? 'is' : 'are'} involved in this project.`
      : peopleInvolved.length > 0
        ? `${peopleInvolved.length} people have discussed this project in meetings.`
        : 'No people yet';
  const activeDeliverables = (current?.tasks ?? []).filter(
    (task) => task.status !== 'completed',
  );
  const primaryAttentionTask = attentionTasks[0];
  const analyzedTimeline = useMemo(() => {
    if (primaryAttentionTask) {
      return {
        summary: `${primaryAttentionTask.name}${primaryAttentionTask.due_date ? `, due ${formatDate(primaryAttentionTask.due_date)}` : ''}, needs attention.`,
        hasMilestone: true,
      };
    }
    if (nextMilestone) {
      return {
        summary: `Next milestone: ${nextMilestone.title}${nextMilestone.timing ? `, expected ${nextMilestone.timing}` : ''}.`,
        hasMilestone: true,
      };
    }
    if (activeDeliverables.length > 0) {
      return {
        summary: `${activeDeliverables.length} deliverable${activeDeliverables.length === 1 ? '' : 's'} in motion (e.g. “${activeDeliverables[0].name}”). Target delivery milestones being scheduled.`,
        hasMilestone: false,
      };
    }
    const cadencePattern =
      detectedCadence.cadence && detectedCadence.cadence !== 'adhoc'
        ? `${detectedCadence.cadence.toLowerCase()} sync pattern`
        : current?.meetingStats.recurringSeries[0]?.cadence.toLowerCase() ||
          null;
    if (cadencePattern) {
      return {
        summary: `Next review cycle aligns with ${cadencePattern} (${current?.meetingStats.meetingCount || current?.meetings.length || 1} meetings to date). No target milestone dates set yet.`,
        hasMilestone: false,
      };
    }
    return {
      summary: `Active project across ${current?.meetingStats.meetingCount || current?.meetings.length || 1} meetings. Delivery milestones have not been scheduled yet.`,
      hasMilestone: false,
    };
  }, [
    primaryAttentionTask,
    nextMilestone,
    activeDeliverables,
    detectedCadence.cadence,
    current?.meetingStats.recurringSeries,
    current?.meetingStats.meetingCount,
    current?.meetings.length,
  ]);
  const isSuggestion =
    Boolean(current) &&
    !current?.theme &&
    current?.meetingStats.meetingCount === 1 &&
    qualification?.source !== 'user';
  const selectedMergeSource = useMemo(
    () => mergeCandidates.find((candidate) => candidate.id === mergeSourceId),
    [mergeCandidates, mergeSourceId],
  );
  const eligibleMergeCandidates = mergeCandidates.filter(
    (candidate) => candidate.id !== current?.project.id,
  );

  useEffect(() => {
    let active = true;
    setMergePreview(null);
    if (!mergeSourceId) return () => undefined;
    setMergePreviewLoading(true);
    getProjectBrief(mergeSourceId)
      .then((next) => {
        if (active) setMergePreview(next);
      })
      .finally(() => {
        if (active) setMergePreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mergeSourceId]);

  useEffect(() => {
    if (mergeOpen) {
      requestAnimationFrame(() => {
        mergeSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    }
  }, [mergeOpen]);

  const saveTitle = async () => {
    const title = titleDraft.trim();
    if (!current || !title || title === current.project.displayTitle) {
      setEditingTitle(false);
      setTitleDraft(current?.project.displayTitle || projectName || 'Project');
      return;
    }
    setTitleState('saving');
    try {
      await updateProjectDisplayTitle(current.project.id, title);
      setBrief({
        ...current,
        project: { ...current.project, displayTitle: title },
      });
      setEditingTitle(false);
      setTitleState('saved');
      await onPortfolioChanged?.();
    } catch {
      setTitleState('error');
    }
  };

  const setDisposition = async (disposition: 'confirmed' | 'dismissed') => {
    if (!current) return;
    setDispositionState('saving');
    try {
      await setProjectPortfolioDisposition(current.project.id, disposition);
      await onPortfolioChanged?.();
      if (disposition === 'dismissed') onBack();
      else setRequest((value) => value + 1);
      setDispositionState('idle');
    } catch {
      setDispositionState('error');
    }
  };

  const performMerge = async () => {
    if (!current || !selectedMergeSource) return;
    setMergeState('saving');
    try {
      await mergeProject(selectedMergeSource.id, current.project.id);
      setLastMerged({
        id: selectedMergeSource.id,
        name: selectedMergeSource.name,
      });
      setMergeState('saved');
      setMergeOpen(false);
      setMergeSourceId('');
      await onPortfolioChanged?.();
      setRequest((value) => value + 1);
    } catch {
      setMergeState('error');
    }
  };

  const undoMerge = async () => {
    if (!lastMerged) return;
    setMergeState('saving');
    try {
      await restoreProjectMerge(lastMerged.id);
      setLastMerged(null);
      setMergeState('idle');
      await onPortfolioChanged?.();
      setRequest((value) => value + 1);
    } catch {
      setMergeState('error');
    }
  };

  const restoreMergedProject = async (id: string) => {
    setMergeState('saving');
    try {
      await restoreProjectMerge(id);
      setMergeState('idle');
      await onPortfolioChanged?.();
      setRequest((value) => value + 1);
    } catch {
      setMergeState('error');
    }
  };

  const isStarred = isProjectStarred(brief?.project.metadata);

  const toggleStar = async () => {
    if (!brief?.project) return;
    const nextStarred = !isStarred;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(brief.project.metadata || '{}');
    } catch {}
    try {
      await upsertEntity({
        id: brief.project.id,
        type: 'project',
        name: brief.project.detectedTitle || brief.project.displayTitle,
        metadata: {
          ...parsed,
          projectStarred: nextStarred,
          projectStarredUpdatedAt: new Date().toISOString(),
        },
      });
      await onPortfolioChanged?.();
      setRequest((val) => val + 1);
    } catch (err) {
      console.error('Failed to toggle star in dossier:', err);
    }
  };

  return (
    <div
      className="project-reading-surface mx-auto w-full max-w-[760px] pb-16 text-pro-text-main"
      data-reading-surface="project-dossier"
    >
      <div className="mb-8 flex items-center justify-between gap-4">
        <button type="button" onClick={onBack} className={quietButton}>
          ← Back to projects
        </button>
        <div className="flex items-center gap-2.5">
          {dreamingState !== 'idle' ? (
            <div
              className="flex items-center gap-2 rounded-full border border-pro-border/70 bg-pro-surface/60 px-3 py-1 text-xs font-medium text-pro-text-muted"
              aria-live="polite"
            >
              {dreamingState === 'running' ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-pro-accent animate-pulse"
                  aria-hidden="true"
                />
              ) : null}
              <span>{DREAMING_STATUS_LABEL[dreamingState]}</span>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void toggleStar()}
            title={
              isStarred ? 'Remove from primary focus' : 'Star as primary focus'
            }
            aria-label={isStarred ? 'Unstar project' : 'Star project'}
            className={`${quietButton} ${
              isStarred
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 font-semibold'
                : ''
            }`}
          >
            <Star
              className={`h-3.5 w-3.5 ${
                isStarred
                  ? 'fill-amber-400 text-amber-500'
                  : 'text-pro-text-muted'
              }`}
            />
            <span>{isStarred ? 'Primary Focus' : 'Star'}</span>
          </button>
          <details ref={moreDetailsRef} className="relative">
            <summary className={`${quietButton} cursor-pointer list-none`}>
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
              More
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-pro-border bg-pro-bg p-1 shadow-lg">
              {isSuggestion && (
                <>
                  <button
                    type="button"
                    disabled={dispositionState === 'saving'}
                    onClick={() => void setDisposition('confirmed')}
                    className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
                  >
                    <Check aria-hidden="true" className="h-3.5 w-3.5" />
                    Keep as project
                  </button>
                  <button
                    type="button"
                    disabled={dispositionState === 'saving'}
                    onClick={() => void setDisposition('dismissed')}
                    className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
                  >
                    Dismiss suggestion
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditingTitle(true);
                  setTitleState('idle');
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
              >
                <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                Rename project
              </button>
              <button
                type="button"
                disabled={!eligibleMergeCandidates.length}
                onClick={() => {
                  setMergeOpen(true);
                  setMergeState('idle');
                  if (moreDetailsRef.current) {
                    moreDetailsRef.current.open = false;
                  }
                }}
                className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
              >
                Merge another project
              </button>
              {current?.mergedProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  disabled={mergeState === 'saving'}
                  onClick={() => void restoreMergedProject(project.id)}
                  className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
                >
                  Restore {project.name}
                </button>
              ))}
              <button
                type="button"
                disabled={dreamingState === 'running'}
                onClick={() => void handleDreamNow()}
                className="flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-pro-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent disabled:opacity-40"
              >
                {DREAMING_STATUS_LABEL[dreamingState]}
              </button>
            </div>
          </details>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-8 flex flex-wrap items-center gap-3 text-sm text-pro-text-muted"
        >
          <p>
            {current
              ? 'Pluto couldn’t refresh this project. The previous summary is still here.'
              : 'Pluto couldn’t load this project.'}
          </p>
          <button
            type="button"
            onClick={() => setRequest((value) => value + 1)}
            className={quietButton}
          >
            Retry project
          </button>
        </div>
      )}

      {loading && !current && (
        <div
          aria-busy="true"
          aria-label="Loading project"
          className="space-y-5 motion-safe:animate-pulse"
        >
          <div className="h-8 w-2/3 rounded bg-pro-border/30" />
          <div className="h-4 w-full rounded bg-pro-border/20" />
          <div className="h-4 w-4/5 rounded bg-pro-border/20" />
        </div>
      )}

      {!loading && !current && !error && (
        <p className="text-pro-text-muted">
          This project is no longer available.
        </p>
      )}

      {current && (
        <>
          <header className="mb-10">
            {editingTitle ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTitle();
                }}
                className="max-w-[65ch]"
              >
                <label
                  htmlFor="project-display-title"
                  className="mb-2 block text-xs font-medium text-pro-text-muted"
                >
                  Project title
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={titleInputRef}
                    id="project-display-title"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditingTitle(false);
                        setTitleDraft(current.project.displayTitle);
                      }
                    }}
                    className="project-dossier-title min-w-0 flex-1 rounded-md border border-pro-accent/60 bg-transparent px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-pro-accent/30"
                  />
                  <button
                    type="submit"
                    disabled={!titleDraft.trim() || titleState === 'saving'}
                    className={quietButton}
                  >
                    {titleState === 'saving' ? 'Saving…' : 'Save title'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTitle(false);
                      setTitleDraft(current.project.displayTitle);
                    }}
                    className={quietButton}
                  >
                    Keep current title
                  </button>
                </div>
                {titleState === 'error' && (
                  <p role="alert" className="mt-2 text-sm text-pro-urgent">
                    Pluto couldn’t save this title. The current title is
                    unchanged.
                  </p>
                )}
              </form>
            ) : (
              <div className="group flex items-start gap-2">
                <h1 className="project-dossier-title">
                  {current.project.displayTitle}
                </h1>
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  aria-label="Edit project title"
                  className="mt-1.5 min-h-10 min-w-10 rounded p-2 text-pro-text-muted opacity-70 transition-opacity hover:text-pro-text-main focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="project-dossier-meta mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                  activityState.state === 'active'
                    ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-300'
                    : activityState.state === 'dormant'
                      ? 'border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-300'
                      : 'border border-stone-500/30 bg-stone-500/10 text-stone-700 dark:text-stone-300'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    activityState.state === 'active'
                      ? 'bg-emerald-500'
                      : activityState.state === 'dormant'
                        ? 'bg-amber-500'
                        : 'bg-stone-400'
                  }`}
                  aria-hidden="true"
                />
                {activityState.label}
              </span>
              <span>
                {current.meetingStats.meetingCount} meeting
                {current.meetingStats.meetingCount === 1 ? '' : 's'}
              </span>
              {current.momentum.lastActivityAt && (
                <span>
                  Last discussed {formatDate(current.momentum.lastActivityAt)}
                </span>
              )}
            </div>
            {titleState === 'saved' && !editingTitle && (
              <output className="mt-2 flex items-center gap-1.5 text-xs text-pro-success">
                <Check aria-hidden="true" className="h-3.5 w-3.5" /> Title saved
              </output>
            )}
          </header>

          {isSuggestion && (
            <section
              aria-labelledby="review-suggestion"
              className="mb-10 rounded-xl border border-pro-border/60 bg-pro-bg-elevated/30 p-5 sm:p-6"
            >
              <p className="text-xs font-medium text-pro-text-muted">
                Review suggestion
              </p>
              <h2 id="review-suggestion" className="mt-2 text-lg font-semibold">
                Pluto found this in one meeting
              </h2>
              <p className="mt-2 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
                Keep it if this is ongoing work. Dismiss it if it was only a
                one-time topic or task.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={dispositionState === 'saving'}
                  onClick={() => void setDisposition('confirmed')}
                  className="min-h-10 rounded-md bg-pro-accent px-4 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-40"
                >
                  Keep as project
                </button>
                <button
                  type="button"
                  disabled={dispositionState === 'saving'}
                  onClick={() => void setDisposition('dismissed')}
                  className={quietButton}
                >
                  Dismiss suggestion
                </button>
              </div>
              {dispositionState === 'error' && (
                <p role="alert" className="mt-3 text-sm text-pro-urgent">
                  Pluto couldn’t save that choice. The suggestion is unchanged.
                </p>
              )}
            </section>
          )}

          <div className="space-y-20">
            <section aria-label="Project overview" className="py-1">
              <section aria-labelledby="project-about" className="min-w-0">
                <h2
                  id="project-about"
                  className="project-dossier-section-title mb-4"
                >
                  Project brief
                </h2>
                <p className="project-dossier-lead text-pro-text-main pb-5 border-b border-pro-rule/40 font-normal leading-[1.6]">
                  {projectOutcome}
                </p>
                <dl className="max-w-[68ch] divide-y divide-pro-rule/30">
                  <div className="py-4 grid min-w-0 gap-1.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-6 sm:items-baseline">
                    <dt className="project-dossier-property-label font-medium text-[13px] text-pro-text-muted">
                      {currentFocusRepeatsOutcome
                        ? 'Latest updates'
                        : 'Current focus'}
                    </dt>
                    <dd className="min-w-0 text-pro-text-main">
                      {movingPieces.length > 0 ? (
                        <ul className="space-y-2.5">
                          {movingPieces.map((piece) => (
                            <li
                              key={piece.id}
                              className="flex items-start gap-2.5 text-[14px] leading-relaxed"
                            >
                              <span
                                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pro-text-muted/60"
                                aria-hidden="true"
                              />
                              <span className="min-w-0 flex-1">
                                {piece.text}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[14px] leading-relaxed">
                          {projectActivitySummary}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="py-4 grid min-w-0 gap-1.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-6 sm:items-baseline">
                    <dt className="project-dossier-property-label font-medium text-[13px] text-pro-text-muted">
                      Who’s involved
                    </dt>
                    <dd className="min-w-0 text-[14px] leading-relaxed text-pro-text-main">
                      {projectPeopleSummary}
                      {activeAssignments.length > 0 ? '.' : ''}
                    </dd>
                  </div>
                  <div className="py-4 grid min-w-0 gap-1.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-6 sm:items-baseline">
                    <dt className="project-dossier-property-label font-medium text-[13px] text-pro-text-muted">
                      Coming up
                    </dt>
                    <dd className="min-w-0 text-[14px] leading-relaxed text-pro-text-main">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span>{analyzedTimeline.summary}</span>
                        {!analyzedTimeline.hasMilestone && (
                          <button
                            type="button"
                            onClick={() =>
                              document
                                .getElementById('project-milestones')
                                ?.scrollIntoView({ behavior: 'smooth' })
                            }
                            className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium text-pro-accent hover:bg-pro-accent/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pro-accent transition-colors"
                          >
                            + Add milestone
                          </button>
                        )}
                      </div>
                    </dd>
                  </div>
                </dl>
              </section>

              <section
                aria-labelledby="project-health"
                className="project-dossier-health mt-14 rounded-2xl px-5 py-6 sm:px-6"
              >
                <div className="flex items-center gap-2">
                  <Activity
                    aria-hidden="true"
                    className="h-4 w-4 text-pro-text-muted"
                  />
                  <h2
                    id="project-health"
                    className="project-dossier-section-title"
                  >
                    Project health
                  </h2>
                </div>
                <p
                  className={`project-dossier-body mt-3 font-medium ${healthTone[current.health.state]}`}
                >
                  {projectHealthCopy.headline}
                </p>
                <p className="project-dossier-body mt-1 text-pro-text-main">
                  {projectHealthCopy.summary}
                </p>
                {attentionTasks.length > 0 && (
                  <ul className="mt-5 max-w-[68ch] divide-y divide-pro-border/40">
                    {attentionTasks.slice(0, 3).map((task) => (
                      <li key={task.id} className="break-words py-4">
                        <span className="text-base font-medium">
                          {task.name}
                        </span>
                        {task.due_date && (
                          <span className="mt-1 block text-[0.8rem] leading-5 text-pro-text-muted">
                            Due {formatDate(task.due_date)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {attentionTasks.length > 3 && (
                  <p className="mt-3 text-[0.8rem] leading-5 text-pro-text-muted">
                    {attentionTasks.length - 3} more flagged commitment
                    {attentionTasks.length - 3 === 1 ? '' : 's'} in more project
                    context
                  </p>
                )}
              </section>
            </section>

            <section aria-labelledby="project-at-a-glance">
              <h2
                id="project-at-a-glance"
                className="project-dossier-section-title"
              >
                At a glance
              </h2>
              <dl className="mt-5 space-y-4 max-w-[68ch]">
                {/* Rhythm row */}
                <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6 sm:items-baseline">
                  <dt className="project-dossier-property-label flex items-center gap-1.5">
                    <Repeat2
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-pro-text-muted shrink-0"
                    />
                    Meeting rhythm
                  </dt>
                  <dd className="project-dossier-body min-w-0 text-pro-text-main">
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      <span>{detectedCadence.label}</span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          detectedCadence.rhythmHealth === 'in_rhythm'
                            ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-300'
                            : detectedCadence.rhythmHealth === 'due_soon' ||
                                detectedCadence.rhythmHealth === 'slipping'
                              ? 'border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-300'
                              : 'border border-stone-500/30 bg-stone-500/10 text-stone-700 dark:text-stone-300'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            detectedCadence.rhythmHealth === 'in_rhythm'
                              ? 'bg-emerald-500'
                              : detectedCadence.rhythmHealth === 'due_soon' ||
                                  detectedCadence.rhythmHealth === 'slipping'
                                ? 'bg-amber-500'
                                : 'bg-stone-400'
                          }`}
                          aria-hidden="true"
                        />
                        {detectedCadence.rhythmStatusLabel}
                      </span>
                    </span>
                    <p className="mt-1 text-[13px] leading-relaxed text-pro-text-muted">
                      {detectedCadence.detail}
                      {current.meetingStats.activeWeeks &&
                        current.meetingStats.activeWeeks > 1 && (
                          <>
                            {' '}
                            · {current.meetingStats.meetingCount} meetings over{' '}
                            {current.meetingStats.activeWeeks} weeks
                          </>
                        )}
                      {current.meetingStats.recurringSeries[0]?.title && (
                        <>
                          {' '}
                          · via{' '}
                          <em className="not-italic font-medium text-pro-text-main">
                            {current.meetingStats.recurringSeries[0].title}
                          </em>
                        </>
                      )}
                    </p>
                  </dd>
                </div>

                {/* Regulars row — most frequent contributors, named */}
                {frequentContributors.length > 0 && (
                  <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6 sm:items-baseline">
                    <dt className="project-dossier-property-label flex items-center gap-1.5">
                      <Users
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-pro-text-muted shrink-0"
                      />
                      Regulars
                    </dt>
                    <dd className="project-dossier-body min-w-0 text-pro-text-main">
                      {frequentContributors.map((p) => p.name).join(', ')}
                      {otherPeopleCount > 0 && (
                        <span className="text-pro-text-muted">
                          {' '}
                          + {otherPeopleCount}{' '}
                          {otherPeopleCount === 1 ? 'other' : 'others'} across{' '}
                          {current.meetingStats.meetingCount ||
                            current.meetings.length}{' '}
                          meetings
                        </span>
                      )}
                    </dd>
                  </div>
                )}

                {/* Open threads from theme synthesis */}
                {current.theme && current.theme.openThreads.length > 0 && (
                  <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6 sm:items-baseline">
                    <dt className="project-dossier-property-label flex items-center gap-1.5">
                      <Calendar
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-pro-text-muted shrink-0"
                      />
                      Open threads
                    </dt>
                    <dd className="min-w-0 space-y-1.5">
                      {current.theme.openThreads
                        .slice(0, 2)
                        .map((thread, i) => (
                          <p
                            key={i}
                            className="text-[13.5px] leading-relaxed text-pro-text-main"
                          >
                            <span
                              className={`mr-1.5 inline-flex items-center rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${
                                thread.kind === 'risk'
                                  ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                                  : thread.kind === 'decision'
                                    ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
                                    : 'bg-pro-surface text-pro-text-muted'
                              }`}
                            >
                              {thread.kind}
                            </span>
                            {thread.text}
                          </p>
                        ))}
                      {current.theme.openThreads.length > 2 && (
                        <p className="text-xs text-pro-text-muted">
                          +{current.theme.openThreads.length - 2} more open
                          threads
                        </p>
                      )}
                    </dd>
                  </div>
                )}

                {/* Commitments — only shown when there's actual data */}
                {(current.momentum.openCommitmentCount > 0 ||
                  current.momentum.completedCommitmentCount > 0 ||
                  nextMilestone) && (
                  <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6 sm:items-baseline">
                    <dt className="project-dossier-property-label flex items-center gap-1.5">
                      <Check
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-pro-text-muted shrink-0"
                      />
                      Commitments
                    </dt>
                    <dd className="project-dossier-body min-w-0 text-pro-text-main">
                      {current.momentum.openCommitmentCount > 0 && (
                        <span>{current.momentum.openCommitmentCount} open</span>
                      )}
                      {current.momentum.openCommitmentCount > 0 &&
                        current.momentum.completedCommitmentCount > 0 && (
                          <span className="text-pro-text-muted"> · </span>
                        )}
                      {current.momentum.completedCommitmentCount > 0 && (
                        <span className="text-pro-text-muted">
                          {current.momentum.completedCommitmentCount} completed
                        </span>
                      )}
                      {nextMilestone && (
                        <p className="mt-1 text-[13px] text-pro-text-muted">
                          Next:{' '}
                          <span className="text-pro-text-main font-medium">
                            {nextMilestone.title}
                          </span>
                          {nextMilestone.timing && (
                            <span> · {nextMilestone.timing}</span>
                          )}
                        </p>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            {evolutionTouchpoints.length > 1 && (
              <section aria-labelledby="project-evolution" className="mt-10">
                <div className="flex items-baseline justify-between gap-3">
                  <h2
                    id="project-evolution"
                    className="project-dossier-section-title"
                  >
                    How this evolved
                  </h2>
                  <span className="text-xs text-pro-text-muted">
                    {evolutionTouchpoints.length} touchpoints
                  </span>
                </div>
                <div className="relative mt-5 pl-6 border-l-2 border-pro-border/70 space-y-6">
                  {evolutionTouchpoints.map((pt) => (
                    <div key={pt.id} className="relative group">
                      <span
                        className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full ring-4 ring-pro-bg ${
                          pt.type === 'pulse'
                            ? 'bg-emerald-500'
                            : pt.type === 'milestone'
                              ? 'bg-amber-500'
                              : 'bg-pro-accent'
                        }`}
                        aria-hidden="true"
                      />
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-pro-text-muted">
                          {pt.label}
                        </span>
                        {pt.date && (
                          <span className="text-xs text-pro-text-muted">
                            · {formatDate(pt.date)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm font-medium text-pro-text-main">
                        {pt.meetingId && onOpenMeeting ? (
                          <button
                            type="button"
                            onClick={() => onOpenMeeting(pt.meetingId!)}
                            className="text-left hover:text-pro-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pro-accent rounded"
                          >
                            {pt.title} ↗
                          </button>
                        ) : (
                          <span>{pt.title}</span>
                        )}
                      </div>
                      {pt.description && (
                        <p className="mt-1 text-xs leading-relaxed text-pro-text-muted max-w-[65ch]">
                          {pt.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {peopleInvolved.length > 0 && (
              <section aria-labelledby="project-people">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <h2
                      id="project-people"
                      className="project-dossier-section-title"
                    >
                      People involved
                    </h2>
                    <p className="project-dossier-meta mt-1">
                      People who have joined meetings about this project.
                    </p>
                  </div>
                  {current.meetingStats.typicalParticipantCount !== null && (
                    <span className="inline-flex items-center gap-2 text-xs text-pro-text-muted">
                      <Users aria-hidden="true" className="h-4 w-4" />
                      Usually {current.meetingStats.typicalParticipantCount}{' '}
                      people attend
                    </span>
                  )}
                </div>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {displayedPeople.map((person) => {
                    const functionTag = getPersonFunctionTag(person.role);
                    return (
                      <li key={person.id} className="h-24 min-w-0">
                        <button
                          type="button"
                          data-person-card={person.name}
                          aria-label={`Open ${person.name}'s profile`}
                          disabled={!onOpenPerson || !person.entityId}
                          onClick={() => onOpenPerson?.(person.entityId)}
                          className="group flex h-full w-full min-w-0 items-start gap-3 rounded-xl border border-pro-border/55 bg-pro-bg-elevated/25 p-3 text-left transition-colors hover:border-pro-accent/25 hover:bg-pro-hover/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:cursor-default disabled:hover:border-pro-border/55 disabled:hover:bg-pro-bg-elevated/25"
                        >
                          <span
                            aria-hidden="true"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-pro-border/60 bg-pro-surface text-[11px] font-semibold text-pro-text-muted transition-colors group-hover:border-pro-accent/25 group-hover:text-pro-accent"
                          >
                            {getPersonInitials(person.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-pro-text-main">
                              {person.name}
                            </p>
                            {person.role && (
                              <p className="mt-0.5 truncate text-xs text-pro-text-muted">
                                {person.role}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                              {functionTag && (
                                <span className="rounded-md border border-pro-accent/15 bg-pro-accent/5 px-1.5 py-0.5 font-medium text-pro-accent">
                                  {functionTag}
                                </span>
                              )}
                              <span className="text-pro-text-muted">
                                In {person.meetingCount} meeting
                                {person.meetingCount === 1 ? '' : 's'}
                              </span>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {peopleInvolved.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPeople((visible) => !visible)}
                    className="mt-3 min-h-9 rounded-md px-2 text-[0.8rem] font-medium text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                  >
                    {showAllPeople
                      ? 'Show fewer people'
                      : `Show ${peopleInvolved.length - 6} more`}
                  </button>
                )}
                {current.meetingStats.participantCoverage <
                  current.meetingStats.meetingCount && (
                  <p className="mt-3 text-xs text-pro-text-muted">
                    Attendee details are available for{' '}
                    {current.meetingStats.participantCoverage} of{' '}
                    {current.meetingStats.meetingCount} meetings.
                  </p>
                )}
              </section>
            )}

            <div id="project-milestones">
              <ProjectMilestones
                projectId={current.project.id}
                milestones={current.milestones}
                evidenceMeetings={current.meetings.map((meeting) => ({
                  id: meeting.id,
                  title: meeting.title,
                  date: meeting.started_at || meeting.created_at,
                }))}
                onOpenMeeting={onOpenMeeting}
                onChange={(milestones) =>
                  setBrief((value) =>
                    value ? { ...value, milestones } : value,
                  )
                }
              />
            </div>

            {current.meetingStats.recurringSeries.length > 0 && (
              <section aria-labelledby="project-meeting-rhythm">
                <div>
                  <h2
                    id="project-meeting-rhythm"
                    className="project-dossier-section-title"
                  >
                    Regular meetings
                  </h2>
                  <p className="project-dossier-meta mt-1">
                    Meeting schedules that have repeated at least three times.
                  </p>
                </div>
                <div className="mt-4 divide-y divide-pro-border/40">
                  {current.meetingStats.recurringSeries.map((series) => (
                    <div
                      key={series.key}
                      className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div>
                        <p className="flex items-center gap-2 font-medium">
                          <Repeat2
                            aria-hidden="true"
                            className="h-4 w-4 text-pro-text-muted"
                          />
                          {series.title}
                        </p>
                        <p className="mt-1 text-sm text-pro-text-muted">
                          {series.cadence}
                        </p>
                      </div>
                      <p className="text-sm tabular-nums text-pro-text-muted sm:text-right">
                        {series.meetingCount} meetings
                        {series.typicalParticipantCount !== null
                          ? ` · usually ${series.typicalParticipantCount} people`
                          : ''}
                        <br />
                        Last met {formatDate(series.lastMetAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {current.theme?.openThreads.length ? (
              <section aria-labelledby="project-open-threads">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <h2
                      id="project-open-threads"
                      className="project-dossier-section-title"
                    >
                      Open questions and actions
                    </h2>
                    <p className="project-dossier-meta mt-1">
                      Decisions, next steps, questions, and commitments.
                    </p>
                  </div>
                </div>
                <ul className="mt-4 divide-y divide-pro-border/40">
                  {current.theme.openThreads.map((thread) => (
                    <li
                      key={`${thread.sourceMeetingId}-${thread.kind}-${thread.text}`}
                      className="grid gap-1 py-4 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4"
                    >
                      <span className="text-xs capitalize text-pro-text-muted">
                        {thread.kind}
                      </span>
                      <span className="project-dossier-body">
                        {thread.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="project-conversation-history">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2
                  id="project-conversation-history"
                  className="project-dossier-section-title"
                >
                  Meeting history
                </h2>
                <span className="text-xs text-pro-text-muted">
                  {current.meetings.length} meeting
                  {current.meetings.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-4 divide-y divide-pro-border/40">
                {current.meetings.map((meeting) => (
                  <article
                    key={meeting.id}
                    className="grid gap-2 py-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-5"
                  >
                    <p className="text-xs tabular-nums text-pro-text-muted">
                      {formatDate(meeting.started_at || meeting.created_at)}
                    </p>
                    <div>
                      {onOpenMeeting ? (
                        <button
                          type="button"
                          onClick={() => onOpenMeeting(meeting.id)}
                          className="rounded text-left text-sm font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
                        >
                          {meeting.title || 'Untitled meeting'}{' '}
                          <span
                            aria-hidden="true"
                            className="text-pro-text-muted"
                          >
                            ↗
                          </span>
                        </button>
                      ) : (
                        <h3 className="text-sm font-medium">
                          {meeting.title || 'Untitled meeting'}
                        </h3>
                      )}
                      {meeting.context && (
                        <p className="mt-1.5 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
                          {meeting.context}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {relatedWork.length > 0 && (
              <section aria-labelledby="project-related-work">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-pro-accent" />
                    <h2
                      id="project-related-work"
                      className="project-dossier-section-title"
                    >
                      Topics &amp; Discussion Streams
                    </h2>
                    <span className="rounded-full border border-pro-border/60 bg-pro-surface px-2 py-0.5 text-[11px] font-medium text-pro-text-muted">
                      {relatedWork.length}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-pro-text-muted">
                  Constituent workstreams and topics filed under this
                  initiative.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {relatedWork.map((entry) => (
                    <div
                      key={entry.id}
                      className="group relative flex flex-col justify-between rounded-xl border border-pro-border/60 bg-pro-surface/40 p-3.5 transition-all hover:bg-pro-surface/70 shadow-2xs"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-[13.5px] font-semibold text-pro-text-main group-hover:text-pro-accent transition-colors">
                            {entry.display_title || entry.name}
                          </h3>
                          <button
                            type="button"
                            onClick={async () => {
                              await detachTopicFromProject(entry.id);
                              await onPortfolioChanged?.();
                            }}
                            title="Detach topic from this initiative"
                            aria-label={`Detach ${entry.name} from this initiative`}
                            className="rounded p-1 text-pro-text-muted/50 hover:bg-pro-hover hover:text-rose-600 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {entry.latest_context && (
                          <p className="mt-1.5 text-xs text-pro-text-muted line-clamp-2 leading-relaxed">
                            {entry.latest_context}
                          </p>
                        )}
                      </div>
                      <div className="mt-3 flex items-center justify-between pt-2 border-t border-pro-border/30 text-[11px] text-pro-text-muted">
                        <span>
                          {entry.meeting_count} conversation
                          {entry.meeting_count === 1 ? '' : 's'}
                        </span>
                        {onOpenRelatedWork && (
                          <button
                            type="button"
                            onClick={() => onOpenRelatedWork(entry.id)}
                            className="inline-flex items-center gap-1 font-medium text-pro-accent hover:underline"
                          >
                            Open stream
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {mergeOpen && (
            <section
              ref={mergeSectionRef}
              aria-labelledby="merge-project-heading"
              className="mt-12 rounded-xl border border-pro-accent/40 bg-pro-surface/40 p-6 shadow-sm ring-1 ring-pro-accent/20"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2
                    id="merge-project-heading"
                    className="text-lg font-semibold text-pro-text-main"
                  >
                    Merge another project into {current.project.displayTitle}
                  </h2>
                  <p className="mt-1.5 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
                    Meetings, commitments, and alternate names will appear
                    together. The original project is kept, and the merge can be
                    undone.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMergeOpen(false)}
                  aria-label="Close merge section"
                  className="rounded-lg p-1.5 text-pro-text-muted transition-colors hover:bg-pro-hover hover:text-pro-text-main"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <label
                htmlFor="merge-project-source"
                className="mt-5 block text-xs font-medium text-pro-text-muted"
              >
                Project to merge
              </label>
              <SearchSelect
                id="merge-project-source"
                value={mergeSourceId}
                ariaLabel="Project to merge"
                onValueChange={setMergeSourceId}
                placeholder="Choose a project"
                searchPlaceholder="Search projects…"
                options={eligibleMergeCandidates.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.name,
                }))}
                className="mt-2"
              />
              {selectedMergeSource && (
                <div className="mt-5 border-y border-pro-border/40 py-4 text-sm">
                  <p className="font-medium">Merge preview</p>
                  {mergePreviewLoading && (
                    <p className="mt-2 text-pro-text-muted">
                      Checking meetings, milestones, and commitments…
                    </p>
                  )}
                  {mergePreview && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-pro-text-muted sm:grid-cols-4">
                      <div>
                        <dt className="text-xs">Meetings</dt>
                        <dd className="mt-1 font-medium text-pro-text-main">
                          {current.meetingStats.meetingCount +
                            mergePreview.meetingStats.meetingCount}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs">Milestones</dt>
                        <dd className="mt-1 font-medium text-pro-text-main">
                          {current.milestones.length +
                            mergePreview.milestones.length}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs">Commitments</dt>
                        <dd className="mt-1 font-medium text-pro-text-main">
                          {current.tasks.length + mergePreview.tasks.length}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs">Alternate name</dt>
                        <dd className="mt-1 font-medium text-pro-text-main">
                          {mergePreview.project.displayTitle}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              )}
              {mergeState === 'error' && (
                <p role="alert" className="mt-4 text-sm text-pro-urgent">
                  Pluto couldn’t merge these projects. Both projects are
                  unchanged.
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!selectedMergeSource || mergeState === 'saving'}
                  onClick={() => void performMerge()}
                  className="min-h-10 rounded-md bg-pro-accent px-4 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-40"
                >
                  {mergeState === 'saving'
                    ? 'Merging…'
                    : selectedMergeSource
                      ? `Merge ${selectedMergeSource.name}`
                      : 'Choose a project'}
                </button>
                <button
                  type="button"
                  onClick={() => setMergeOpen(false)}
                  className={quietButton}
                >
                  Keep projects separate
                </button>
              </div>
            </section>
          )}

          {lastMerged && (
            <div
              aria-live="polite"
              className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-4 rounded-lg border border-pro-border bg-pro-bg px-4 py-3 text-sm shadow-lg"
            >
              <span>{lastMerged.name} was merged into this project.</span>
              <button
                type="button"
                disabled={mergeState === 'saving'}
                onClick={() => void undoMerge()}
                className="rounded font-medium text-pro-accent underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
              >
                Undo
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
