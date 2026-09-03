import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DreamingEntityType,
  MAX_DREAMING_PROPOSALS,
} from '../../../../electron/dreaming/types';
import {
  type DreamingDecisionResult,
  type DreamingProposalRecord,
  acceptDreamingProposal,
  getPendingDreamingProposals,
  rejectDreamingProposal,
} from '../../../api/knowledgeGraph';

export interface PreparedUpdateEvidenceMeeting {
  id: string;
  title?: string | null;
  date?: string | null;
}

const labelByKind: Record<DreamingProposalRecord['kind'], string> = {
  project_summary: 'Current focus',
  project_milestone: 'Milestone',
  project_commitment: 'Commitment',
  project_alias: 'Alternate project name',
  person_headline: 'Relationship headline',
  person_focus: 'Current focus',
  person_collaborator: 'Collaborator',
  person_alias: 'Alternate person name',
};

const proposalValue = (proposal: DreamingProposalRecord): string => {
  switch (proposal.kind) {
    case 'project_summary':
      return proposal.payload.summary;
    case 'project_milestone':
      return proposal.payload.name;
    case 'project_commitment':
      return proposal.payload.task;
    case 'project_alias':
    case 'person_alias':
      return proposal.payload.alias;
    case 'person_headline':
      return proposal.payload.headline;
    case 'person_focus':
      return proposal.payload.focus;
    case 'person_collaborator':
      return proposal.payload.name;
  }
};

const formatDate = (value?: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
};

const decisionMessage = (result: DreamingDecisionResult): string => {
  switch (result.status) {
    case 'accepted':
      return 'Update accepted.';
    case 'rejected':
      return 'Update rejected.';
    case 'stale':
      return 'This prepared update is out of date. Prepare updates again.';
    case 'review_required':
      return 'This update needs a manual identity review.';
    case 'not_pending':
      return 'This update has already been reviewed.';
    default:
      return 'This update is no longer pending.';
  }
};

const actionClass =
  'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent disabled:opacity-45 sm:min-h-10';

