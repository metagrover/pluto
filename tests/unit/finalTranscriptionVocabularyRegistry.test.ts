import { describe, expect, it } from 'vitest';

import {
  clearFinalTranscriptionVocabulary,
  readFinalTranscriptionVocabulary,
  registerFinalTranscriptionVocabulary,
} from '../../src/services/finalTranscription/finalTranscriptionVocabularyRegistry';

describe('finalTranscriptionVocabularyRegistry', () => {
  it('keeps participant-specific terms in memory without exposing mutable state', () => {
    registerFinalTranscriptionVocabulary('meeting-1', ['Specific Name']);

    const terms = readFinalTranscriptionVocabulary('meeting-1');
    terms?.push('Mutation');

    expect(readFinalTranscriptionVocabulary('meeting-1')).toEqual([
      'Specific Name',
    ]);
    clearFinalTranscriptionVocabulary('meeting-1');
    expect(readFinalTranscriptionVocabulary('meeting-1')).toBeNull();
  });
});
