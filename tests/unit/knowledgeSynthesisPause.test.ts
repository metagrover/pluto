import { describe, expect, it, vi } from 'vitest';

import {
  configureKnowledgeSynthesisPause,
  knowledgeSynthesisPause,
} from '../../electron/knowledgeSynthesisPause';

describe('knowledge synthesis pause coordination', () => {
  it('can be configured without importing knowledge database initialization', () => {
    const onPausedChange = vi.fn();
    configureKnowledgeSynthesisPause(onPausedChange);

    knowledgeSynthesisPause.acquire('llm_active');
    knowledgeSynthesisPause.release('llm_active');

    expect(onPausedChange.mock.calls).toEqual([[true], [false]]);
  });
});
