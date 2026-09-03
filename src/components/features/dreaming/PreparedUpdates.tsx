import { useCallback, useEffect, useState } from 'react';
import type { DreamingEntityType } from '../../../../electron/dreaming/types';
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
  project_alias: 'Project name',
  person_headline: 'Relationship headline',
  person_focus: 'Current focus',
  person_collaborator: 'Collaborator',
  person_alias: 'Person name',
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
}: {
  entityId: string;
  entityType: DreamingEntityType;
  evidenceMeetings?: PreparedUpdateEvidenceMeeting[];
  reloadToken?: number;
  onCanonicalChange?: () => void | Promise<void>;
}) {
  const [proposals, setProposals] = useState<DreamingProposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const pending = await getPendingDreamingProposals({
        entityId,
        entityType,
      });
      setProposals(pending);
      setResults({});
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const decide = async (
    proposal: DreamingProposalRecord,
    action: 'accept' | 'reject',
  ) => {
    setSavingId(proposal.id);
    setAnnouncement('');
    try {
      const result = await (action === 'accept'
        ? acceptDreamingProposal
        : rejectDreamingProposal)({
        entityId,
        entityType,
        proposalId: proposal.id,
      });
      const message = decisionMessage(result);
      setResults((current) => ({ ...current, [proposal.id]: message }));
      setAnnouncement(message);
      if (result.status === 'accepted' || result.status === 'rejected') {
        await onCanonicalChange?.();
      }
      const pending = await getPendingDreamingProposals({
        entityId,
        entityType,
      });
      setProposals((current) => {
        const decided = current.filter((item) => item.id === proposal.id);
        return [
          ...decided,
          ...pending.filter((item) => item.id !== proposal.id),
        ];
      });
    } catch {
      const message = 'Pluto couldn’t save this choice. Try again.';
      setResults((current) => ({ ...current, [proposal.id]: message }));
      setAnnouncement(message);
    } finally {
      setSavingId(null);
    }
  };

  if (!loading && !loadError && proposals.length === 0) return null;

  return (
    <section
      aria-labelledby={`prepared-updates-${entityType}-${entityId}`}
      className="border-y border-pro-border/45 py-6"
    >
      <h2
        id={`prepared-updates-${entityType}-${entityId}`}
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
        <ol className="mt-4 divide-y divide-pro-border/40 border-y border-pro-border/45">
          {proposals.map((proposal) => {
            const result = results[proposal.id];
            const disabled =
              savingId === proposal.id ||
              Boolean(result && !result.includes('couldn’t'));
            return (
              <li key={proposal.id} className="py-4">
                <p className="text-xs font-medium text-pro-text-muted">
                  {labelByKind[proposal.kind]}
                </p>
                <p className="mt-1 max-w-[65ch] text-sm leading-6">
                  {proposalValue(proposal)}
                </p>
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
                            <p className="text-xs">
                              {meeting?.title || 'Linked meeting'}
                              {date ? ` · ${date}` : ''}
                            </p>
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
                    disabled={disabled}
                    onClick={() => void decide(proposal, 'accept')}
                    className={`${actionClass} text-pro-accent hover:bg-pro-hover`}
                  >
                    {savingId === proposal.id ? 'Saving…' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void decide(proposal, 'reject')}
                    className={`${actionClass} text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main`}
                  >
                    Reject
                  </button>
                </div>
                {result ? (
                  <p className="mt-2 text-sm text-pro-text-muted">{result}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
