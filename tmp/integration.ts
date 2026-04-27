import * as path from 'path';

// Mock Electron app before importing db
const mockGetPath = (name: string) => {
  if (name === 'userData')
    return path.join(
      process.env.HOME || '',
      'Library',
      'Application Support',
      'pluto',
    );
  if (name === 'temp') return '/tmp';
  return '/tmp';
};

// We need to polyfill/mock electron
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'electron') {
    return {
      app: {
        getPath: mockGetPath,
        isPackaged: false,
        getAppPath: () => process.cwd(),
      },
      ipcMain: { handle: () => {}, on: () => {} },
      BrowserWindow: {},
      Menu: {},
      Tray: {},
      nativeImage: {},
      shell: {},
      systemPreferences: {},
    };
  }
  return originalRequire.apply(this, arguments);
};

import * as db from './electron/db.js';
import {
  auditCitations,
  buildCitationChain,
} from './electron/intelligence/citationEngine.js';
// Now we can safely import the backend code!
import {
  parseQuery,
  retrieveContext,
} from './electron/intelligence/queryEngine.js';
import { getAskPlutoPrompt } from './electron/intelligence/queryPrompts.js';
import { getAllSettings, getProvider } from './electron/llm/factory.js';

async function runLocalQuery() {
  const query = 'What do you know about the Berlin meeting?';
  console.log(`[TEST] User Query: "${query}"`);

  try {
    const parsed = await parseQuery(query);
    console.log(
      `[TEST] Parsed Intent: ${parsed.intent}, Keywords: ${parsed.keywords.join(', ')}, Expanded: ${parsed.expanded_keywords?.join(', ')}`,
    );

    // Check FTS results
    const ftsResults = db.searchMeetingsFts('Berlin', { limit: 10 });
    console.log(`[TEST] Raw FTS Results length: ${ftsResults.length}`);
    if (ftsResults.length > 0) {
      console.log(`[TEST] First FTS Snippet: ${ftsResults[0].snippet}`);
    }

    const context = await retrieveContext(parsed);
    console.log(`[TEST] Retrieved Context count: ${context.length}`);
    if (context.length > 0) {
      console.log(
        `[TEST] Context 0 Evidence: ${context[0].evidence_text.substring(0, 100)}...`,
      );
    } else {
      console.error(`[TEST ERROR] No context retrieved!`);
    }

    const settings = await getAllSettings(db);
    const provider = await getProvider(settings);

    const prompt = getAskPlutoPrompt(
      query,
      context,
      'Use exact quotes wherever possible.',
    );
    console.log(`[TEST] Prompt length: ${prompt.length}`);

    const answerHtml = await provider.answerAskPluto(prompt);
    console.log(`\n\n[TEST FINAL ANSWER]:\n${answerHtml}\n\n`);

    const rawCitations = buildCitationChain(answerHtml, context);
    const audited = auditCitations(rawCitations);
    console.log(`[TEST CITATIONS] Found ${audited.length} citations.`);
    console.log(JSON.stringify(audited, null, 2));
  } catch (e) {
    console.error(e);
  }
}

runLocalQuery();
