import type { BlockedActionItem, Entity } from './db';
import type { MeetingPrep } from './meetingPrep';
import type { PreMeetingBrief, PreMeetingBriefItem } from './preMeetingBrief';
export function buildMeetingPrepBrief(
  prep: MeetingPrep,
  deps: {
    entities: (id: string) => Entity[];
    blockers: () => BlockedActionItem[];
  },
): PreMeetingBrief {
  const references = [...(prep.meetings || [])]
    .sort(
      (a, b) =>
        (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0),
    )
    .slice(0, 8);
  const evidence: PreMeetingBriefItem[] = [];
  const followUps: PreMeetingBriefItem[] = [];
  const seen = new Set<string>();
  const blockers = new Map(
    deps.blockers().map((item) => [item.id, item.blocker_name]),
  );
  for (const meeting of references) {
    const source = {
      sourceMeetingId: meeting.id,
      sourceLabel: meeting.title,
      sourceDate: meeting.date,
    };
    const paragraphs = meeting.context
      .split(/\n+/)
      .map((text) => text.trim())
      .filter((text) => text.length >= 12)
      .slice(0, 8);
    paragraphs.forEach((text, index) =>
      evidence.push({
        id: `history:${meeting.id}:${index}`,
        text: text.slice(0, 700),
        trustStatus: meeting.trustStatus || 'needs_review',
        ...source,
      }),
    );
    for (const entity of deps.entities(meeting.id)) {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(entity.metadata || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          continue;
        metadata = parsed;
      } catch {
        continue;
      }
      if (
        entity.type !== 'action_item' ||
        !['active', 'overdue', 'stale'].includes(entity.status || '') ||
        metadata.commitment_state !== 'confirmed' ||
        metadata.cancelled_at ||
        metadata.meeting_regeneration_retired_at ||
        seen.has(entity.id)
      )
        continue;
      seen.add(entity.id);
      followUps.push({
        id: `follow-up:${entity.id}`,
        text: `${entity.name}${entity.due_date ? ` · Due ${entity.due_date}` : ''}${blockers.has(entity.id) ? ` · Blocked by ${blockers.get(entity.id)}` : ''}`,
        trustStatus: 'grounded',
        ...source,
      });
    }
  }
  // Interleave meetings so one long notes document cannot consume the evidence budget.
  const grouped = references.map((meeting) =>
    evidence.filter((item) => item.sourceMeetingId === meeting.id),
  );
  const balanced = Array.from(
    { length: Math.max(0, ...grouped.map((items) => items.length)) },
    (_, index) =>
      grouped.flatMap((items) => (items[index] ? [items[index]] : [])),
  ).flat();
  const lastTime = balanced.slice(0, 8);
  return {
    title: prep.event.title,
    startsAt: prep.event.start,
    agenda: prep.event.agenda || null,
    relationship: references.length ? 'manual' : 'none',
    priorMeeting: null,
    lastTime,
    stillOpen: followUps.slice(0, 6),
    relevantContext: [],
    evidenceItems: balanced,
    overview: lastTime.slice(0, Math.min(4, Math.max(2, references.length))),
    talkingPoints: followUps.slice(0, 3).map((item) => ({
      ...item,
      id: `suggested:${item.id}`,
      text: `What is the latest update on “${item.text}”?`,
      trustStatus: 'inferred',
    })),
    synthesisStatus: 'fallback',
    emptyMessage: references.length
      ? null
      : 'Add a past meeting to build preparation context.',
  };
}

/** Keep generated historical prose, but never show a retired follow-up as open. */
export function refreshMeetingPrepBrief(
  saved: PreMeetingBrief,
  current: PreMeetingBrief,
): PreMeetingBrief {
  const open = new Map(current.stillOpen.map((item) => [item.id, item]));
  const refreshItems = (items: PreMeetingBriefItem[] | undefined) =>
    items?.flatMap((item) => {
      const actionId = item.id.startsWith('suggested:')
        ? item.id.slice('suggested:'.length)
        : item.id;
      if (!actionId.startsWith('follow-up:')) return [item];
      const active = open.get(actionId);
      if (!active) return [];
      return [
        item.id.startsWith('suggested:')
          ? {
              ...active,
              id: item.id,
              text: `What is the latest update on “${active.text}”?`,
              trustStatus: 'inferred' as const,
            }
          : active,
      ];
    });
  return {
    ...saved,
    title: current.title,
    startsAt: current.startsAt,
    agenda: current.agenda,
    stillOpen: current.stillOpen,
    overview: refreshItems(saved.overview),
    evidenceItems: refreshItems(saved.evidenceItems),
    talkingPoints: refreshItems(saved.talkingPoints),
  };
}
