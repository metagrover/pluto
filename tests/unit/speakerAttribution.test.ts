import { describe, expect, it } from 'vitest';

import {
  applyCrossTurnAttributionRepairs,
  applyDiarizationRefinement,
  assignSpeakersToCanonicalSegments,
  decideNextSpeaker,
  dropShortCrossSpeakerEchoes,
  mapDiarizationSpeakers,
  resolveCrossChannelDuplicates,
  resolveCrossChannelNearDuplicates,
  shouldDropBySpeakerActivity,
  splitCanonicalSegmentsAtChannelBoundaries,
  splitSegmentsAtDiarizationBoundaries,
  stripLikelyMeBleedSegments,
} from '../../src/utils/speakerAttribution';

describe('speakerAttribution utilities', () => {
  it('resolveCrossChannelNearDuplicates merges paraphrase pair below strict duplicate overlap', () => {
    // Overlap 2s / minDur 5s = 0.4 → below strict isDuplicatePair (0.45), still near-dup lexically.
    const near = resolveCrossChannelNearDuplicates([
      {
        startTime: 10,
        endTime: 16,
        speaker: 'Me',
        text: 'the quarterly revenue target is seven million for the east region',
      },
      {
        startTime: 14,
        endTime: 19,
        speaker: 'Them',
        text: 'quarterly revenue target seven million east region plan',
      },
    ]);
    expect(near.segments.length).toBe(1);
    expect(near.stats.resolvedPairs).toBe(1);
  });

  it('keeps Them when overlap is high and Them carries additional continuation detail', () => {
    const result = resolveCrossChannelDuplicates([
      {
        startTime: 0,
        endTime: 5.9,
        speaker: 'Me',
        text: 'capital one buying for 5.15 billion means distribution and data strategy',
      },
      {
        startTime: 0.1,
        endTime: 6.4,
        speaker: 'Them',
        text: 'capital one buying for 5.15 billion means distribution and data strategy and changes distribution outcomes',
      },
    ]);

    expect(result.stats.resolvedPairs).toBe(1);
    expect(result.stats.droppedMe).toBe(1);
    expect(result.stats.droppedThem).toBe(0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].speaker).toBe('Them');
  });

  it('keeps Me when Them duplicate text is highly repetitive garbage', () => {
    const result = resolveCrossChannelDuplicates([
      {
        startTime: 0,
        endTime: 6.8,
        speaker: 'Me',
        text: 'Yeah the funding situation in open source is really messed up and I still lose money in the project',
      },
      {
        startTime: 0.1,
        endTime: 6.9,
        speaker: 'Them',
        text: 'yeah the funding situation in open source is really messed up funding situation in open source funding situation in open source',
      },
    ]);

    expect(result.stats.resolvedPairs).toBe(1);
    expect(result.stats.droppedThem).toBe(1);
    expect(result.stats.droppedMe).toBe(0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].speaker).toBe('Me');
  });

  it('does not force sticky speaker in ambiguous dual-active ties', () => {
    const next = decideNextSpeaker({
      micRms: 0.03,
      systemRms: 0.028,
      threshold: 0.012,
      ratio: 1.25,
    });

    expect(next).toBeNull();
  });

  it('does not drop short Them interjections with moderate overlap', () => {
    const shouldDropThem = shouldDropBySpeakerActivity({
      targetSpeaker: 'Them',
      overlapRatio: 0.4,
      meCoverage: 1.1,
      themCoverage: 0.15,
    });

    expect(shouldDropThem).toBe(false);
  });

  it('does not drop informative Them overlap unless Me dominance is extreme', () => {
    const shouldDropThem = shouldDropBySpeakerActivity({
      targetSpeaker: 'Them',
      overlapRatio: 0.72,
      meCoverage: 0.82,
      themCoverage: 0.31,
    });

    expect(shouldDropThem).toBe(false);
  });

  it('preserves middle Them turn in long-short-long sequence', () => {
    const result = resolveCrossChannelDuplicates([
      {
        startTime: 0,
        endTime: 12,
        speaker: 'Me',
        text: 'and honestly I call it my simple power let me recap everything from this week in tech',
      },
      {
        startTime: 12.1,
        endTime: 13.2,
        speaker: 'Them',
        text: 'thing. I could create a company.',
      },
      {
        startTime: 13.3,
        endTime: 24,
        speaker: 'Me',
        text: 'ethical sourcing is moving from pr into operations with audits and transparency',
      },
    ]);

    const themSegments = result.segments.filter(
      (segment) => segment.speaker === 'Them',
    );
    expect(themSegments).toHaveLength(1);
    expect(themSegments[0].text).toContain('create a company');
  });

  it('relabels sandwiched lowercase continuation fragments to the surrounding speaker', () => {
    const repaired = applyCrossTurnAttributionRepairs([
      {
        startTime: 273.59,
        endTime: 276.26,
        speaker: 'Them',
        text: 'Just Dev. UAT, you',
      },
      {
        startTime: 276.28,
        endTime: 290.51,
        speaker: 'Me',
        text: "would have to update. There's a release branch for this sprint. I think that's Q2. Or maybe there's a",
      },
      {
        startTime: 290.53,
        endTime: 291.71,
        speaker: 'Them',
        text: 'conference. Is this Q2.2 or Q2.1?',
      },
    ]);

    expect(repaired.map((segment) => segment.speaker)).toEqual([
      'Them',
      'Them',
      'Them',
    ]);
  });

  it('does not relabel sandwiched clarification questions that belong to Me', () => {
    const repaired = applyCrossTurnAttributionRepairs([
      {
        startTime: 461.27,
        endTime: 461.53,
        speaker: 'Them',
        text: 'What',
      },
      {
        startTime: 462.09,
        endTime: 466.67,
        speaker: 'Me',
        text: 'issues are you seeing? Oh, was Adam mentioning?',
      },
      {
        startTime: 468.28,
        endTime: 487.93,
        speaker: 'Them',
        text: "Honestly, I'm not sure. Regarding memories, maybe that's it.",
      },
    ]);

    expect(repaired.map((segment) => segment.speaker)).toEqual([
      'Them',
      'Me',
      'Them',
    ]);
  });

  it('does not relabel a complete standalone statement without continuation cues', () => {
    const repaired = applyCrossTurnAttributionRepairs([
      {
        startTime: 0,
        endTime: 1.2,
        speaker: 'Them',
        text: 'We can ship that Friday.',
      },
      {
        startTime: 1.3,
        endTime: 4.5,
        speaker: 'Me',
        text: 'I reviewed the dashboard this morning.',
      },
      {
        startTime: 4.6,
        endTime: 6.8,
        speaker: 'Them',
        text: 'Then I will send the rollout note.',
      },
    ]);

    expect(repaired.map((segment) => segment.speaker)).toEqual([
      'Them',
      'Me',
      'Them',
    ]);
  });

  it('strips likely Me bleed fragments when overlapping Them dominates', () => {
    const stripped = stripLikelyMeBleedSegments([
      {
        startTime: 0,
        endTime: 7.4,
        speaker: 'Them',
        text: 'this is the end of the world this is the end of the world',
      },
      {
        startTime: 0.2,
        endTime: 7.1,
        speaker: 'Me',
        text: 'this is the end of the world this is the end of the world',
      },
      {
        startTime: 7.6,
        endTime: 9.3,
        speaker: 'Me',
        text: 'look out for himself',
      },
      {
        startTime: 7.5,
        endTime: 9.5,
        speaker: 'Them',
        text: 'look out for himself',
      },
      {
        startTime: 10.0,
        endTime: 12.0,
        speaker: 'Me',
        text: 'I have no interest in monetizing this app right now',
      },
    ]);

    const texts = stripped.segments.map((segment) =>
      segment.text.toLowerCase(),
    );
    const combined = texts.join(' ');

    expect(stripped.droppedMe).toBeGreaterThanOrEqual(1);
    expect(combined).toContain('no interest in monetizing');
    expect(combined).toContain('look out for himself');
  });

  it('drops Me bleed even when Me activity coverage is polluted', () => {
    const stripped = stripLikelyMeBleedSegments(
      [
        {
          startTime: 0.0,
          endTime: 10.0,
          speaker: 'Me',
          text: 'You have to think about it. So we can figure it out while we plan the trip to Berlin.',
        },
        {
          startTime: 3.0,
          endTime: 9.0,
          speaker: 'Them',
          text: 'You have to think about it. So we can figure it out while we plan the trip to Berlin.',
        },
      ],
      // Simulate bad RMS windows where "Me" coverage dominates.
      [{ startTime: 0.0, endTime: 10.0, speaker: 'Me' }],
    );

    expect(stripped.droppedMe).toBe(1);
    expect(stripped.segments).toHaveLength(1);
    expect(stripped.segments[0].speaker).toBe('Them');
  });

  it('does not drop Me when lexical similarity is weak', () => {
    const stripped = stripLikelyMeBleedSegments(
      [
        {
          startTime: 0.0,
          endTime: 10.0,
          speaker: 'Me',
          text: 'I think we should pause rollout because churn is up this week.',
        },
        {
          startTime: 3.0,
          endTime: 9.0,
          speaker: 'Them',
          text: 'Wait, churn is concentrated in one region, not global.',
        },
      ],
      // Even if Me coverage is high, overlap+lexical evidence should be too weak.
      [
        { startTime: 0.0, endTime: 10.0, speaker: 'Me' },
        { startTime: 3.0, endTime: 9.0, speaker: 'Them' },
      ],
    );

    expect(stripped.droppedMe).toBe(0);
    expect(stripped.segments).toHaveLength(2);
  });

  it('drops Berlin loudspeaker-bleed candidate (Me contains Them phrase)', () => {
    // Extracted directly from the Berlin meeting DB transcript_json.
    const stripped = stripLikelyMeBleedSegments(
      [
        {
          startTime: 215.572,
          endTime: 230.49800000000002,
          speaker: 'Me',
          text: 'You have to think about it. So we can figure it out while we',
        },
        {
          startTime: 221.702,
          endTime: 225.465,
          speaker: 'Them',
          text: 'You have to think about it.',
        },
      ],
      // Simulate polluted RMS windows where "Me" looks dominant.
      [{ startTime: 215.572, endTime: 230.49800000000002, speaker: 'Me' }],
    );

    expect(stripped.droppedMe).toBe(1);
    expect(stripped.segments).toHaveLength(1);
    expect(stripped.segments[0].speaker).toBe('Them');
  });

  it('uses source activity windows to drop Me echo bleed', () => {
    const stripped = stripLikelyMeBleedSegments(
      [
        {
          startTime: 10.0,
          endTime: 13.2,
          speaker: 'Them',
          text: 'you can learn faster if you have your own teacher',
        },
        {
          startTime: 10.1,
          endTime: 13.0,
          speaker: 'Me',
          text: 'you can learn faster if you have your own teacher',
        },
      ],
      [
        { startTime: 10.0, endTime: 13.3, speaker: 'Them' },
        { startTime: 10.0, endTime: 10.08, speaker: 'Me' },
      ],
    );

    expect(stripped.droppedMe).toBe(1);
    expect(stripped.segments).toHaveLength(1);
    expect(stripped.segments[0].speaker).toBe('Them');
  });

  it('keeps Me segment when source activity confirms local speech', () => {
    const stripped = stripLikelyMeBleedSegments(
      [
        {
          startTime: 20.0,
          endTime: 23.0,
          speaker: 'Them',
          text: 'okay i can share access if needed',
        },
        {
          startTime: 20.1,
          endTime: 23.1,
          speaker: 'Me',
          text: 'okay i can share access if needed',
        },
      ],
      [
        { startTime: 20.0, endTime: 20.2, speaker: 'Them' },
        { startTime: 20.0, endTime: 23.2, speaker: 'Me' },
      ],
    );

    expect(stripped.droppedMe).toBe(0);
    expect(stripped.segments).toHaveLength(2);
  });

  it('hydrates canonical session text while keeping speaker assignment from overlap evidence', () => {
    const assigned = assignSpeakersToCanonicalSegments({
      canonicalSegments: [
        {
          startTime: 0,
          endTime: 6,
          speaker: 'Me',
          text: 'Okay so I am testing this to check if recording is proper.',
        },
        {
          startTime: 8,
          endTime: 14,
          speaker: 'Me',
          text: 'I am not sure how much I should share because it is not finalized.',
        },
      ],
      attributedSegments: [
        {
          startTime: 0,
          endTime: 6,
          speaker: 'Me',
          text: 'testing this to check if recording is proper',
        },
        {
          startTime: 8,
          endTime: 14,
          speaker: 'Them',
          text: 'not sure how much i should share it is not finalized',
        },
      ],
    });

    expect(assigned.segments).toHaveLength(2);
    expect(assigned.segments[0].speaker).toBe('Me');
    expect(assigned.segments[1].speaker).toBe('Them');
    expect(assigned.stats.byOverlap).toBeGreaterThanOrEqual(2);
  });

  it('uses nearby lexical evidence when overlap windows are missing', () => {
    const assigned = assignSpeakersToCanonicalSegments({
      canonicalSegments: [
        {
          startTime: 20,
          endTime: 24,
          speaker: 'Me',
          text: 'Not sure how much I should share there, it is not finalized yet.',
        },
      ],
      attributedSegments: [
        {
          startTime: 19.2,
          endTime: 22.8,
          speaker: 'Them',
          text: 'Not sure how much I should share there, it is not finalized yet.',
        },
        {
          startTime: 15,
          endTime: 18,
          speaker: 'Me',
          text: 'Do you lean one way or the other?',
        },
      ],
    });

    expect(assigned.segments).toHaveLength(1);
    expect(assigned.segments[0].speaker).toBe('Them');
  });

  it('assigns Them when both channels overlap (bleed detection)', () => {
    const assigned = assignSpeakersToCanonicalSegments({
      canonicalSegments: [
        {
          startTime: 10,
          endTime: 13,
          speaker: 'Me',
          text: 'Do you lean one way or the other?',
        },
      ],
      attributedSegments: [
        {
          startTime: 10,
          endTime: 13,
          speaker: 'Me',
          text: 'Do you lean one way or the other?',
        },
        {
          startTime: 10,
          endTime: 13,
          speaker: 'Them',
          text: 'Do you lean one way or the other?',
        },
      ],
    });

    expect(assigned.segments).toHaveLength(1);
    expect(assigned.segments[0].speaker).toBe('Them');
    expect(assigned.stats.byOverlap).toBe(1);
  });

  it('assigns Me when only Them channel overlaps but text is unrelated', () => {
    const assigned = assignSpeakersToCanonicalSegments({
      canonicalSegments: [
        {
          startTime: 10,
          endTime: 14,
          speaker: 'Me',
          text: 'They are talking about open source and I want to listen more.',
        },
      ],
      attributedSegments: [
        {
          startTime: 10,
          endTime: 14,
          speaker: 'Them',
          text: 'my backlog is very large but I learned so much from open source',
        },
      ],
    });

    expect(assigned.segments).toHaveLength(1);
    expect(assigned.segments[0].speaker).toBe('Me');
  });

  it('applyCrossTurnAttributionRepairs flips uncertainty answer after Me question', () => {
    const out = applyCrossTurnAttributionRepairs([
      {
        startTime: 1,
        endTime: 3,
        speaker: 'Me',
        text: 'So how do you propose I spend my time there?',
      },
      {
        startTime: 3.05,
        endTime: 8,
        speaker: 'Me',
        text: "I don't know, eating, travelling, we also need to shop.",
      },
    ]);
    expect(out[1].speaker).toBe('Them');
  });

  it('applyCrossTurnAttributionRepairs flips local correction after remote Them', () => {
    const out = applyCrossTurnAttributionRepairs([
      {
        startTime: 1,
        endTime: 2,
        speaker: 'Them',
        text: 'July 3rd.',
      },
      {
        startTime: 2.1,
        endTime: 4,
        speaker: 'Them',
        text: 'Oh yeah, July 3rd correction July 3rd.',
      },
    ]);
    expect(out[1].speaker).toBe('Me');
  });

  it('applyCrossTurnAttributionRepairs flips short yes after Me question', () => {
    const out = applyCrossTurnAttributionRepairs([
      {
        startTime: 1,
        endTime: 5,
        speaker: 'Me',
        text: 'Is Berlin mostly flat for biking?',
      },
      {
        startTime: 5.2,
        endTime: 5.8,
        speaker: 'Me',
        text: 'Yes.',
      },
    ]);
    expect(out[1].speaker).toBe('Them');
  });

  it('applyCrossTurnAttributionRepairs alternates opening greeting exchange', () => {
    const out = applyCrossTurnAttributionRepairs([
      {
        startTime: 1.5,
        endTime: 2.0,
        speaker: 'Me',
        text: 'Hey Arnold.',
      },
      {
        startTime: 10.0,
        endTime: 10.6,
        speaker: 'Me',
        text: 'Hey Deepak.',
      },
      {
        startTime: 12.3,
        endTime: 13.0,
        speaker: 'Me',
        text: "How's it going?",
      },
      {
        startTime: 15.4,
        endTime: 17.2,
        speaker: 'Me',
        text: 'Not bad. Just?',
      },
    ]);

    expect(out[1].speaker).toBe('Them');
    expect(out[3].speaker).toBe('Them');
  });

  it('applyCrossTurnAttributionRepairs flips short answer after Me question', () => {
    const out = applyCrossTurnAttributionRepairs([
      {
        startTime: 0,
        endTime: 2.1,
        speaker: 'Me',
        text: 'How is the rollout going?',
      },
      {
        startTime: 2.3,
        endTime: 3.8,
        speaker: 'Me',
        text: 'Pretty good so far.',
      },
    ]);

    expect(out[1].speaker).toBe('Them');
  });

  it('applyCrossTurnAttributionRepairs repairs sandwiched continuation fragment', () => {
    const out = applyCrossTurnAttributionRepairs([
      {
        startTime: 60.7,
        endTime: 69.2,
        speaker: 'Them',
        text: 'I am trying to fix our API',
      },
      {
        startTime: 69.3,
        endTime: 74.7,
        speaker: 'Me',
        text: 'instrumentation on the issues. So just trying to',
      },
      {
        startTime: 75.0,
        endTime: 78.2,
        speaker: 'Them',
        text: 'go through the motions of engaging SRE.',
      },
    ]);

    expect(out[1].speaker).toBe('Them');
  });

  it('applyCrossTurnAttributionRepairs keeps follow-up continuation with remote answer', () => {
    const out = applyCrossTurnAttributionRepairs([
      {
        startTime: 12.3,
        endTime: 13.0,
        speaker: 'Me',
        text: "How's it going?",
      },
      {
        startTime: 15.4,
        endTime: 17.2,
        speaker: 'Me',
        text: 'Not bad.',
      },
      {
        startTime: 19.0,
        endTime: 22.2,
        speaker: 'Me',
        text: 'Just stretched too thin but trying to keep up.',
      },
    ]);

    expect(out[1].speaker).toBe('Them');
    expect(out[2].speaker).toBe('Them');
  });

  it('applyCrossTurnAttributionRepairs keeps split RSAMS answer with Them', () => {
    const out = applyCrossTurnAttributionRepairs([
      {
        startTime: 175.0,
        endTime: 180.0,
        speaker: 'Them',
        text: 'Or UAT, we should have been good last week.',
      },
      {
        startTime: 181.5,
        endTime: 184.9,
        speaker: 'Me',
        text: "I made some RSAMS on Friday. I'm not sure if",
      },
      {
        startTime: 185.2,
        endTime: 189.2,
        speaker: 'Them',
        text: "they've gone through yet. But I can check on that as well.",
      },
    ]);

    expect(out[1].speaker).toBe('Them');
  });

  it('drops short opposite-speaker echoes contained in neighboring long utterances', () => {
    const pruned = dropShortCrossSpeakerEchoes({
      segments: [
        {
          startTime: 0,
          endTime: 6,
          speaker: 'Me',
          text: 'Open source. I will interrupt and speak in between to test attribution.',
        },
        {
          startTime: 6.1,
          endTime: 6.9,
          speaker: 'Them',
          text: 'Open source.',
        },
        {
          startTime: 7.0,
          endTime: 11.0,
          speaker: 'Me',
          text: 'Maybe it is going to be a model like Chrome.',
        },
      ],
    });

    expect(pruned.dropped).toBe(1);
    expect(pruned.segments.map((segment) => segment.text)).toEqual([
      'Open source. I will interrupt and speak in between to test attribution.',
      'Maybe it is going to be a model like Chrome.',
    ]);
  });

  it('keeps short interjections when they are not lexical echoes', () => {
    const pruned = dropShortCrossSpeakerEchoes({
      segments: [
        {
          startTime: 0,
          endTime: 4.5,
          speaker: 'Me',
          text: 'I am going to test this flow now.',
        },
        {
          startTime: 4.6,
          endTime: 5.1,
          speaker: 'Them',
          text: 'Okay.',
        },
      ],
    });

    expect(pruned.dropped).toBe(0);
    expect(pruned.segments).toHaveLength(2);
  });

  it('maps diarization speakers to Me/Them using overlap evidence', () => {
    const mapping = mapDiarizationSpeakers({
      diarizationSegments: [
        { startTime: 0, endTime: 4.8, text: '', speaker: 'SPEAKER_00' },
        { startTime: 5.1, endTime: 9.5, text: '', speaker: 'SPEAKER_01' },
      ],
      referenceSegments: [
        { startTime: 0, endTime: 4.5, text: 'hello', speaker: 'Me' },
        { startTime: 5.2, endTime: 9.2, text: 'hi there', speaker: 'Them' },
      ],
      activityWindows: [],
    });

    expect(mapping.mapping).toEqual({
      SPEAKER_00: 'Me',
      SPEAKER_01: 'Them',
    });
    expect(mapping.confidence).toBeGreaterThan(0);
  });

  it('skips diarization mapping when overlap evidence is insufficient', () => {
    const mapping = mapDiarizationSpeakers({
      diarizationSegments: [
        { startTime: 0, endTime: 2, text: '', speaker: 'SPEAKER_00' },
        { startTime: 2, endTime: 4, text: '', speaker: 'SPEAKER_01' },
      ],
      referenceSegments: [
        { startTime: 0, endTime: 4, text: 'solo monologue', speaker: 'Me' },
      ],
      activityWindows: [],
    });

    expect(Object.keys(mapping.mapping)).toHaveLength(0);
  });

  it('relabels segments when diarization coverage is strong', () => {
    const diarizationSegments = [
      { startTime: 0, endTime: 4, text: '', speaker: 'SPEAKER_00' },
      { startTime: 4, endTime: 8, text: '', speaker: 'SPEAKER_01' },
    ];
    const applied = applyDiarizationRefinement({
      segments: [
        { startTime: 0, endTime: 4, text: 'intro', speaker: 'Them' },
        { startTime: 4, endTime: 8, text: 'reply', speaker: 'Me' },
      ],
      diarizationSegments,
      mapping: { SPEAKER_00: 'Me', SPEAKER_01: 'Them' },
    });

    expect(applied.relabeled).toBe(2);
    expect(applied.segments[0].speaker).toBe('Me');
    expect(applied.segments[1].speaker).toBe('Them');
  });

  it('splitCanonicalSegmentsAtChannelBoundaries peels Them tail glued on mix canonical', () => {
    const canonical = [
      {
        startTime: 0,
        endTime: 12,
        speaker: 'Me',
        text: 'So how do you propose I spend my time there? I do not know eating travelling I do not have anything else right now in mind we also need to shop',
      },
    ];
    const channel = [
      {
        startTime: 1,
        endTime: 11,
        speaker: 'Them',
        text: 'I do not know eating travelling I do not have anything else right now in mind we also need to shop',
      },
    ];
    const { segments, splitsApplied } =
      splitCanonicalSegmentsAtChannelBoundaries(canonical, channel);
    expect(splitsApplied).toBe(1);
    expect(segments.length).toBe(2);
    expect(segments[0].text).toContain('propose');
    expect(segments[0].text).not.toContain('eating');
    expect(segments[1].text).toContain('eating');
  });

  it('splitCanonicalSegmentsAtChannelBoundaries handles fuzzy Whisper variations (1 word mismatch)', () => {
    const canonical = [
      {
        startTime: 0,
        endTime: 15,
        speaker: 'Me',
        text: 'So how do you propose I spend my time there? I do not know eating travelling I do not have anything else right now in mind we also need to shop',
      },
    ];
    const channel = [
      {
        startTime: 1,
        endTime: 14,
        speaker: 'Them',
        text: 'I do not know eating traveling I do not have anything else right now in mind we also need to shop',
      },
    ];
    const { segments, splitsApplied } =
      splitCanonicalSegmentsAtChannelBoundaries(canonical, channel);
    expect(splitsApplied).toBe(1);
    expect(segments.length).toBe(2);
    expect(segments[0].text).toContain('propose');
    expect(segments[1].text.toLowerCase()).toContain('know');
  });

  it('splitSegmentsAtDiarizationBoundaries splits one long segment when two speakers inside', () => {
    const segments = [
      {
        startTime: 0,
        endTime: 10,
        speaker: 'Me',
        text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen',
      },
    ];
    const diar = [
      { startTime: 0, endTime: 4.5, text: '', speaker: 'SPEAKER_00' },
      { startTime: 4.5, endTime: 10, text: '', speaker: 'SPEAKER_01' },
    ];
    const mapping = { SPEAKER_00: 'Me' as const, SPEAKER_01: 'Them' as const };
    const { segments: out, splitsApplied } =
      splitSegmentsAtDiarizationBoundaries(segments, diar, mapping);
    expect(splitsApplied).toBe(1);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.some((s) => s.speaker === 'Me')).toBe(true);
    expect(out.some((s) => s.speaker === 'Them')).toBe(true);
  });
});
