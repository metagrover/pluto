import type { MeetingAskPlutoLiveTranscriptSegment } from '../../src/types/askPluto';
import type {
  LiveMeetingContextCheckpointV1,
  MeetingContextIngestionSegment,
} from '../../src/types/meetingContext';
import { parseLiveMeetingCommand } from '../../src/utils/liveMeetingCommands';
import { resolveMeetingSpeakerLabel } from '../../src/utils/meetingSpeakerProvenance';
import { liveActionHasCommitment } from './liveMeetingGrounding';
import { routeMeetingAskPlutoAssistance } from './meetingAskPlutoAssistance';

export type LiveMeetingQueryIntent =
  | 'recent_range'
  | 'speaker_recall'
  | 'decision'
  | 'action'
  | 'meeting_summary'
  | 'clarification'
  | 'coaching'
  | 'advice'
  | 'fact';

export interface LiveMeetingContextSelection {
  intent: LiveMeetingQueryIntent;
  segments: MeetingAskPlutoLiveTranscriptSegment[];
  totalConfirmedSegments: number;
  temporalRange?: {
    startMs: number;
    endMs: number;
  };
  speakerStats?: LiveMeetingSpeakerStats[];
}

export interface LiveMeetingSpeakerStats {
  speaker: string;
  segmentCount: number;
  characterCount: number;
  questionCount: number;
  longTurnCount: number;
}

interface MeetingIndexState {
  segmentsById: Map<string, MeetingAskPlutoLiveTranscriptSegment>;
  orderedSegments: MeetingAskPlutoLiveTranscriptSegment[];
  storedCharacters: number;
}

const DEFAULT_SEGMENT_LIMIT = 2_000;
const DEFAULT_CHARACTER_LIMIT = 1_500_000;
const DEFAULT_SELECTION_LIMIT = 24;
const SELECTION_CHARACTER_LIMIT = 8_000;
const DEFAULT_CHECKPOINT_CHARACTER_LIMIT = 200_000;

const STOP_WORDS = new Set([
  'a',
  'about',
  'and',
  'are',
  'did',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'last',
  'me',
  'of',
  'on',
  'said',
  'say',
  'the',
  'they',
  'this',
  'to',
  'was',
  'we',
  'what',
  'who',
  'why',
  'with',
  'meeting',
  'summarize',
  'summarise',
  'summary',
  'recap',
  'give',
  'brief',
  'conversation',
  'discussion',
  'please',
]);

const normalize = (value: string) => value.trim().toLocaleLowerCase();

const tokensFor = (value: string): string[] =>
  normalize(value)
    .replace(/\basync(?:hronous(?:ly)?)?\b/g, 'async')
    .match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu)
    ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [];

