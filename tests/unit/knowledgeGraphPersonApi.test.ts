import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPeopleBriefingSummaries,
  getPersonBriefing,
} from '../../src/api/knowledgeGraph';

describe('person briefing renderer API', () => {
  const invoke = vi.fn(async () => ({}));

  beforeEach(() => {
    invoke.mockClear();
    Object.assign(globalThis, {
      window: { ipcRenderer: { invoke } },
    });
  });

  it('requests the evidence-shaped dossier by stable person id', async () => {
    await getPersonBriefing('person-1');

    expect(invoke).toHaveBeenCalledWith('GET_PERSON_BRIEFING', 'person-1');
  });

  it('requests the bounded People list read model', async () => {
    await getPeopleBriefingSummaries();

    expect(invoke).toHaveBeenCalledWith('GET_PEOPLE_BRIEFING_SUMMARIES');
  });
});
