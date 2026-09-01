import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPersonBriefing } from '../../src/api/knowledgeGraph';

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
});