const recentDurationMs = (query: string): number | null => {
  const shortcut = parseLiveMeetingCommand(query);
  const resolvedQuery = shortcut.kind === 'command' ? shortcut.question : query;
  const match = normalize(resolvedQuery).match(
    /\b(?:last|past)\s+(\d{1,3})\s*(minute|minutes|min|mins|hour|hours|hr|hrs)\b/,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  const isHours = match[2].startsWith('h');
  return amount * (isHours ? 60 * 60_000 : 60_000);
};

export const classifyLiveMeetingQuery = (
  query: string,
  speakers: string[] = [],
): LiveMeetingQueryIntent => {
  const route = routeMeetingAskPlutoAssistance(query);
  const shortcut = parseLiveMeetingCommand(query);
  const resolvedQuery = shortcut.kind === 'command' ? shortcut.question : query;
  const normalized = normalize(resolvedQuery);
  if (
    recentDurationMs(resolvedQuery) !== null ||
    /\b(just now|recently|latest|catch me up|what (?:did|have) I miss(?:ed)?)\b/i.test(
      normalized,
    )
  ) {
    return 'recent_range';
  }
  if (route.mode === 'recall' && route.recallKind === 'catch_up') {
    return 'meeting_summary';
  }
  if (route.mode === 'coaching') return 'coaching';
  if (route.mode === 'recall' && route.recallKind === 'decision')
    return 'decision';
  if (
    route.mode === 'draft' &&
    /\b(?:actions?|commitments?|follow[- ]?up)\b/.test(normalized)
  )
    return 'action';
  if (
    /\b(actions?|commitments?|promises?|promised|todo|to-do|follow[- ]?ups?|owners?|deadlines?|next steps?)\b/.test(
      normalized,
    )
  ) {
    return 'action';
  }
  if (/\b(decide|decided|decisions?|agreed|agreements?)\b/.test(normalized)) {
    return 'decision';
  }
  if (route.mode === 'advice') return 'advice';
  if (route.mode === 'draft') return 'meeting_summary';
  if (
    /\b(confus|understand|clarif|unclear|lost|misunderst|make sense)\w*\b/.test(
      normalized,
    )
  ) {
    return 'clarification';
  }
  if (
    /\b(coach|coaching|improve|better|feedback|communicat|perform)\w*\b/.test(
      normalized,
    ) ||
    /\bhow (?:am|is|are|was|were)\b.{0,48}\bdoing\b/.test(normalized)
  ) {
    return 'coaching';
  }
  if (/\b(summar|summary|overview|discussion|happened)\w*\b/.test(normalized)) {
    return 'meeting_summary';
  }
  if (
    /\b(said|say|mention|tell|explain|think|talk|discuss)\w*\b/.test(
      normalized,
    ) &&
    speakers.some((speaker) => normalized.includes(normalize(speaker)))
  ) {
    return 'speaker_recall';
  }
  return 'fact';
};

const evenlySample = <T>(items: T[], limit: number): T[] => {
  if (limit <= 0) return [];
  if (items.length <= limit) return items;
  if (limit <= 1) return [items.at(-1) as T];
  const selected: T[] = [];
  for (let index = 0; index < limit; index += 1) {
    selected.push(
      items[Math.round((index * (items.length - 1)) / (limit - 1))],
    );
  }
  return selected;
};

const chronological = (segments: MeetingAskPlutoLiveTranscriptSegment[]) =>
  [...segments].sort(
    (left, right) =>
      left.timestampMs - right.timestampMs || left.id.localeCompare(right.id),
  );

const speakerStatsFor = (
  segments: MeetingAskPlutoLiveTranscriptSegment[],
): LiveMeetingSpeakerStats[] => {
  const stats = new Map<string, LiveMeetingSpeakerStats>();
  for (const segment of segments) {
    const current = stats.get(segment.speaker) ?? {
      speaker: segment.speaker,
      segmentCount: 0,
      characterCount: 0,
      questionCount: 0,
      longTurnCount: 0,
    };
    current.segmentCount += 1;
    current.characterCount += segment.text.length;
    if (segment.text.includes('?')) current.questionCount += 1;
    if (segment.text.length >= 320) current.longTurnCount += 1;
    stats.set(segment.speaker, current);
  }
  return [...stats.values()].sort(
    (left, right) => right.characterCount - left.characterCount,
  );
};

const cueScore = (intent: LiveMeetingQueryIntent, text: string): number => {
  const normalized = normalize(text);
  if (intent === 'decision') {
    return /\b(decide|decided|agreed|agreements?|settled|approv\w*|chose|chosen|go with|will not|won't|not going to|pending|unresolved|open question)\b/.test(
      normalized,
    )
      ? 8
      : 0;
  }
  if (intent === 'advice') {
    return /\b(blocked?|blockers?|pending|unresolved|risk|waiting|not approved|still needs?|no (?:owner|deadline)|open question)\b/.test(
      normalized,
    )
      ? 8
      : text.includes('?')
        ? 4
        : 0;
  }
  if (intent === 'action') {
    return /\b(will|shall|must|agreed to|committed to|i'll|we'll|actions?|todo|follow[- ]?ups?|deadlines?|by (?:monday|tuesday|wednesday|thursday|friday))\b/.test(
      normalized,
    )
      ? 8
      : 0;
  }
  if (intent === 'clarification') {
    return /\b(i don't understand|do you mean|can you explain|clarif|unclear|does that make sense|what do you mean)\w*\b/.test(
      normalized,
    )
      ? 8
      : 0;
  }
  if (intent === 'coaching') {
    const question = text.includes('?') ? 2 : 0;
    const longTurn = text.length >= 320 ? 2 : 0;
    return question + longTurn;
  }
  return 0;
};

// Select whole exchanges before flattening to canonical segments. A fragment
// budget alone starves confirmations and corrections in fast-turn transcripts.
const selectExchanges = (
  ordered: MeetingAskPlutoLiveTranscriptSegment[],
  query: string,
  intent: LiveMeetingQueryIntent,
): MeetingAskPlutoLiveTranscriptSegment[] => {
  const latest = ordered.at(-1)?.timestampMs ?? 0;
  const duration = recentDurationMs(query);
  const recent =
    intent === 'advice'
      ? 3 * 60_000
      : intent === 'recent_range'
        ? (duration ?? 3 * 60_000)
        : null;
  const candidates =
    recent === null
      ? ordered
      : ordered.filter((segment) => segment.timestampMs >= latest - recent);
  const windows: MeetingAskPlutoLiveTranscriptSegment[][] = [];
  for (const segment of candidates) {
    const window = windows.at(-1);
    if (
      !window ||
      segment.timestampMs - window[0].timestampMs > 45_000 ||
      segment.timestampMs - (window.at(-1)?.timestampMs ?? 0) > 20_000 ||
      window.reduce((sum, item) => sum + item.text.length, 0) +
        segment.text.length >
        900
    ) {
      windows.push([segment]);
    } else window.push(segment);
  }
  const queryTokens = new Set(
    tokensFor(query).filter(
      (token) =>
        intent !== 'decision' ||
        ![
          'agreed',
          'decided',
          'decisions',
          'decision',
          'agreements',
          'so',
          'far',
        ].includes(token),
    ),
  );
  const frequencies = new Map<string, number>();
  for (const window of windows) {
    for (const token of new Set(tokensFor(window.map((s) => s.text).join(' '))))
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  const ranked = windows
    .map((segments, position) => {
      const text = segments.map((s) => s.text).join(' ');
      const tokens = new Set(tokensFor(text));
      const topical = [...queryTokens].reduce(
        (score, token) =>
          score +
          (tokens.has(token)
            ? 3 * Math.log(1 + windows.length / (frequencies.get(token) ?? 1))
            : 0),
        0,
      );
      return {
        segments,
        position,
        score:
          topical +
          (intent === 'action' && liveActionHasCommitment(text, text)
            ? 30
            : 0) +
          Math.max(
            ...(intent === 'meeting_summary'
              ? (['decision', 'action', 'advice'] as LiveMeetingQueryIntent[])
              : [intent]
            ).map((cue) => cueScore(cue, text)),
          ) +
          position / Math.max(1, windows.length),
      };
    })
    .sort((a, b) => b.score - a.score);
  const chosen = new Map<number, MeetingAskPlutoLiveTranscriptSegment[]>();
  let characters = 0;
  let count = 0;
  const add = (position: number) => {
    const window = windows[position];
    if (!window || chosen.has(position)) return;
    const size = window.reduce((sum, s) => sum + s.text.length, 0);
    if (
      characters + size > SELECTION_CHARACTER_LIMIT ||
      count + window.length > 512
    )
      return;
    chosen.set(position, window);
    characters += size;
    count += window.length;
  };
  // A broad recap needs representative discussion as well as the current state.
  if (intent === 'meeting_summary' || intent === 'recent_range') {
    // Current discussion has priority; older major outcomes use remaining space.
    for (let i = windows.length - 1; i >= 0; i--) {
      if ((windows[i].at(-1)?.timestampMs ?? 0) >= latest - 12 * 60_000) add(i);
    }
    for (const position of [windows.length - 2, windows.length - 1, 0])
      add(position);
    for (const window of ranked.filter((w) => w.score >= 8).slice(0, 4))
      add(window.position);
    for (let i = 0; i < 12; i++)
      add(Math.round((i * Math.max(0, windows.length - 1)) / 11));
  }
  const focusedDecision = intent === 'decision';
  for (const window of intent === 'fact' ||
  intent === 'action' ||
  focusedDecision
    ? intent === 'action'
      ? ranked.filter((window, index) => index < 4 || window.score >= 30)
      : ranked.slice(0, 4)
    : ranked) {
    add(window.position);
    if (intent === 'fact' || intent === 'action' || focusedDecision)
      add(window.position + 1);
  }
  return [...chosen.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, segments]) => segments);
};

