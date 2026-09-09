import { describe, expect, it, vi } from 'vitest';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import {
  inspectLiveNotesReuse,
  savedLiveNotesSource,
} from '../../scripts/lib/notesLiveReuse';

describe('saved live source cache probe', () => {
  it('reconstructs event-time sorting and adjacent-speaker merging without mutating input', () => {
    const raw = JSON.stringify({
      liveSegments: [
        { speaker: 'Milo', text: ' second ', startTime: 2 },
        { speaker: 'Milo', text: ' first ', startTime: 1 },
        { speaker: 'Nira', text: 'Third.', startTime: 3 },
      ],
    });
    expect(savedLiveNotesSource(raw)?.segments.map((x) => x.text)).toEqual([
      'first second',
      'Third.',
    ]);
    expect(savedLiveNotesSource('{}')).toBeNull();
    expect(() =>
      savedLiveNotesSource('{"liveSegments":[{"text":"private"}]}'),
    ).toThrow('invalid_saved_live_snapshot');
  });
  it('distinguishes actual exact-key hits from corrected source without a model or network', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network_forbidden'));
    const rows = Array.from({ length: 443 }, (_, i) => ({
      speaker: i % 2 ? 'Milo' : 'Nira',
      text: `Detailed meeting context ${i}. Follow-up context.`,
    }));
    try {
      const source = createNotesSource(JSON.stringify(rows));
      const same = await inspectLiveNotesReuse(source, source);
      expect(same.cachedLivePackets).toBeGreaterThan(0);
      expect(same.matchingCachedPackets).toBe(same.cachedLivePackets);
      const different = await inspectLiveNotesReuse(
        source,
        createNotesSource(
          JSON.stringify(
            rows.map((row) => ({ ...row, text: `Corrected ${row.text}` })),
          ),
        ),
      );
      expect(different.matchingCachedPackets).toBe(0);
      expect(different.modelRequests).toBe(0);
      expect(different.qualityEvaluated).toBe(false);
      expect(JSON.stringify(different)).not.toContain('Detailed meeting');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  }, 15_000);
});
