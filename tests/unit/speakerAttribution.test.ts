import { describe, expect, it } from 'vitest';

import {
  applyDiarizationRefinement,
  applyTurnTakingHeuristics,
  assignSpeakersToCanonicalSegments,
  decideNextSpeaker,
  dropShortCrossSpeakerEchoes,
  mapDiarizationSpeakers,
  reassignShortBoundarySegments,
  resolveCrossChannelDuplicates,
  shouldApplyFullSessionMeRecovery,
  shouldDropBySpeakerActivity,
  shouldHydrateCanonicalTranscript,
  stripLikelyMeBleedSegments,
} from '../../src/utils/speakerAttribution';

describe('speakerAttribution utilities', () => {
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

  it('skips full-session Me recovery when bleed is likely', () => {
    const shouldRecover = shouldApplyFullSessionMeRecovery({
      hasChunkMeSegments: false,
      recoveredMeCount: 7,
      bleedLikely: true,
    });

    expect(shouldRecover).toBe(false);
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

  it('uses activity timeline as tie-breaker when overlap evidence is ambiguous', () => {
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
      activityWindows: [{ startTime: 10.1, endTime: 12.9, speaker: 'Them' }],
    });

    expect(assigned.segments).toHaveLength(1);
    expect(assigned.segments[0].speaker).toBe('Them');
    expect(assigned.stats.byActivity).toBe(1);
  });

  it('relabels question and acknowledgment into alternating speakers', () => {
    const adjusted = applyTurnTakingHeuristics([
      {
        startTime: 0,
        endTime: 3,
        speaker: 'Me',
        text: 'Very interesting that this guy is discussing options.',
      },
      {
        startTime: 3,
        endTime: 6,
        speaker: 'Them',
        text: 'Do you lean one way or the other?',
      },
      {
        startTime: 6,
        endTime: 7,
        speaker: 'Them',
        text: 'Yeah.',
      },
      {
        startTime: 7,
        endTime: 10,
        speaker: 'Them',
        text: 'Not sure how much I should share there.',
      },
    ]);

    expect(adjusted[1].speaker).toBe('Me');
    expect(adjusted[2].speaker).toBe('Them');
  });

  it('keeps uncertainty follow-up with prior acknowledgment speaker', () => {
    const adjusted = applyTurnTakingHeuristics([
      {
        startTime: 0,
        endTime: 4,
        speaker: 'Me',
        text: 'Do you lean one way or the other?',
      },
      {
        startTime: 4.1,
        endTime: 4.8,
        speaker: 'Them',
        text: 'Yeah.',
      },
      {
        startTime: 4.9,
        endTime: 8.1,
        speaker: 'Me',
        text: "Not sure how much I should share there, it's not quite finalized yet.",
      },
    ]);

    expect(adjusted[2].speaker).toBe('Them');
  });

  it('skips canonical hydration when channel transcript already has both speakers with enough coverage', () => {
    const shouldHydrate = shouldHydrateCanonicalTranscript({
      canonicalSegments: [
        { startTime: 0, endTime: 16, speaker: 'Me', text: 'session text' },
      ],
      channelSegments: [
        { startTime: 0, endTime: 4, speaker: 'Me', text: 'opening' },
        { startTime: 4, endTime: 8, speaker: 'Them', text: 'reply' },
        { startTime: 8, endTime: 12, speaker: 'Me', text: 'follow-up' },
        { startTime: 12, endTime: 16, speaker: 'Them', text: 'answer' },
      ],
    });

    expect(shouldHydrate).toBe(false);
  });

  it('runs canonical hydration when channel transcript misses one speaker', () => {
    const shouldHydrate = shouldHydrateCanonicalTranscript({
      canonicalSegments: [
        { startTime: 0, endTime: 16, speaker: 'Me', text: 'session text' },
      ],
      channelSegments: [
        { startTime: 0, endTime: 6, speaker: 'Me', text: 'opening' },
        { startTime: 7, endTime: 11, speaker: 'Me', text: 'question' },
      ],
    });

    expect(shouldHydrate).toBe(true);
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

  it('reassigns short bridge boundary segment to the following speaker', () => {
    const adjusted = reassignShortBoundarySegments({
      segments: [
        {
          startTime: 0,
          endTime: 4,
          speaker: 'Me',
          text: 'I am going to interrupt and test attribution.',
        },
        {
          startTime: 4.05,
          endTime: 4.5,
          speaker: 'Me',
          text: "That's it.",
        },
        {
          startTime: 4.55,
          endTime: 8,
          speaker: 'Them',
          text: 'Maybe it is going to be more like Chrome.',
        },
      ],
    });

    expect(adjusted.map((segment) => segment.speaker)).toEqual([
      'Me',
      'Them',
      'Them',
    ]);
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
});
