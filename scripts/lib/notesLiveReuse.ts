import {
  generateMeetingNotes,
  precomputeNextMeetingNotesLeaf,
} from '../../electron/llm/meetingNotesPipeline';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { NotesStageCache } from '../../electron/llm/meetingNotesStageCache';
import {
  type GenerateMeetingNotesInput,
  MeetingNotesError,
  NOTES_OLLAMA_MODEL,
  type NotesDraft,
  type NotesSource,
} from '../../electron/llm/meetingNotesTypes';

/** Reconstruct the final live offer normalization used by AudioManager.
 * This is a saved-snapshot diagnostic, not a replay of historical offer timing.
 */
export function savedLiveNotesSource(raw: string): NotesSource | null {
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload.liveSegments) || !payload.liveSegments.length)
    return null;
  const merged: Array<{ speaker: string | number | null; text: string }> = [];
  const rows = [...payload.liveSegments];
  if (
    rows.some(
      (row) => typeof row.text !== 'string' || !Number.isFinite(row.startTime),
    )
  )
    throw new Error('invalid_saved_live_snapshot');
  rows.sort((a, b) => a.startTime - b.startTime);
  for (const row of rows) {
    const prior = merged.at(-1);
    if (prior?.speaker === row.speaker)
      prior.text = `${prior.text.trim()} ${row.text.trim()}`.trim();
    else merged.push({ speaker: row.speaker ?? null, text: row.text });
  }
  return createNotesSource(JSON.stringify({ segments: merged }));
}

/** Exercise real planners and exact cache keys with explicit synthetic responses.
 * No provider, DB, network, quality acceptance, or latency claim is involved.
 */
export async function inspectLiveNotesReuse(
  live: NotesSource,
  canonical: NotesSource,
) {
  let phase: 'live' | 'final' = 'live';
  const liveKeys = new Set<string>();
  const finalLookups = new Set<string>();
  const hits = new Set<string>();
  class ObservedCache extends NotesStageCache {
    override get(key: string) {
      const result = super.get(key);
      if (phase === 'final') {
        finalLookups.add(key);
        if (result && liveKeys.has(key)) hits.add(key);
      }
      return result;
    }
    override set(key: string, draft: NotesDraft) {
      if (phase === 'live') liveKeys.add(key);
      super.set(key, draft);
    }
  }
  const cache = new ObservedCache(() => 0);
  let liveDisposition = 'not_attempted';
  let finalDisposition = 'planned';
  const input: GenerateMeetingNotesInput = {
    source: live,
    context: {
      userNotes: '',
      template: 'auto',
      trustedUserTerms: [],
      entityHints: [],
    },
    compactWriterContract: true,
    reviewProtocol: 'editor',
    provider: 'ollama',
    model: NOTES_OLLAMA_MODEL,
    contextTokens: 16384,
    cacheKey: 'identical-configuration-planning-only',
    stageCache: cache,
    generate: async (request) => {
      if (request.task === 'notesAudit')
        return (
          request.prompt.match(
            /BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/,
          )?.[1] ?? '{}'
        );
      const source = phase === 'live' ? live : canonical;
      const span = request.sourceSpans?.[0];
      if (!span) throw new Error('planning_source_span_missing');
      return JSON.stringify({
        title: null,
        sections: [
          {
            title: 'Diagnostic placeholder',
            items: [
              {
                kind: 'point',
                text: source.segments[span.segment].text.slice(
                  span.start,
                  span.end,
                ),
                owner: null,
                due: null,
                sources: [span],
              },
            ],
          },
        ],
      });
    },
  };
  try {
    // Precompute at most three closed leaves; the growing final leaf is not cached.
    for (let attempt = 0; attempt < 3; attempt++) {
      liveDisposition = await precomputeNextMeetingNotesLeaf(input);
      if (liveDisposition !== 'generated') break;
    }
  } catch (error) {
    if (!(error instanceof MeetingNotesError)) throw error;
    liveDisposition = error.code.split(':')[0];
  }
  let liveFinalPlanLeaves = 1;
  let livePlanningError: string | null = null;
  try {
    await generateMeetingNotes({
      ...input,
      stageCache: undefined,
      onPlan: (plan) => {
        liveFinalPlanLeaves = plan.plannedLeafCount;
      },
    });
  } catch (error) {
    if (!(error instanceof MeetingNotesError)) throw error;
    livePlanningError = error.code.split(':')[0];
  }
  phase = 'final';
  try {
    await generateMeetingNotes({ ...input, source: canonical });
  } catch (error) {
    if (!(error instanceof MeetingNotesError)) throw error;
    finalDisposition = error.code.split(':')[0];
  }
  return {
    mode: 'synthetic_response_cache_identity_probe',
    modelRequests: 0,
    liveSegments: live.segments.length,
    canonicalSegments: canonical.segments.length,
    liveDisposition,
    liveFinalPlanLeaves,
    livePlanningError,
    finalDisposition,
    cachedLivePackets: liveKeys.size,
    finalWriterKeys: finalLookups.size,
    matchingCachedPackets: hits.size,
    qualityEvaluated: false,
    limitation:
      'Final saved live snapshot only; no historical offer/admission, capture timing, inference, or publication replay.',
  };
}
