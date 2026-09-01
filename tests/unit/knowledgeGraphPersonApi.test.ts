import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPeopleBriefingSummaries,
  getPersonBriefing,
  mergePerson,
  restorePersonMerge,
  updatePersonName,
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

  it('sends canonical person identity edits through explicit IPC channels', async () => {
    await updatePersonName('person-1', 'Avery Smith');
    await mergePerson('person-2', 'person-1');
    await restorePersonMerge('person-2');

    expect(invoke).toHaveBeenNthCalledWith(1, 'UPDATE_PERSON_NAME', {
      personId: 'person-1',
      name: 'Avery Smith',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'MERGE_PERSON', {
      personId: 'person-2',
      destinationPersonId: 'person-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      'RESTORE_PERSON_MERGE',
      'person-2',
    );
  });
});
