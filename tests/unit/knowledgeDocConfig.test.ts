import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_SYNTHESIS_VERSION,
  getKnowledgeSynthesisInputConfig,
  knowledgeDocNeedsSynthesis,
  knowledgeDocSatisfiesMeetingRefresh,
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

  it('excludes the persisted input fingerprint from the next synthesis input', () => {
    expect(
      getKnowledgeSynthesisInputConfig(
        JSON.stringify({
          member_entity_ids: ['person-1'],
          synthesis_input_hash: 'previous',
        }),
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

  it('reuses a current durable doc only when it covers every eligible meeting', () => {
    const currentDoc = {
      status: 'up_to_date',
      config: JSON.stringify({
        synthesis_version: KNOWLEDGE_SYNTHESIS_VERSION,
        synthesis_input_hash: 'current-input',
      }),
    };

    expect(
      knowledgeDocSatisfiesMeetingRefresh(currentDoc, {
        meetingIsCandidate: true,
        meetingIsPersistedSource: true,
        currentSynthesisInputHash: 'current-input',
      }),
    ).toBe(true);
    expect(
      knowledgeDocSatisfiesMeetingRefresh(currentDoc, {
        meetingIsCandidate: true,
        meetingIsPersistedSource: false,
        currentSynthesisInputHash: 'current-input',
      }),
    ).toBe(false);
    expect(
      knowledgeDocSatisfiesMeetingRefresh(currentDoc, {
        meetingIsCandidate: true,
        meetingIsPersistedSource: true,
        currentSynthesisInputHash: 'new-input',
      }),
    ).toBe(false);
    expect(
      knowledgeDocSatisfiesMeetingRefresh(currentDoc, {
        meetingIsCandidate: false,
        meetingIsPersistedSource: false,
        currentSynthesisInputHash: null,
      }),
    ).toBe(true);
  });
});
