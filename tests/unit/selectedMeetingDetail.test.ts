import { describe, expect, it } from 'vitest';
import {
  loadSelectedMeetingDetail,
  mergeMeetingStatus,
} from '../../src/services/selectedMeetingDetail';

describe('selected meeting detail boundary', () => {
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
