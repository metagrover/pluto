import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_SYNTHESIS_VERSION,
  PERSON_CONTEXT_SYNTHESIS_VERSION,
  getKnowledgeSynthesisInputConfig,
  knowledgeDocNeedsSynthesis,
  knowledgeDocSatisfiesMeetingRefresh,
  shouldPublishPartialKnowledgeDoc,
  withCurrentKnowledgeSynthesisConfig,
} from '../../electron/knowledgeDocConfig';

describe('knowledge doc config', () => {
  it('keeps a complete person read in place until its replacement is ready', () => {
    expect(shouldPublishPartialKnowledgeDoc('person_context')).toBe(false);
    expect(shouldPublishPartialKnowledgeDoc('project')).toBe(true);
  });

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

  it('refreshes person dossiers for the person-specific synthesis contract only', () => {
    const previousConfig = JSON.stringify({
      synthesis_version: KNOWLEDGE_SYNTHESIS_VERSION,
    });
    expect(
      knowledgeDocNeedsSynthesis({
        status: 'up_to_date',
        scope_type: 'person_context',
        config: previousConfig,
      }),
    ).toBe(true);
    expect(
      knowledgeDocNeedsSynthesis({
        status: 'up_to_date',
        scope_type: 'project',
        config: previousConfig,
      }),
    ).toBe(false);
    expect(
      withCurrentKnowledgeSynthesisConfig(null, undefined, 'person_context')
        .synthesis_version,
    ).toBe(PERSON_CONTEXT_SYNTHESIS_VERSION);
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
