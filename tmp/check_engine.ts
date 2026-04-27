import fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

const mockGetPath = (name: string) => {
  if (name === 'userData')
    return path.join(
      process.env.HOME || '',
      'Library',
      'Application Support',
      'pluto',
    );
  return '/tmp';
};

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
    };
  }
  return originalRequire.apply(this, arguments);
};

import * as db from './electron/db.js';
// @ts-ignore
import {
  parseQuery,
  retrieveContext,
} from './electron/intelligence/queryEngine.js';

async function test() {
  const query = 'What do you know about the Berlin meeting?';
  console.log('Parsing query via mocked intent engine...');
  // Bypass actual LLM for parsing so we can test the retrieval reliably
  const ftsDocs = db.searchMeetingsFts('Berlin');
  console.log("\nRAW FTS RESULT FOR 'Berlin':", ftsDocs.length);
  if (ftsDocs.length > 0) {
    console.log('Snippet:', ftsDocs[0].snippet);
  }

  const context = await retrieveContext({
    intent: 'factual',
    keywords: ['Berlin'],
  });
  console.log('\nRETRIEVED CONTEXT LENGTH:', context.length);
  if (context.length > 0) {
    console.log('\nCONTEXT 0 EVIDENCE TEXT:');
    console.log(context[0].evidence_text);
  }
}
test();
