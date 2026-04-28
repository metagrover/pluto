import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_SYNTHESIS_VERSION,
  knowledgeDocNeedsSynthesis,
  withCurrentKnowledgeSynthesisConfig,
} from '../../electron/knowledgeDocConfig';

describe('knowledge doc config', () => {
  it('preserves existing doc config while stamping the current synthesis version', () => {
    expect(
      withCurrentKnowledgeSynthesisConfig(
        JSON.stringify({ member_entity_ids: ['person-1'] }),
      ),
    ).toEqual({
      member_entity_ids: ['person-1'],
      synthesis_version: KNOWLEDGE_SYNTHESIS_VERSION,
    });
  });

  it('refreshes up-to-date docs when they were built by an older synthesis version', () => {
    expect(
      knowledgeDocNeedsSynthesis({
        status: 'up_to_date',
        config: null,
      }),
    ).toBe(true);
    expect(
      knowledgeDocNeedsSynthesis({
        status: 'up_to_date',
        config: JSON.stringify({
          synthesis_version: KNOWLEDGE_SYNTHESIS_VERSION,
        }),
      }),
    ).toBe(false);
  });
});
