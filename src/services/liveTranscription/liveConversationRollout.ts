import { createLiveConversationProjection } from './liveConversationProjection';

export type LiveConversationProjector = ReturnType<
  typeof createLiveConversationProjection
>;

export const createLiveConversationRollout = async ({
  generation,
  getSetting,
  createProjector = createLiveConversationProjection,
}: {
  generation: number;
  getSetting: (key: string) => Promise<unknown>;
  createProjector?: (input: {
    generation: number;
  }) => LiveConversationProjector;
}): Promise<LiveConversationProjector | null> => {
  try {
    const value = await getSetting('stable_live_conversation_v1');
    if (value !== true && value !== 'true' && value !== '1') return null;
    return createProjector({ generation });
  } catch {
    return null;
  }
};
