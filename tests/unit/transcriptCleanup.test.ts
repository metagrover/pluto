import { describe, expect, it } from 'vitest';

import {
  cleanTranscriptSegments,
  TranscriptSegmentLike,
} from '../../electron/transcriptCleanup';

describe('cleanTranscriptSegments', () => {
  it('drops near-duplicate Them segments in short windows', () => {
    const segments: TranscriptSegmentLike[] = [
      {
        startTime: 0,
        endTime: 3,
        speaker: 'Me',
        text: 'opening question from me',
      },
      {
        startTime: 4,
        endTime: 10,
        speaker: 'Them',
        text: 'Codex versus Integry is interesting and I liked it initially',
      },
      {
        startTime: 10.2,
        endTime: 16,
        speaker: 'Them',
        text: 'Codex versus Integry is interesting and I liked it initially',
      },
      { startTime: 17, endTime: 20, speaker: 'Me', text: 'quick follow up' },
    ];

    const cleaned = cleanTranscriptSegments(segments);

    const themSegments = cleaned.segments.filter(
      (segment) => segment.speaker === 'Them',
    );
    expect(themSegments.length).toBe(1);
    expect(cleaned.stats.dropped_duplicates).toBe(1);
  });

  it('merges same-speaker segments without trimming content boundaries', () => {
    const segments: TranscriptSegmentLike[] = [
      {
        startTime: 0,
        endTime: 5,
        speaker: 'Them',
        text: 'it gives you connectivity to your email and your calendar',
      },
      {
        startTime: 5.2,
        endTime: 9,
        speaker: 'Them',
        text: 'your email and your calendar plus many integrations',
      },
    ];

    const cleaned = cleanTranscriptSegments(segments);
    const text = String(cleaned.segments[0]?.text || '');

    expect(cleaned.segments.length).toBe(1);
    expect(text).toContain('connectivity to your email and your calendar');
    expect(text).toContain(
      'your email and your calendar plus many integrations',
    );
  });

  it('keeps Me turns intact while deduping Them', () => {
    const segments: TranscriptSegmentLike[] = [
      { startTime: 0, endTime: 2, speaker: 'Me', text: 'first me line' },
      { startTime: 2.4, endTime: 3.8, speaker: 'Me', text: 'second me line' },
      {
        startTime: 4.2,
        endTime: 7,
        speaker: 'Them',
        text: 'a repeated response',
      },
      {
        startTime: 7.1,
        endTime: 9.4,
        speaker: 'Them',
        text: 'a repeated response',
      },
    ];

    const cleaned = cleanTranscriptSegments(segments);
    const meSegments = cleaned.segments.filter(
      (segment) => segment.speaker === 'Me',
    );
    const themSegments = cleaned.segments.filter(
      (segment) => segment.speaker === 'Them',
    );

    expect(meSegments.length).toBe(1);
    expect(String(meSegments[0]?.text || '')).toContain('first me line');
    expect(String(meSegments[0]?.text || '')).toContain('second me line');
    expect(themSegments.length).toBe(1);
  });

  it('preserves continuation detail instead of dropping similar follow-up turns', () => {
    const segments: TranscriptSegmentLike[] = [
      {
        startTime: 0,
        endTime: 5,
        speaker: 'Them',
        text: 'I like codex because it is fast and reliable for coding tasks',
      },
      {
        startTime: 5.2,
        endTime: 10,
        speaker: 'Them',
        text: 'I like codex because it is fast and reliable for coding tasks but pricing is still high',
      },
    ];

    const cleaned = cleanTranscriptSegments(segments);
    const text = String(cleaned.segments[0]?.text || '');

    expect(cleaned.segments.length).toBe(1);
    expect(text).toContain('fast and reliable for coding tasks');
    expect(text).toContain('but pricing is still high');
  });

  it('does not trim start of incoming text on weak boundary overlap', () => {
    const segments: TranscriptSegmentLike[] = [
      {
        startTime: 0,
        endTime: 3,
        speaker: 'Them',
        text: 'the market shifted quickly',
      },
      {
        startTime: 3.1,
        endTime: 6,
        speaker: 'Them',
        text: 'the team reacted by reducing risk',
      },
    ];

    const cleaned = cleanTranscriptSegments(segments);
    const text = String(cleaned.segments[0]?.text || '');

    expect(cleaned.segments.length).toBe(1);
    expect(text).toContain('shifted quickly the team reacted');
  });

  it('dedupes exact repeated Me bleed segments in short windows', () => {
    const segments: TranscriptSegmentLike[] = [
      {
        startTime: 0,
        endTime: 4,
        speaker: 'Me',
        text: 'this is participant speech leaked into mic',
      },
      {
        startTime: 4.1,
        endTime: 8,
        speaker: 'Me',
        text: 'this is participant speech leaked into mic',
      },
      { startTime: 8.3, endTime: 10, speaker: 'Them', text: 'acknowledged' },
    ];

    const cleaned = cleanTranscriptSegments(segments);
    const meSegments = cleaned.segments.filter(
      (segment) => segment.speaker === 'Me',
    );

    expect(meSegments.length).toBe(1);
  });
});
