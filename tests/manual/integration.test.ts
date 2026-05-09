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
        if (name === 'temp') return '/tmp';
        return '/tmp';
      },
      isPackaged: false,
      getAppPath: () => process.cwd(),
    },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    BrowserWindow: {},
    Menu: {},
    Tray: {},
    nativeImage: {},
    shell: {},
    systemPreferences: {},
  };
});

import * as db from '../../electron/db';
import {
  auditCitations,
  buildCitationChain,
} from '../../electron/intelligence/citationEngine';
import {
  parseQuery,
  retrieveContext,
} from '../../electron/intelligence/queryEngine';
import { getAskPlutoPrompt } from '../../electron/intelligence/queryPrompts';
import { getAllSettings, getProvider } from '../../electron/llm/factory';

describe('Local Integration Test', () => {
  it('should query Berlin end-to-end', async () => {
    const query = 'What do you know about the Berlin meeting?';
    console.log(`[TEST] User Query: "${query}"`);

    const parsed = await parseQuery(query);
    console.log(
      `[TEST] Parsed Intent: ${parsed.intent}, Keywords: ${parsed.keywords.join(', ')}, Expanded: ${parsed.expanded_keywords?.join(', ')}`,
    );

    const ftsResults = db.searchMeetingsFts('Berlin', { limit: 10 });
    console.log(`[TEST] FTS Results for Berlin length: ${ftsResults.length}`);
    if (ftsResults.length > 0) {
      console.log(`[TEST] First FTS Snippet: ${ftsResults[0].snippet}`);
    }

    const context = await retrieveContext(parsed);
    console.log(`[TEST] Retrieved Context length: ${context.length}`);
    if (context.length > 0) {
      console.log(
        `[TEST] Context 0 Evidence: ${context[0].evidence_text.substring(0, 150)}...`,
      );
    } else {
      console.error('[TEST ERROR] No context retrieved!');
    }

    const settings = await getAllSettings(db);
    const provider = await getProvider(settings);

    const prompt = getAskPlutoPrompt(
      query,
      context,
      'Use exact quotes wherever possible.',
    );

    const answerHtml = await provider.answerAskPluto(prompt);
    console.log(`\n\n[TEST FINAL ANSWER]:\n${answerHtml}\n\n`);

    const rawCitations = buildCitationChain(answerHtml, context);
    const audited = auditCitations(rawCitations);
    console.log(`[TEST CITATIONS] Found ${audited.length} citations.`);
  }, 60000);
});
