import { useId } from 'react';
import type { PersonBriefingMeeting } from '../../utils/personBriefing';
import {
  PERSON_PROFILE_SECTIONS,
  type PersonProfileClaim,
} from '../../utils/personProfile';

export const PersonProfileContent = ({
  claims,
  meetings,
  refreshing,
  outdated,
  failed,
  queued = false,
  onRefresh,
  onOpenMeeting,
}: {
  claims: PersonProfileClaim[];
  meetings: PersonBriefingMeeting[];
  refreshing: boolean;
  outdated: boolean;
  failed: boolean;
  queued?: boolean;
  onRefresh: () => void;
  onOpenMeeting: (meetingId: string) => void;
}) => {
  const id = useId();
  const sections = Object.entries(PERSON_PROFILE_SECTIONS).flatMap(
    ([key, label]) => {
      const items = claims
        .filter((claim) => claim.section === key)
        .slice(0, key === 'overview' ? 1 : 4);
      return items.length ? [{ key, label, items }] : [];
    },
  );
  const sourceIds = new Set(
    claims.flatMap((claim) =>
      claim.citations.map((citation) => citation.meeting_id),
    ),
  );
  const latest = meetings
    .filter((meeting) => sourceIds.has(meeting.id))
    .map((meeting) =>
      Date.parse(meeting.started_at || meeting.created_at || ''),
    )
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const date = (value: string | number) =>
    new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return (
    <div className="person-profile">
      <nav className="person-profile__contents" aria-label="Profile sections">
        {sections.map((section) => (
          <a key={section.key} href={`#${id}-${section.key}`}>
            {section.label}
          </a>
        ))}
        <a href="#person-commitments">Commitments</a>
        <a href="#person-meetings">Conversation history</a>
      </nav>
      <div className="person-profile__body">
        <p className="person-profile__coverage">
          Based on {sourceIds.size} source{' '}
          {sourceIds.size === 1 ? 'conversation' : 'conversations'}
          {latest ? ` · Context through ${date(latest)}` : ''}
        </p>
        {(refreshing || outdated || failed || queued) && (
          <p className="person-profile__status" role="status">
            {refreshing
              ? 'Updating this profile. The last sourced account remains available.'
              : queued
                ? 'Profile refresh queued while Pluto finishes other work. The last sourced account remains available.'
                : failed
                  ? 'The profile could not be updated. The last sourced account remains available.'
                  : 'This context was marked outdated. Treat it as a historical account.'}
            {!refreshing && (
              <button type="button" onClick={onRefresh}>
                {failed ? 'Retry profile' : 'Refresh profile'}
              </button>
            )}
          </p>
        )}
        {sections.map(({ key, label, items }) => (
          <section
            className={`person-profile__section ${key === 'overview' ? 'person-profile__section--overview' : ''}`}
            id={`${id}-${key}`}
            key={key}
            aria-labelledby={`${id}-${key}-heading`}
          >
            <h2 id={`${id}-${key}-heading`}>{label}</h2>
            {items.map((claim, index) => (
              <div className="person-profile__claim" key={`${key}-${index}`}>
                {key !== 'overview' && claim.title && <h3>{claim.title}</h3>}
                <p>{claim.summary}</p>
                <details className="person-profile__sources">
                  <summary>
                    View{' '}
                    {claim.citations.length === 1
                      ? 'source'
                      : `${claim.citations.length} sources`}
                  </summary>
                  {claim.citations.map((citation) => {
                    const meeting = meetings.find(
                      (item) => item.id === citation.meeting_id,
                    );
                    const captured = meeting?.started_at || meeting?.created_at;
                    return (
                      <div key={`${citation.meeting_id}-${citation.quote}`}>
                        <button
                          type="button"
                          onClick={() => onOpenMeeting(citation.meeting_id)}
                        >
                          {meeting?.title || 'Open source conversation'}
                        </button>
                        <span>
                          {meeting?.evidence === 'confirmed'
                            ? 'Confirmed conversation'
                            : 'Mentioned in notes'}
                          {captured ? ` · ${date(captured)}` : ''}
                        </span>
                        <blockquote>{citation.quote}</blockquote>
                      </div>
                    );
                  })}
                </details>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
};
