import { ArrowRight, Sparkles, UserRound, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import type { MeetingIdentityState } from '../../api/identity';
import {
  type Entity,
  getPeopleBriefingSummaries,
} from '../../api/knowledgeGraph';
import { parsePersonRole } from '../../utils/personBriefing';
import {
  getAnonymousSpeakerDisplayLabel,
  isGenericSpeakerLabel,
  isIdentifiableSpeakerKey,
} from '../../utils/speakerReview';

export interface ResolvedMeetingParticipant {
  id: string;
  name: string;
  speakerKey?: string;
  speakerKeys?: string[];
  personId?: string | null;
  isSelf: boolean;
  isAnonymous: boolean;
  isVoiceMatched?: boolean;
  turnCount: number;
  role?: string | null;
  source: 'transcript' | 'identity' | 'calendar' | 'entity';
}

export function getInitials(name: string): string {
  const clean = name.replace(/ \(You\)$/iu, '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/u).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function resolveMeetingParticipants(params: {
  transcriptSegments?: Array<{ speaker?: string | number | null }>;
  speakerDisplayNames?: Record<string, string>;
  identityState?: MeetingIdentityState | null;
  meetingEntities?: Array<
    Entity & { mention_count?: number; context?: string | null }
  >;
  calendarAttendeeNames?: string[];
}): ResolvedMeetingParticipant[] {
  const {
    transcriptSegments = [],
    speakerDisplayNames = {},
    identityState = null,
    meetingEntities = [],
  } = params;

  // Count turns from transcript
  const turnCounts = new Map<string, number>();
  for (const seg of transcriptSegments) {
    const spk = String(seg.speaker || '').trim();
    if (spk && spk.toLowerCase() !== 'unknown') {
      turnCounts.set(spk, (turnCounts.get(spk) ?? 0) + 1);
    }
  }

  // Also gather speakers from identityState if any turns are missing
  if (identityState?.speakers) {
    for (const spk of identityState.speakers) {
      if (!turnCounts.has(spk)) {
        turnCounts.set(spk, 0);
      }
    }
  }

  const peopleById = new Map<string, { id: string; name: string }>();
  if (identityState?.people) {
    for (const p of identityState.people) {
      peopleById.set(p.id, p);
    }
  }
  for (const e of meetingEntities) {
    if (e.type === 'person') {
      peopleById.set(e.id, { id: e.id, name: e.name });
    }
  }

  const roleByPersonId = new Map<string, string>();
  if (identityState?.people) {
    for (const p of identityState.people) {
      if ((p as { role?: string }).role) {
        roleByPersonId.set(p.id, (p as { role?: string }).role!);
      }
    }
  }
  for (const e of meetingEntities) {
    if (e.type === 'person') {
      const parsedRole = parsePersonRole(e.metadata);
      if (parsedRole && parsedRole !== 'Known from conversations') {
        roleByPersonId.set(e.id, parsedRole);
      } else if (e.metadata) {
        try {
          const parsed = JSON.parse(e.metadata) as Record<string, unknown>;
          const fallbackRole =
            typeof parsed.role === 'string'
              ? parsed.role
              : typeof parsed.title === 'string'
                ? parsed.title
                : null;
          if (fallbackRole) roleByPersonId.set(e.id, fallbackRole);
        } catch {
          // ignore
        }
      }
    }
  }

  const bindingsBySpeaker = new Map<string, string | null>();
  if (identityState?.bindings) {
    for (const b of identityState.bindings) {
      bindingsBySpeaker.set(b.speaker, b.personId);
    }
  }

  const participants: ResolvedMeetingParticipant[] = [];
  const participantByPersonId = new Map<string, ResolvedMeetingParticipant>();

  // 1. Process transcript speakers
  for (const [speakerKey, turns] of turnCounts.entries()) {
    const boundPersonId = bindingsBySpeaker.get(speakerKey) ?? null;
    const explicitDisplayName =
      speakerDisplayNames[speakerKey] ??
      identityState?.speakerDisplayNames?.[speakerKey];

    // Try finding bound person
    let resolvedPersonId = boundPersonId;
    let name = explicitDisplayName?.trim();

    if (resolvedPersonId && peopleById.has(resolvedPersonId)) {
      name = name || peopleById.get(resolvedPersonId)!.name;
    } else {
      // Look up in people by candidate name or speakerKey
      const candidateName = name || speakerKey;
      const lower = candidateName.toLowerCase().replace(/ \(you\)$/u, '');
      for (const p of peopleById.values()) {
        if (p.name.toLowerCase() === lower) {
          resolvedPersonId = p.id;
          name = p.name;
          break;
        }
      }
    }

    const isSelf = Boolean(
      (resolvedPersonId &&
        identityState?.selfPersonId &&
        resolvedPersonId === identityState.selfPersonId) ||
        speakerKey.toLowerCase() === 'me' ||
        speakerKey.toLowerCase() === 'you' ||
        speakerKey.endsWith(' (You)') ||
        name?.endsWith(' (You)'),
    );

    const isAnonymous =
      !name &&
      !resolvedPersonId &&
      !isSelf &&
      (isGenericSpeakerLabel(speakerKey) ||
        /^Speaker \d+$/iu.test(speakerKey) ||
        /^Remote Speaker \d+$/iu.test(speakerKey) ||
        speakerKey.toLowerCase() === 'them');

    if (isAnonymous) {
      continue;
    }

    const cleanName = isSelf
      ? 'You'
      : name?.replace(/ \(You\)$/u, '') ||
        getAnonymousSpeakerDisplayLabel(speakerKey);

    const role = resolvedPersonId
      ? roleByPersonId.get(resolvedPersonId) || null
      : null;

    const binding = identityState?.bindings?.find(
      (b) => b.speaker === speakerKey,
    );
    const isVoiceMatched =
      binding?.assignment?.kind === 'voice_match_strong_v1';

    const existing = resolvedPersonId
      ? participantByPersonId.get(resolvedPersonId)
      : undefined;
    if (existing) {
      existing.speakerKeys?.push(speakerKey);
      existing.turnCount += turns;
      existing.isVoiceMatched ||= isVoiceMatched;
      continue;
    }

    const participant: ResolvedMeetingParticipant = {
      id: `speaker:${speakerKey}`,
      name: cleanName,
      speakerKey,
      speakerKeys: [speakerKey],
      personId: resolvedPersonId,
      isSelf,
      isAnonymous: false,
      isVoiceMatched,
      turnCount: turns,
      role,
      source: 'transcript',
    };
    participants.push(participant);
    if (resolvedPersonId)
      participantByPersonId.set(resolvedPersonId, participant);
  }

  // Sort: self first, then participants with profile, then by turn count, then alphabetical
  return participants.sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1;
    if (!a.isSelf && b.isSelf) return 1;
    if (a.personId && !b.personId) return -1;
    if (!a.personId && b.personId) return 1;
    if (b.turnCount !== a.turnCount) return b.turnCount - a.turnCount;
    return a.name.localeCompare(b.name);
  });
}