const sampleDiscussion = (
  segments: MeetingAskPlutoLiveTranscriptSegment[],
  limit: number,
) => {
  if (segments.length <= limit) return segments;
  const salient = segments.filter((segment) =>
    ['decision', 'action', 'advice'].some(
      (intent) => cueScore(intent as LiveMeetingQueryIntent, segment.text) > 0,
    ),
  );
  const selected = evenlySample(salient, Math.ceil((limit * 2) / 3));
  const ids = new Set(selected.map((segment) => segment.id));
  return chronological([
    ...selected,
    ...evenlySample(
      segments.filter((segment) => !ids.has(segment.id)),
      limit - selected.length,
    ),
  ]);
};

export const createLiveMeetingContextIndex = (
  options: {
    maxSegments?: number;
    maxCharacters?: number;
  } = {},
) => {
  const states = new Map<string, MeetingIndexState>();
  const maxSegments = Math.max(
    24,
    options.maxSegments ?? DEFAULT_SEGMENT_LIMIT,
  );
  const maxCharacters = Math.max(
    12_000,
    options.maxCharacters ?? DEFAULT_CHARACTER_LIMIT,
  );

  const stateFor = (meetingId: string): MeetingIndexState => {
    const existing = states.get(meetingId);
    if (existing) return existing;
    const created: MeetingIndexState = {
      segmentsById: new Map(),
      orderedSegments: [],
      storedCharacters: 0,
    };
    states.set(meetingId, created);
    return created;
  };

  const compact = (state: MeetingIndexState) => {
    state.orderedSegments = chronological([...state.segmentsById.values()]);
    while (
      state.orderedSegments.length > maxSegments ||
      state.storedCharacters > maxCharacters
    ) {
      const removed = state.orderedSegments.shift();
      if (!removed) break;
      state.segmentsById.delete(removed.id);
      state.storedCharacters -= removed.text.length;
    }
  };

  return {
    ingest(meetingId: string, inputSegments: MeetingContextIngestionSegment[]) {
      const normalizedMeetingId = meetingId.trim();
      if (!normalizedMeetingId || !Array.isArray(inputSegments)) return 0;
      const state = stateFor(normalizedMeetingId);
      let accepted = 0;
      for (const segment of inputSegments) {
        if (
          !segment ||
          !segment.confirmed ||
          !segment.id?.trim() ||
          !segment.text?.trim() ||
          !Number.isFinite(segment.timestampMs) ||
          segment.timestampMs < 0
        ) {
          continue;
        }
        const previous = state.segmentsById.get(segment.id);
        const stored: MeetingAskPlutoLiveTranscriptSegment = {
          id: segment.id,
          speaker: resolveMeetingSpeakerLabel(segment),
          ...(segment.source ? { source: segment.source } : {}),
          text: segment.text.trim(),
          timestampMs: segment.timestampMs,
          confirmed: true,
        };
        if (
          previous &&
          previous.text === stored.text &&
          previous.speaker === stored.speaker &&
          previous.timestampMs === stored.timestampMs
        ) {
          continue;
        }
        if (previous) state.storedCharacters -= previous.text.length;
        state.segmentsById.set(stored.id, stored);
        state.storedCharacters += stored.text.length;
        accepted += 1;
      }
      compact(state);
      return accepted;
    },

    select(
      meetingId: string,
      query: string,
      limit?: number,
      intentQuery = query,
    ): LiveMeetingContextSelection {
      const state = states.get(meetingId.trim());
      const ordered = state?.orderedSegments ?? [];
      const boundedLimit = Math.max(
        1,
        Math.min(DEFAULT_SELECTION_LIMIT, limit ?? DEFAULT_SELECTION_LIMIT),
      );
      const speakers = [...new Set(ordered.map((segment) => segment.speaker))];
      const intent = classifyLiveMeetingQuery(intentQuery, speakers);
      if (ordered.length === 0) {
        return { intent, segments: [], totalConfirmedSegments: 0 };
      }

      if (limit === undefined) {
        const named = speakers.filter((speaker) =>
          normalize(query).includes(normalize(speaker)),
        );
        const candidates =
          intent === 'speaker_recall' && named.length
            ? ordered.filter((segment) => named.includes(segment.speaker))
            : ordered;
        return {
          intent,
          segments: selectExchanges(candidates, query, intent),
          totalConfirmedSegments: ordered.length,
          ...(intent === 'coaching'
            ? { speakerStats: speakerStatsFor(ordered) }
            : {}),
          ...(intent === 'recent_range'
            ? {
                temporalRange: {
                  startMs: Math.max(
                    0,
                    (ordered.at(-1)?.timestampMs ?? 0) -
                      (recentDurationMs(intentQuery) ?? 3 * 60_000),
                  ),
                  endMs: ordered.at(-1)?.timestampMs ?? 0,
                },
              }
            : {}),
        };
      }

      const fitSelection = (
        segments: MeetingAskPlutoLiveTranscriptSegment[],
      ) => {
        let characters = 0;
        return segments.filter((segment, index) => {
          if (
            index > 0 &&
            characters + segment.text.length > SELECTION_CHARACTER_LIMIT
          )
            return false;
          characters += segment.text.length;
          return true;
        });
      };
      const latestTimestampMs = ordered.at(-1)?.timestampMs ?? 0;
      const durationMs = recentDurationMs(intentQuery);
      if (intent === 'recent_range') {
        const startMs = Math.max(
          0,
          latestTimestampMs - (durationMs ?? 3 * 60_000),
        );
        const candidates = ordered.filter(
          (segment) => segment.timestampMs >= startMs,
        );
        return {
          intent,
          segments: fitSelection(sampleDiscussion(candidates, boundedLimit)),
          totalConfirmedSegments: ordered.length,
          temporalRange: { startMs, endMs: latestTimestampMs },
        };
      }

      const normalizedQuery = normalize(intentQuery);
      const queryTokens = new Set(tokensFor(query));
      const namedSpeakers = speakers.filter((speaker) =>
        normalizedQuery.includes(normalize(speaker)),
      );
      let candidates = ordered;
      if (intent === 'speaker_recall' && namedSpeakers.length > 0) {
        const normalizedSpeakers = new Set(namedSpeakers.map(normalize));
        candidates = ordered.filter((segment) =>
          normalizedSpeakers.has(normalize(segment.speaker)),
        );
      }
      // When the retained meeting fits, let answer selection see every turn.
      // Lexical matching alone misses short agreements, pronouns and corrections.
      if (
        intent !== 'speaker_recall' &&
        candidates.length <= boundedLimit &&
        candidates.reduce((sum, item) => sum + item.text.length, 0) <=
          SELECTION_CHARACTER_LIMIT
      ) {
        return {
          intent,
          segments: candidates,
          totalConfirmedSegments: ordered.length,
          ...(intent === 'coaching'
            ? { speakerStats: speakerStatsFor(ordered) }
            : {}),
        };
      }
      if (
        intent === 'meeting_summary' &&
        !candidates.some((segment) =>
          tokensFor(segment.text).some((token) => queryTokens.has(token)),
        )
      ) {
        return {
          intent,
          segments: fitSelection(sampleDiscussion(candidates, boundedLimit)),
          totalConfirmedSegments: ordered.length,
        };
      }

      const weightDecisionTopic =
        intent === 'decision' &&
        /^(?:did|do|does|have|has|was|were|is|are)\b/.test(normalizedQuery);
      const tokenFrequency = new Map<string, number>();
      for (const segment of weightDecisionTopic ? candidates : []) {
        for (const token of new Set(tokensFor(segment.text))) {
          tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
        }
      }
      const scored = candidates
        .map((segment, position) => {
          const segmentTokens = new Set(tokensFor(segment.text));
          let score = cueScore(intent, segment.text);
          for (const token of queryTokens) {
            if (segmentTokens.has(token)) {
              // Distinctive topic words should outrank generic agreement cues.
              score += weightDecisionTopic
                ? 3 *
                  Math.log(
                    1 + candidates.length / (tokenFrequency.get(token) ?? 1),
                  )
                : 3;
            }
          }
          score += position / Math.max(1, candidates.length) / 2;
          return { segment, score };
        })
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.segment.timestampMs - left.segment.timestampMs,
        );
      const continuityCount = Math.min(
        2,
        Math.max(1, Math.floor(boundedLimit / 4)),
      );
      const selected = new Map<string, MeetingAskPlutoLiveTranscriptSegment>();
      let selectedCharacters = 0;
      const add = (segment: MeetingAskPlutoLiveTranscriptSegment) => {
        if (selected.has(segment.id) || selected.size >= boundedLimit) return;
        if (
          selectedCharacters + segment.text.length >
            SELECTION_CHARACTER_LIMIT &&
          selected.size > 0
        )
          return;
        selected.set(segment.id, segment);
        selectedCharacters += segment.text.length;
      };
      // Keep the explanation/correction next to a matching turn, even when it
      // uses a pronoun instead of repeating the search terms.
      const anchors: MeetingAskPlutoLiveTranscriptSegment[] = [];
      for (const { segment, score } of scored) {
        if (score < 1 || selected.size >= boundedLimit - continuityCount) break;
        add(segment);
        anchors.push(segment);
      }
      // Fill with matches before neighbors, so the first few matches cannot
      // consume the entire budget with background turns.
      for (const segment of ordered.slice(-continuityCount)) add(segment);
      for (const segment of anchors) {
        const position = ordered.findIndex((item) => item.id === segment.id);
        if (intent !== 'speaker_recall') {
          if (position > 0) add(ordered[position - 1]);
          if (position + 1 < ordered.length) add(ordered[position + 1]);
        }
      }
      return {
        intent,
        segments: chronological([...selected.values()]),
        totalConfirmedSegments: ordered.length,
        ...(intent === 'coaching'
          ? { speakerStats: speakerStatsFor(ordered) }
          : {}),
      };
    },

    clear(meetingId: string) {
      states.delete(meetingId.trim());
    },

    createCheckpoint(
      meetingId: string,
      generatedAt = new Date().toISOString(),
      characterLimit = DEFAULT_CHECKPOINT_CHARACTER_LIMIT,
    ): LiveMeetingContextCheckpointV1 | null {
      const normalizedMeetingId = meetingId.trim();
      const state = states.get(normalizedMeetingId);
      if (!state || state.orderedSegments.length === 0) return null;
      const selected: MeetingAskPlutoLiveTranscriptSegment[] = [];
      let characters = 0;
      for (
        let index = state.orderedSegments.length - 1;
        index >= 0;
        index -= 1
      ) {
        const segment = state.orderedSegments[index];
        if (
          selected.length > 0 &&
          characters + segment.text.length > characterLimit
        ) {
          break;
        }
        selected.push(segment);
        characters += segment.text.length;
      }
      selected.reverse();
      const latest = selected.at(-1);
      return {
        schemaVersion: 1,
        meetingId: normalizedMeetingId,
        updatedThrough: {
          segmentId: latest?.id ?? null,
          timestampMs: latest?.timestampMs ?? null,
        },
        segments: selected,
        generatedAt,
      };
    },

    restoreCheckpoint(checkpoint: LiveMeetingContextCheckpointV1): boolean {
      if (
        checkpoint.schemaVersion !== 1 ||
        !checkpoint.meetingId?.trim() ||
        !Array.isArray(checkpoint.segments)
      ) {
        return false;
      }
      this.clear(checkpoint.meetingId);
      this.ingest(checkpoint.meetingId, checkpoint.segments);
      return true;
    },

    inspect(meetingId: string) {
      const state = states.get(meetingId.trim());
      return {
        segmentCount: state?.orderedSegments.length ?? 0,
        storedCharacters: state?.storedCharacters ?? 0,
      };
    },
  };
};
