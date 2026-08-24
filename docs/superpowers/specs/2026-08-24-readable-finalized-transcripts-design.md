# Readable Finalized Transcripts Design

**Issue:** [#659](https://github.com/metagrover/pluto/issues/659)  
**Related:** [#629](https://github.com/metagrover/pluto/issues/629), [#657](https://github.com/metagrover/pluto/issues/657)  
**Status:** Approved for implementation planning  
**Date:** 2026-08-24

## Problem

Parakeet finalization now calibrates mic/System clock skew and removes strong multi-word cross-channel playback. The latest private replay shows that this is necessary but insufficient for a readable saved transcript. After the shipped reconciliation removed 2,423 microphone words across 142 strong matching sequences, the canonical result still contained exact same-source duplicate segments, isolated sub-word letter fragments, short local fragments embedded inside longer remote speech, and a high density of `um` and `uh` tokens.

These defects cross two different trust boundaries. Exact duplicate segments and strictly evidenced channel artifacts are canonicalization defects. Ordinary spoken disfluencies may be faithful recognition and must not be deleted from persisted transcript evidence merely to make the document look polished. Pluto currently has a generic Electron-only cleanup utility, but production intentionally leaves it disabled because its broad near-duplicate and self-correction heuristics rewrite canonical text without source evidence.

## Goals

- Prevent exact same-source segment duplicates from entering future canonical Parakeet transcripts.
- Remove only ultra-short alphabetic mic fragments that have strong temporal evidence of remote-channel bleed.
- Present a concise readable transcript that suppresses unambiguous `um` and `uh` disfluencies without mutating persisted canonical text or word timing evidence.
- Supply the same readable transcript text to every automatic and manual meeting-analysis entry point.
- Persist content-free readability diagnostics separately from capture-integrity status.
- Improve existing persisted meetings at read time without rewriting their database rows.

## Non-goals

- Do not add acoustic echo cancellation, change capture routing, or derive a residual audio artifact.
- Do not remove `like`, `you know`, repetitions, false starts, or self-corrections in this pass.
- Do not guess whether a multi-character fragment is meaningless.
- Do not change search indexing or rewrite historical `transcript_json` rows.
- Do not make readability diagnostics an integrity failure or block analysis.
- Do not publish private transcript text, audio, meeting identifiers, or paths in fixtures or shipping records.

## Considered Approaches

### 1. Evidence-gated canonical repair plus a derived readable projection

Run narrow source-aware corrections during Parakeet reconciliation, then build a pure projection for display and analysis that strips only `um` and `uh`. Persist the unchanged canonical transcript and compute content-free readability diagnostics from it.

This is the selected approach. It removes pipeline defects at the boundary that created them while keeping editorial cleanup reversible and available to historical meetings.

### 2. Enable generic save-time transcript cleanup

Turn on the existing `cleanTranscriptSegments` path for every finalized meeting.

This would remove more visible noise with less new code, but its near-duplicate, merge, and self-correction rules can rewrite genuine speech. It also changes saved evidence and cannot improve a meeting until it is saved again. It is rejected.

### 3. Prompt the analysis model to ignore fillers

Leave transcript rendering unchanged and rely on the notes prompt to ignore disfluencies.

The prompt already tells the model to ignore filler. This does not improve the transcript users read, does not remove duplicate analysis input, and does not produce measurable quality diagnostics. It is rejected.

## Design

### Canonical reconciliation

Extend `collapseCrossChannelWordBleed` with two source-aware passes before the reconciled segments are returned:

1. **Exact same-source deduplication.** Within each source, collapse segments only when normalized text, start time, and end time are identical. Retain the first complete segment, including its identifier and word timing array. Do not use fuzzy text matching or a time window.
2. **Strict embedded-fragment removal.** Drop a microphone segment only when all of these are true:
   - normalized text is exactly one alphabetic character;
   - duration is no greater than 0.25 seconds;
   - the segment is fully contained in a System segment lasting at least 2 seconds;
   - the containing System segment has at least three recognized words.

The strict rule targets observed one-letter acoustic/recognition debris without removing multi-character acknowledgements or spelled letters outside competing remote speech. It runs only on the final dual-source canonical path. System segments are never removed by this rule.

Extend reconciliation provenance with content-free counts for exact same-source duplicates and embedded letter fragments removed. Legacy provenance without the new fields remains valid.

### Readable transcript projection

Add a pure utility under `src/utils` that accepts parsed transcript segments and returns new segment objects plus content-free statistics. It never mutates its input.

For each segment the projection:

- removes case-insensitive whole-word `um` and `uh` tokens;
- normalizes whitespace left by removal;
- drops a segment only when filler removal leaves no text;
- removes exact same-speaker duplicates with identical normalized text and identical timestamps so historical rows benefit immediately;
- removes the same strictly gated embedded one-letter fragments used by canonical reconciliation;
- preserves identifiers, speaker values, timestamps, and original word arrays on retained segment copies;
- merges adjacent retained segments only for display when their speaker is the same and the existing Meeting View already treats them as one turn.

The projection returns counts for input segments, output segments, filler tokens removed, exact duplicates removed, embedded fragments removed, and filler-token ratio. It does not label meetings with urgency or quality scores.

`parseTranscriptSegments` continues to expose canonical persisted segments. New explicit helpers build readable segments and analysis text. This naming prevents callers from accidentally treating editorial text as canonical evidence.

### Consumer wiring

- **Meeting View:** render the readable segment projection while retaining the existing transcript visibility and timestamp behavior.
- **Manual note regeneration:** use the readable analysis text helper.
- **Automatic validated downstream processing:** replace local transcript-string builders with the shared readable analysis helper.
- **Retry and partial-capture processing:** use the same helper so retry behavior cannot diverge from the normal path.
- **Title generation:** continue to receive the same readable text used by analysis when title generation consumes transcript text.

Knowledge extraction that receives structured analysis or canonical segment objects is unchanged unless it currently constructs raw transcript strings for the same analysis request.

### Readability diagnostics

Add an optional versioned `readability` object to the stored transcript wrapper for new canonical finalizations:

- schema version;
- canonical segment count;
- exact duplicate count;
- embedded fragment count;
- filler token count;
- total token count;
- filler-token ratio.

The diagnostics contain counts only. They do not include tokens, text, identities, or paths. They are observational metadata, not a gate: `transcript_status` and integrity reasons remain unchanged. Historical transcripts without diagnostics remain valid and derive the same statistics at read time.

### Failure behavior

- Malformed or legacy transcript JSON continues to return no segments through the existing parser contract.
- A segment without text is ignored by the readable projection.
- Missing word arrays do not block cleanup because disfluency removal operates on segment text; preserved word arrays remain untouched.
- If readable projection removes every segment, analysis generation fails through the existing empty-transcript path rather than falling back to raw noise.
- Canonical finalization still fails closed only through its existing capture-integrity and lease contracts. Readability diagnostics cannot fail finalization.

## Testing

Use test-driven development and observe each regression test fail before implementation.

Focused canonical cases:

- exact same-source duplicate segments collapse once;
- similar text at different timestamps remains;
- a sub-250 ms one-letter mic segment fully embedded in substantive System speech is removed;
- a short acknowledgement, a multi-character fragment, a longer letter segment, and a letter outside System speech remain;
- reconciliation provenance records only content-free counts.

Focused readable-projection cases:

- whole-word `um` and `uh` are removed case-insensitively;
- semantic substrings such as `human` and `umbrella` remain;
- filler-only segments disappear while retained segment metadata and input objects remain unchanged;
- exact historical duplicates collapse;
- strict embedded letter artifacts disappear and legitimate short interjections remain;
- analysis text uses the readable projection for legacy arrays and v2 wrappers.

Consumer tests prove Meeting View, automatic processing, retries, manual regeneration, and title generation receive the shared readable text. Existing canonical parsing and integrity tests remain green.

Verification includes focused Vitest suites, the full Vitest suite, TypeScript, changed-file Biome lint, `git diff --check`, changelog validation, and a content-free read-only replay against the affected private meeting. The replay must show zero exact duplicate segments and zero qualifying embedded letter fragments in the readable projection, materially fewer filler tokens, unchanged persisted transcript bytes, and no loss of non-filler canonical tokens.

## Shipping Records

- Keep issue #659 current if scope or acceptance changes.
- Record the durable decision that editorial transcript cleanup is a derived projection rather than a canonical rewrite.
- Add a uniquely named changelog fragment explaining that saved transcripts read cleanly while evidence remains preserved.
- Link #629 and #657 as related source-bleed and skew-reconciliation context.