export function PreparedUpdates({
  entityId,
  entityType,
  evidenceMeetings = [],
  reloadToken = 0,
  onCanonicalChange,
  onOpenMeeting,
  onReviewIdentity,
}: {
  entityId: string;
  entityType: DreamingEntityType;
  evidenceMeetings?: PreparedUpdateEvidenceMeeting[];
  reloadToken?: number;
  onCanonicalChange?: () => void | Promise<void>;
  onOpenMeeting?: (meetingId: string) => void;
  onReviewIdentity?: () => void;
}) {
  const [proposals, setProposals] = useState<DreamingProposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [results, setResults] = useState<
    Record<
      string,
      { status: DreamingDecisionResult['status']; message: string }
    >
  >({});
  const [announcement, setAnnouncement] = useState('');
  const [decisionNotice, setDecisionNotice] = useState('');
  const [refreshWarning, setRefreshWarning] = useState(false);
  const requestGeneration = useRef(0);
  const scopeKey = `${entityType}:${entityId}`;
  const activeScopeKey = useRef(scopeKey);
  const decidedProposalIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const sectionRef = useRef<HTMLElement>(null);
  const completionRef = useRef<HTMLParagraphElement>(null);
  const focusAfterDecision = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    const generation = ++requestGeneration.current;
    if (activeScopeKey.current !== scopeKey) {
      activeScopeKey.current = scopeKey;
      decidedProposalIds.current = new Set();
      setProposals([]);
      setResults({});
      setDecisionNotice('');
      setRefreshWarning(false);
      setSavingId(null);
    }
    setLoading(true);
    setLoadError(false);
    try {
      const pending = await getPendingDreamingProposals({
        entityId,
        entityType,
      });
      if (!mounted.current || generation !== requestGeneration.current)
        return false;
      setProposals(
        pending
          .slice(0, MAX_DREAMING_PROPOSALS)
          .filter((item) => !decidedProposalIds.current.has(item.id)),
      );
      setResults({});
      setDecisionNotice('');
      return true;
    } catch {
      if (mounted.current && generation === requestGeneration.current)
        setLoadError(true);
      return false;
    } finally {
      if (mounted.current && generation === requestGeneration.current)
        setLoading(false);
    }
  }, [entityId, entityType, scopeKey]);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load, reloadToken]);

  useEffect(() => {
    if (!focusAfterDecision.current) return;
    focusAfterDecision.current = false;
    const nextAction = sectionRef.current?.querySelector<HTMLButtonElement>(
      'ol button[data-prepared-update-action]:not(:disabled)',
    );
    (nextAction ?? completionRef.current)?.focus();
  }, [proposals, decisionNotice]);

  const refreshAfterDecision = useCallback(async () => {
    const refreshScopeKey = scopeKey;
    if (!mounted.current || activeScopeKey.current !== refreshScopeKey) return;
    const generation = ++requestGeneration.current;
    setRefreshWarning(false);
    const refreshes = await Promise.allSettled([
      Promise.resolve().then(() => {
        if (
          !mounted.current ||
          activeScopeKey.current !== refreshScopeKey ||
          generation !== requestGeneration.current
        )
          return;
        return onCanonicalChange?.();
      }),
      getPendingDreamingProposals({ entityId, entityType }).then((pending) => {
        if (
          activeScopeKey.current !== refreshScopeKey ||
          !mounted.current ||
          generation !== requestGeneration.current
        )
          return;
        setProposals(
          pending.filter((item) => !decidedProposalIds.current.has(item.id)),
        );
      }),
    ]);
    if (
      activeScopeKey.current !== refreshScopeKey ||
      !mounted.current ||
      generation !== requestGeneration.current
    )
      return;
    if (refreshes.some((result) => result.status === 'rejected')) {
      setRefreshWarning(true);
      return;
    }
    setLoadError(false);
  }, [entityId, entityType, onCanonicalChange, scopeKey]);

  const decide = async (
    proposal: DreamingProposalRecord,
    action: 'accept' | 'reject',
  ) => {
    const decisionScopeKey = scopeKey;
    setSavingId(proposal.id);
    setAnnouncement('');
    let result: DreamingDecisionResult;
    try {
      result = await (action === 'accept'
        ? acceptDreamingProposal
        : rejectDreamingProposal)({
        entityId,
        entityType,
        proposalId: proposal.id,
      });
    } catch {
      if (!mounted.current || activeScopeKey.current !== decisionScopeKey)
        return;
      const message = 'Pluto couldn’t save this choice. Try again.';
      setResults((current) => ({
        ...current,
        [proposal.id]: { status: 'not_pending', message },
      }));
      setAnnouncement(message);
      setSavingId(null);
      return;
    }

    if (!mounted.current || activeScopeKey.current !== decisionScopeKey) return;

    const message = decisionMessage(result);
    setAnnouncement(message);
    setSavingId(null);
    if (result.status === 'accepted' || result.status === 'rejected') {
      decidedProposalIds.current.add(proposal.id);
      focusAfterDecision.current = true;
      setProposals((current) =>
        current.filter((item) => item.id !== proposal.id),
      );
      setDecisionNotice(message);
      await refreshAfterDecision();
    } else if (result.status === 'stale' || result.status === 'not_pending') {
      decidedProposalIds.current.add(proposal.id);
      focusAfterDecision.current = true;
      setProposals((current) =>
        current.filter((item) => item.id !== proposal.id),
      );
      setDecisionNotice(message);
    } else {
      setResults((current) => ({
        ...current,
        [proposal.id]: { status: result.status, message },
      }));
    }
  };

  if (
    !loading &&
    !loadError &&
    proposals.length === 0 &&
    !decisionNotice &&
    !refreshWarning
  )
    return null;

  return (
    <section
      ref={sectionRef}
      aria-labelledby={`prepared-updates-${entityType}-${entityId}`}
      className="border-y border-pro-border/45 py-6"
    >
      <h2
        id={`prepared-updates-${entityType}-${entityId}`}
        tabIndex={-1}
        className="text-lg font-semibold"
      >
        Prepared updates
      </h2>
      <p className="mt-1 max-w-[65ch] text-sm leading-6 text-pro-text-muted">
        Review changes Pluto prepared from linked meeting notes before they
        become part of this dossier.
      </p>

      {loading ? (
        <p aria-busy="true" className="mt-4 text-sm text-pro-text-muted">
          Checking for prepared updates…
        </p>
      ) : loadError ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-pro-text-muted">
          <p>Pluto couldn’t load prepared updates.</p>
          <button
            type="button"
            onClick={() => void load()}
            className={actionClass}
          >
            Try again
          </button>
        </div>
      ) : (
        <ol className="mt-4 divide-y divide-pro-border/40 border-y border-pro-border/45 empty:hidden">
          {proposals.map((proposal) => {
            const result = results[proposal.id];
            const acceptDisabled =
              savingId !== null || result?.status === 'review_required';
            const rejectDisabled = savingId !== null;
            return (
              <li key={proposal.id} className="py-4">
                <p className="text-xs font-medium text-pro-text-muted">
                  {labelByKind[proposal.kind]}
                </p>
                <p className="mt-1 max-w-[65ch] text-sm leading-6">
                  {proposalValue(proposal)}
                </p>
                {(proposal.kind === 'project_alias' ||
                  proposal.kind === 'person_alias') && (
                  <p className="mt-1 text-xs text-pro-text-muted">
                    Accepting adds an alternate name. The displayed name stays
                    unchanged.
                  </p>
                )}
                {proposal.evidence.length > 0 ? (
                  <details className="mt-2 text-sm">
                    <summary className="min-h-11 cursor-pointer rounded py-2 text-pro-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent sm:min-h-10">
                      Show source
                    </summary>
                    <ul className="space-y-3 border-l border-pro-border/60 pl-3 text-pro-text-muted">
                      {proposal.evidence.map((evidence, index) => {
                        const meeting = evidenceMeetings.find(
                          (item) => item.id === evidence.meetingId,
                        );
                        const date = formatDate(meeting?.date);
                        return (
                          <li key={`${evidence.meetingId}-${index}`}>
                            {onOpenMeeting ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenMeeting(evidence.meetingId)
                                }
                                className="min-h-11 rounded text-left text-xs text-pro-text-muted hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent sm:min-h-10"
                              >
                                {meeting?.title || 'Linked meeting'}
                                {date ? ` · ${date}` : ''}
                              </button>
                            ) : (
                              <p className="text-xs">
                                {meeting?.title || 'Linked meeting'}
                                {date ? ` · ${date}` : ''}
                              </p>
                            )}
                            <q className="mt-1 block max-w-[65ch] text-sm leading-6 text-pro-text-main">
                              {evidence.excerpt}
                            </q>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1">
                  <button
                    type="button"
                    data-prepared-update-action="accept"
                    disabled={acceptDisabled}
                    onClick={() => void decide(proposal, 'accept')}
                    className={`${actionClass} text-pro-accent hover:bg-pro-hover`}
                  >
                    {savingId === proposal.id ? 'Saving…' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    data-prepared-update-action="reject"
                    disabled={rejectDisabled}
                    onClick={() => void decide(proposal, 'reject')}
                    className={`${actionClass} text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main`}
                  >
                    Reject
                  </button>
                </div>
                {result ? (
                  <div className="mt-2 text-sm text-pro-text-muted">
                    <p>{result.message}</p>
                    {result.status === 'review_required' && onReviewIdentity ? (
                      <button
                        type="button"
                        onClick={onReviewIdentity}
                        className={actionClass}
                      >
                        Review identity
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {decisionNotice ? (
        <p
          ref={completionRef}
          tabIndex={-1}
          className="mt-3 rounded text-sm text-pro-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-pro-accent"
        >
          {decisionNotice}
        </p>
      ) : null}
      {refreshWarning ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-pro-text-muted">
          <p>
            The choice was saved, but Pluto couldn’t refresh the dossier. The
            saved decision is unchanged.
          </p>
          <button
            type="button"
            onClick={() => void refreshAfterDecision()}
            className={actionClass}
          >
            Retry refresh
          </button>
        </div>
      ) : null}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
