import { describe, expect, it } from 'vitest';

import {
  type TranscriptSegmentLike,
  cleanTranscriptSegments,
  stripFillers,
  resolveSelfCorrections,
  cleanSegmentText,
} from '../../electron/transcriptCleanup';

describe('cleanTranscriptSegments', () => {
  it('strips filler words from segment text', () => {
    const text = 'um we are uh sort of launching like today';
    expect(stripFillers(text)).toBe('we are launching today');
  });

  it('resolves spoken self corrections', () => {
    const text = "let's meet at 2... no wait, 3pm";
    expect(resolveSelfCorrections(text)).toBe("let's meet at 3pm");
  });

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
});