export interface MeetingParticipantsPopoverProps {
  participants: ResolvedMeetingParticipant[];
  onClose: () => void;
  onOpenPerson: (personId: string) => void;
  onIdentifySpeaker: (speakerKey: string | null) => void;
}

export const MeetingParticipantsPopover: React.FC<
  MeetingParticipantsPopoverProps
> = ({ participants, onClose, onOpenPerson, onIdentifySpeaker }) => {
  const dialogId = useId();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [openLoopsByPersonId, setOpenLoopsByPersonId] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    let cancelled = false;
    getPeopleBriefingSummaries()
      .then((summaries) => {
        if (cancelled || !summaries) return;
        const map: Record<string, number> = {};
        for (const s of summaries) {
          if (s.openCommitmentCount > 0) {
            map[s.id] = s.openCommitmentCount;
          }
        }
        setOpenLoopsByPersonId(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      id={dialogId}
      role="dialog"
      aria-modal="false"
      aria-label="Meeting participants"
      className="meeting-participants-popover absolute left-0 top-full z-50 mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-pro-border bg-pro-bg p-3 text-pro-text-main shadow-xl animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="mb-1 flex items-center justify-between px-2 pb-3 pt-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-semibold text-pro-text-main tracking-[-0.01em]">
            Participants
          </h3>
          <span className="text-[11px] text-pro-text-muted">
            {participants.length}{' '}
            {participants.length === 1 ? 'person' : 'people'}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-pro-text-muted transition-colors hover:bg-pro-hover/70 hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
          aria-label="Close participants list"
        >
          <X size={15} />
        </button>
      </div>

      <div className="max-h-[360px] overflow-y-auto border-t border-pro-border/60 custom-scrollbar">
        {participants.map((participant) => {
          const initials = getInitials(participant.name);
          const openLoopCount = participant.personId
            ? (openLoopsByPersonId[participant.personId] ?? 0)
            : 0;
          const contextLabel = participant.role
            ? participant.role
            : participant.source === 'calendar'
              ? 'Calendar invitee'
              : participant.isSelf
                ? 'Your profile'
                : 'In this meeting';
          return (
            <div
              key={participant.id}
              className="meeting-participant-item group grid min-h-[68px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-pro-border/40 px-2 py-3 transition-colors last:border-b-0 hover:bg-pro-hover/40"
            >
              <div
                className={`meeting-participant-avatar flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                  participant.isSelf
                    ? 'border-pro-accent/30 bg-pro-accent/10 text-pro-accent'
                    : participant.isAnonymous
                      ? 'border-pro-border/70 bg-pro-hover/60 text-pro-text-muted'
                      : 'border-pro-border/70 bg-pro-surface text-pro-text-main'
                }`}
                aria-hidden="true"
              >
                {participant.isAnonymous ? (
                  <UserRound size={14} className="opacity-70" />
                ) : (
                  initials
                )}
              </div>

              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium leading-5 text-pro-text-main">
                  {participant.name}
                </div>

                <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] leading-4 text-pro-text-muted">
                  <span className="min-w-0 truncate">{contextLabel}</span>
                  {openLoopCount > 0 && (
                    <>
                      <span
                        aria-hidden="true"
                        className="h-3 w-px shrink-0 bg-pro-border"
                      />
                      <span className="shrink-0 text-amber-700 dark:text-amber-300">
                        {openLoopCount} open{' '}
                        {openLoopCount === 1 ? 'loop' : 'loops'}
                      </span>
                    </>
                  )}
                </div>
                {participant.speakerKeys &&
                participant.speakerKeys.length > 1 ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-4 text-pro-text-muted">
                    {participant.speakerKeys.map((speakerKey) => (
                      <span key={speakerKey}>
                        {getAnonymousSpeakerDisplayLabel(speakerKey)}{' '}
                        <button
                          type="button"
                          onClick={() => onIdentifySpeaker(speakerKey)}
                          className="rounded px-0.5 font-medium underline decoration-pro-border underline-offset-2 hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                          title={`Change identification for ${speakerKey}`}
                        >
                          Change
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  (participant.isVoiceMatched ||
                    (participant.speakerKey &&
                      !participant.isAnonymous &&
                      !participant.isSelf &&
                      participant.speakerKey !== participant.name)) && (
                    <div className="mt-1 flex min-w-0 flex-col items-start gap-1 text-[11px] leading-4">
                      {participant.isVoiceMatched ? (
                        <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap text-emerald-700 dark:text-emerald-300">
                          <span className="h-1 w-1 rounded-full bg-current" />
                          Recognized voice
                          {participant.speakerKey && (
                            <button
                              type="button"
                              onClick={() =>
                                onIdentifySpeaker(
                                  participant.speakerKey || null,
                                )
                              }
                              className="ml-1 rounded px-0.5 font-medium text-pro-text-muted underline decoration-pro-border underline-offset-2 transition-colors hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                              title={`Change speaker identification for ${participant.name}`}
                            >
                              Change
                            </button>
                          )}
                        </span>
                      ) : participant.speakerKey &&
                        !participant.isAnonymous &&
                        !participant.isSelf &&
                        participant.speakerKey !== participant.name ? (
                        <span className="text-pro-text-muted/70">
                          {getAnonymousSpeakerDisplayLabel(
                            participant.speakerKey,
                          )}
                        </span>
                      ) : null}
                    </div>
                  )
                )}
              </div>

              <div className="shrink-0">
                {participant.personId ? (
                  <button
                    type="button"
                    data-open-person-id={participant.personId}
                    onClick={() => onOpenPerson(participant.personId!)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-pro-text-muted transition-colors hover:bg-pro-accent/10 hover:text-pro-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                    title={`View ${participant.name} profile in Pluto`}
                  >
                    <span>Profile</span>
                    <ArrowRight size={12} />
                  </button>
                ) : participant.isAnonymous &&
                  participant.speakerKey &&
                  isIdentifiableSpeakerKey(participant.speakerKey) ? (
                  <button
                    type="button"
                    data-identify-speaker={participant.speakerKey}
                    onClick={() =>
                      onIdentifySpeaker(participant.speakerKey || null)
                    }
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                    title={`Identify speaker ${participant.name}`}
                  >
                    <Sparkles size={11} className="text-pro-accent" />
                    <span>Identify</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
