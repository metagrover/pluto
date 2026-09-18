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
  const processedPersonIds = new Set<string>();
  const processedNames = new Set<string>();

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

    if (resolvedPersonId) {
      processedPersonIds.add(resolvedPersonId);
    }
    processedNames.add(cleanName.toLowerCase());

    const binding = identityState?.bindings?.find(
      (b) => b.speaker === speakerKey,
    );
    const isVoiceMatched =
      binding?.assignment?.kind === 'voice_match_strong_v1';

    participants.push({
      id: `speaker:${speakerKey}`,
      name: cleanName,
      speakerKey,
      personId: resolvedPersonId,
      isSelf,
      isAnonymous: false,
      isVoiceMatched,
      turnCount: turns,
      role,
      source: 'transcript',
    });
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
      className="meeting-participants-popover absolute left-0 top-full mt-2 z-50 w-80 sm:w-96 rounded-2xl border border-pro-border/80 bg-pro-surface/95 backdrop-blur-md p-4 shadow-xl text-pro-text-main animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="flex items-center justify-between pb-3 border-b border-pro-border/40 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-pro-text-main tracking-[-0.01em]">
            Participants
          </h3>
          <span className="rounded-full bg-pro-hover px-2 py-0.5 text-[11px] font-medium text-pro-text-muted">
            {participants.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
          aria-label="Close participants list"
        >
          <X size={15} />
        </button>
      </div>

      <div className="max-h-[336px] overflow-y-auto space-y-0.5 pr-1 custom-scrollbar">
        {participants.map((participant) => {
          const initials = getInitials(participant.name);
          return (
            <div
              key={participant.id}
              className="meeting-participant-item flex items-center justify-between gap-3 px-2 py-2.5 rounded-xl hover:bg-pro-hover/70 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className={`meeting-participant-avatar h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold ${
                    participant.isSelf
                      ? 'bg-pro-accent/15 text-pro-accent border border-pro-accent/30'
                      : participant.isAnonymous
                        ? 'bg-pro-hover text-pro-text-muted border border-pro-border/60'
                        : 'bg-pro-surface border border-pro-border text-pro-text-main'
                  }`}
                  aria-hidden="true"
                >
                  {participant.isAnonymous ? (
                    <UserRound size={14} className="opacity-70" />
                  ) : (
                    initials
                  )}
                </div>

                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-[12.5px] font-medium text-pro-text-main truncate">
                      {participant.name}
                    </span>
                    {participant.isSelf && (
                      <span className="rounded px-1.5 py-px text-[10px] font-medium bg-pro-accent/10 text-pro-accent shrink-0 leading-[1.4]">
                        You
                      </span>
                    )}
                    {participant.personId &&
                      openLoopsByPersonId[participant.personId] > 0 && (
                        <span className="rounded border border-amber-500/25 bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-800 dark:text-amber-300 shrink-0 leading-[1.4]">
                          {openLoopsByPersonId[participant.personId]} open{' '}
                          {openLoopsByPersonId[participant.personId] === 1
                            ? 'loop'
                            : 'loops'}
                        </span>
                      )}
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-pro-text-muted min-w-0">
                    {participant.role ? (
                      <span className="truncate">{participant.role}</span>
                    ) : participant.turnCount > 0 ? (
                      <span className="shrink-0">
                        {participant.turnCount}{' '}
                        {participant.turnCount === 1 ? 'turn' : 'turns'}
                      </span>
                    ) : participant.source === 'calendar' ? (
                      <span>Calendar invitee</span>
                    ) : (
                      <span>In meeting</span>
                    )}
                    {participant.isVoiceMatched ? (
                      <span className="shrink-0 font-medium text-emerald-600 dark:text-emerald-400">
                        · Recognized voice
                      </span>
                    ) : participant.speakerKey &&
                      !participant.isAnonymous &&
                      participant.speakerKey !== participant.name ? (
                      <span className="opacity-50 shrink-0">
                        ·{' '}
                        {getAnonymousSpeakerDisplayLabel(
                          participant.speakerKey,
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-1">
                {participant.personId ? (
                  <div className="flex items-center gap-1">
                    {participant.isVoiceMatched && participant.speakerKey && (
                      <button
                        type="button"
                        onClick={() =>
                          onIdentifySpeaker(participant.speakerKey || null)
                        }
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-pro-text-muted hover:text-pro-text-main hover:bg-pro-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                        title={`Change speaker identification for ${participant.name}`}
                      >
                        Change
                      </button>
                    )}
                    <button
                      type="button"
                      data-open-person-id={participant.personId}
                      onClick={() => onOpenPerson(participant.personId!)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-medium text-pro-accent bg-pro-accent/10 hover:bg-pro-accent/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                      title={`View ${participant.name} profile in Pluto`}
                    >
                      <span>Profile</span>
                      <ArrowRight size={11} />
                    </button>
                  </div>
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
