import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('known-person transcription vocabulary production boundary', () => {
  const audioManager = readFileSync('src/components/AudioManager.tsx', 'utf8');
  const main = readFileSync('electron/main.ts', 'utf8');
  const finalClient = readFileSync(
    'electron/transcription/parakeetFinalClient.ts',
    'utf8',
  );
  const finalWorker = readFileSync(
    'src/services/finalTranscription/runPersistedMeetingFinalTranscription.ts',
    'utf8',
  );

  it('resolves and caches one vocabulary selection at the recording boundary', () => {
    expect(main).toContain("'GET_TRANSCRIPTION_VOCABULARY'");
    expect(audioManager).toContain("'GET_TRANSCRIPTION_VOCABULARY'");
    expect(audioManager).toContain('transcriptionVocabularyRef.current');
    expect(audioManager).toContain('initialPrompt:');
  });

  it('threads sanitized vocabulary into Parakeet final transcription', () => {
    expect(finalWorker).toContain('sanitizeVocabularyTerms');
    expect(finalWorker).toContain('vocabulary,');
    expect(finalClient).toContain('vocabulary: request.vocabulary ?? []');
  });

  it('persists only content-free vocabulary provenance', () => {
    expect(finalWorker).toContain('vocabularyHintPolicyVersion');
    expect(finalWorker).toContain('vocabularyHintCount');
    expect(audioManager).toContain("'[Pluto] Transcription vocabulary ready'");
    expect(audioManager).not.toContain('console.log(initialPrompt');
  });
});
