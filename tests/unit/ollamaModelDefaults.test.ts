import { describe, expect, it } from 'vitest';
import { NOTES_OLLAMA_MODEL } from '../../electron/llm/meetingNotesTypes';
import {
  OLLAMA_GENERAL_MODEL,
  OLLAMA_QUICK_CHAT_MODEL,
} from '../../src/utils/ollamaModels';

describe('Ollama model defaults', () => {
  it('keeps Gemma general-purpose and Phi Quick-chat-only', () => {
    expect(OLLAMA_GENERAL_MODEL).toBe('gemma4:12b');
    expect(NOTES_OLLAMA_MODEL).toBe(OLLAMA_GENERAL_MODEL);
    expect(OLLAMA_QUICK_CHAT_MODEL).toBe('phi4-mini:3.8b');
  });
});
