import { describe, expect, it } from 'vitest';
import {
  createMeetingStatusRequestGate,
  loadSelectedMeetingDetail,
  mergeMeetingStatus,
} from '../../src/services/selectedMeetingDetail';

describe('selected meeting detail boundary', () => {
  it('rejects out-of-order status and draft responses even after a newer request completed', () => {
    const gate = createMeetingStatusRequestGate();
    const old = gate.start('a');
    const unrelated = gate.start('b');
    const newer = gate.start('a');
    expect(old.isLatest()).toBe(false);
    old.finish();
    expect(newer.isLatest()).toBe(true);
    newer.finish();
    const newest = gate.start('a');
    expect(old.isLatest()).toBe(false);
    expect(newer.isLatest()).toBe(false);
    expect(newest.isLatest()).toBe(true);
    expect(unrelated.isLatest()).toBe(true);
  });
  it('rejects a detail response after selection changes', async () => {
    let resolveDetail!: (value: { id: string; title: string }) => void;
    const detail = new Promise<{ id: string; title: string }>((resolve) => {
      resolveDetail = resolve;
    });
    let selectedId = 'meeting-a';
    const pending = loadSelectedMeetingDetail({
      meetingId: 'meeting-a',
      load: async () => detail,
      isCurrent: (meetingId) => meetingId === selectedId,
    });

    selectedId = 'meeting-b';
    resolveDetail({ id: 'meeting-a', title: 'Stale' });

    await expect(pending).resolves.toBeNull();
  });

  it('merges bounded status without replacing selected private detail', () => {
    expect(
      mergeMeetingStatus(
        {
          id: 'meeting-a',
          title: 'Detail',
          transcript_json: 'PRIVATE TRANSCRIPT',
          analysis_json: 'PRIVATE ANALYSIS',
        },
        {
          id: 'meeting-a',
          title: 'Updated title',
          transcript_status: 'validated',
          analysis_run_json: JSON.stringify({ notes_status: 'running' }),
        },
      ),
    ).toMatchObject({
      title: 'Updated title',
      transcript_status: 'validated',
      transcript_json: 'PRIVATE TRANSCRIPT',
      analysis_json: 'PRIVATE ANALYSIS',
    });
  });
});
