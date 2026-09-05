import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMeetingSpeakerSample } from '../../src/api/identity';

describe('identity renderer API', () => {
  const invoke = vi.fn(async () => null);

  beforeEach(() => {
    invoke.mockClear();
    Object.assign(globalThis, { window: { ipcRenderer: { invoke } } });
  });

  it('requests a meeting-scoped canonical speaker sample without a path', async () => {
    await getMeetingSpeakerSample('meeting-a', 'Remote Speaker 1', 1);

    expect(invoke).toHaveBeenCalledWith('GET_MEETING_SPEAKER_SAMPLE', {
      meetingId: 'meeting-a',
      speaker: 'Remote Speaker 1',
      sampleIndex: 1,
    });
  });
});
