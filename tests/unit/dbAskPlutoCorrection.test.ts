import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabase = vi.hoisted(() => ({
  directory: `/tmp/pluto-ask-correction-db-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`,
}));

vi.mock('electron', () => ({
  app: { getPath: () => testDatabase.directory },
}));

import {
  ensureGlobalKnowledgeDoc,
  getKnowledgeCorrections,
  saveKnowledgeCorrection,
} from '../../electron/db';

afterAll(() => {
  fs.rmSync(testDatabase.directory, { recursive: true, force: true });
});

describe('Ask Pluto correction persistence', () => {
  it('stores claim corrections in the shared knowledge correction table', () => {
    const globalDoc = ensureGlobalKnowledgeDoc();
    const saved = saveKnowledgeCorrection({
      doc_id: globalDoc.id,
      target_kind: 'claim',
      target_id: 'ask-pluto:pricing-owner',
      action: 'correct_claim',
      payload: {
        source: 'ask_pluto',
        original_claim: 'Sam owns pricing approval.',
        corrected_text: 'Alex owns pricing approval.',
        meeting_ids: ['meeting-1'],
      },
    });

    expect(saved).toMatchObject({
      doc_id: globalDoc.id,
      target_kind: 'claim',
      action: 'correct_claim',
    });
    expect(getKnowledgeCorrections(globalDoc.id)).toHaveLength(1);
    expect(globalDoc.status).toBe('stale');
  });
});
