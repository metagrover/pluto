import { describe, expect, it, vi } from 'vitest';

import { createLiveConversationRollout } from '../../src/services/liveTranscription/liveConversationRollout';

describe('live conversation rollout', () => {
  it.each([null, '', 'false', false, '0'])(
    'stays disabled for %s',
    async (value) => {
      const createProjector = vi.fn();
      expect(
        await createLiveConversationRollout({
          generation: 1,
          getSetting: vi.fn(async () => value),
          createProjector,
        }),
      ).toBeNull();
      expect(createProjector).not.toHaveBeenCalled();
    },
  );

  it('fails closed without constructing state when the setting read fails', async () => {
    const createProjector = vi.fn();
    expect(
      await createLiveConversationRollout({
        generation: 1,
        getSetting: vi.fn(async () => {
          throw new Error('unavailable');
        }),
        createProjector,
      }),
    ).toBeNull();
    expect(createProjector).not.toHaveBeenCalled();
  });

  it.each([true, 'true', '1'])(
    'constructs once at capture start for %s',
    async (value) => {
      const projector = { marker: true } as never;
      const createProjector = vi.fn(() => projector);
      expect(
        await createLiveConversationRollout({
          generation: 7,
          getSetting: vi.fn(async () => value),
          createProjector,
        }),
      ).toBe(projector);
      expect(createProjector).toHaveBeenCalledOnce();
      expect(createProjector).toHaveBeenCalledWith({ generation: 7 });
    },
  );
});
