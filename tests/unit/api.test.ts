import { describe, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('electron', () => {
  const path = require('node:path');
  return {
    app: {
      getPath: (name: string) => {
        if (name === 'userData')
          return path.join(
            process.env.HOME || '',
            'Library',
            'Application Support',
            'pluto',
          );
        return '/tmp';
      },
      isPackaged: false,
      getAppPath: () => process.cwd(),
    },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
  };
});

import { searchMeetingsFts } from '../../electron/db';
import * as db from '../../electron/db';
import {
  parseQuery,
  retrieveContext,
} from '../../electron/intelligence/queryEngine';
import { getAskPlutoPrompt } from '../../electron/intelligence/queryPrompts';
import { getAllSettings, getProvider } from '../../electron/llm/factory';

describe('REAL API E2E', () => {
  it('should find berlin meeting', async () => {
    const query = 'do you know about Berlin meeting?';

    // 1. Raw search to confirm it's in DB right now
    const raw = searchMeetingsFts('Berlin');
    console.log(`\n\n=== RAW FTS SEARCH FOR 'Berlin' ===`);
    console.log(`Found ${raw.length} matches.`);
    if (raw.length > 0) console.log(`Snippet 1: ${raw[0].snippet}`);

    // 2. Parse Query
    const parsed = await parseQuery(query);
    console.log('\n=== PARSED INTENT ===');
    console.log(
      `Intent: ${parsed.intent}\nKeywords: ${parsed.keywords}\nExpanded: ${parsed.expanded_keywords}`,
    );

    // 3. Retrieve Context
    const context = await retrieveContext(parsed);
    console.log('\n=== RETRIEVED CONTEXT ===');
    console.log(`Count: ${context.length}`);
    if (context.length > 0) {
      console.log(
        `First Context:\n${context[0].evidence_text.substring(0, 500)}`,
      );
    } else {
      console.log(`WHY DID IT FAIL? Let's check intent:`, parsed);
    }

    // 4. Hit LLM
    try {
      const settings = await getAllSettings();
      console.log('\n=== LLM Settings ===');
      console.log(`Provider: ${settings.llm_provider}`);
      const provider = await getProvider(settings);

      const prompt = getAskPlutoPrompt(query, context, 'Use exact quotes.');
      console.log(`\n=== LLM PROMPT ===\n${prompt}`);

      console.log('\n=== QUERYING LLM ===');
      const answer = await provider.answerAskPluto(prompt);
      console.log(`\n=== FINAL ASSISTANT COMPLETED ===\n\n${answer}\n\n`);
    } catch (e) {
      console.error(e);
    }
  }, 120000);
});
