// Opt-in acceptance against the built app, an isolated synthetic profile,
// the real local model, and controlled transport failures in this process.
if (
  process.env.ASK_PLUTO_WORKFLOW_ACCEPTANCE !== '1' ||
  !process.versions.electron
) {
  throw new Error(
    'Run with ASK_PLUTO_WORKFLOW_ACCEPTANCE=1 through Electron after building Pluto.',
  );
}
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const root = process.cwd();
const directory = fs.mkdtempSync(
  path.join(require('node:os').tmpdir(), 'pluto-ask-workflow-'),
);
const outputPath = path.resolve(
  process.env.ASK_PLUTO_WORKFLOW_REPORT ||
    '.private/ask-pluto-workflow-acceptance.json',
);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(directory, { recursive: true });
if (!fs.existsSync(path.join(directory, 'database-storage.json')))
  fs.writeFileSync(
    path.join(directory, 'database-storage.json'),
    JSON.stringify({ version: 1, mode: 'standard', initialized: false }),
  );
process.env.PLUTO_USER_DATA_DIR = directory;
app.setPath('userData', directory);
app.getAppPath = () => root;
const handlers = new Map();
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  handlers.set(channel, handler);
  register(channel, handler);
};
let fakeMode = null;
let mockPort;
let mockStarted = false;
const request = http.request;
http.request = function (input, options, callback) {
  const url = new URL(input);
  if (fakeMode && url.hostname === '127.0.0.1' && url.port === '11434')
    url.port = String(mockPort);
  return request.call(this, url, options, callback);
};
const server = http.createServer((req, res) => {
  if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
  if (req.url === '/api/tags')
    return res.end(JSON.stringify({ models: [{ name: 'gemma4:12b' }] }));
  let body = '';
  req.on('data', (part) => {
    body += part;
  });
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    if (payload.keep_alive === 0)
      return res.end(JSON.stringify({ done: true }));
    mockStarted = true;
    res.setHeader('Content-Type', 'application/x-ndjson');
    if (fakeMode === 'unavailable') {
      res.statusCode = 503;
      return res.end('Provider unavailable');
    }
    if (fakeMode === 'wait') {
      res.write(
        `${JSON.stringify({ response: 'Morgan owns the report. ' })}\n`,
      );
      return;
    }
    if (fakeMode === 'truncated') {
      res.write(
        `${JSON.stringify({ response: 'Morgan owns the acceptance report.' })}\n`,
      );
      return setTimeout(
        () =>
          res.end(`${JSON.stringify({ done: true, done_reason: 'length' })}\n`),
        20,
      );
    }
    return res.end(
      `${JSON.stringify({ response: 'Morgan owns the acceptance report.' })}\n${JSON.stringify({ done: true, done_reason: 'stop' })}\n`,
    );
  });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = [];
async function execute() {
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      mockPort = server.address().port;
      resolve();
    }),
  );
  require(path.join(root, 'dist-electron-package/bootstrap.js'));
  for (
    let attempt = 0;
    attempt < 300 && !handlers.has('intelligence:query');
    attempt++
  )
    await sleep(100);
  assert(handlers.has('intelligence:query'), 'query handler registered');
  const window = BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed(),
  );
  assert(window, 'main window exists');
  for (let attempt = 0; attempt < 300; attempt++) {
    if (
      await window.webContents.executeJavaScript('Boolean(window.ipcRenderer)')
    )
      break;
    await sleep(100);
  }
  const invoke = (channel, ...args) =>
    window.webContents.executeJavaScript(
      `window.ipcRenderer.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`,
    );
  for (const [key, value] of Object.entries({
    setup_complete: 'true',
    llm_provider: 'ollama',
    ollama_model: 'gemma4:12b',
    ollama_fast_model: 'gemma4:12b',
    ollama_seed: '42',
    auto_synthesis_enabled: 'false',
  }))
    await invoke('SET_SETTING', { key, value });
  const dates = [
    '2026-10-04T18:00:00Z',
    '2026-10-04T19:00:00Z',
    '2026-10-04T20:00:00Z',
    '2026-10-04T21:00:00Z',
  ];
  const notes = [
    `Morgan completed the old checklist. ${'General planning context. '.repeat(220)}\nMorgan agreed to send the acceptance report by October 7. Casey owns deployment.\n${'Routine implementation update. '.repeat(220)}`,
    'Morgan agreed to prepare the budget review. Casey owns the deployment checklist.',
    'Morgan will validate release metrics. Casey will deploy the service.',
    'Morgan owns the readiness memo. No due date was recorded for that memo.',
  ];
  for (let i = 0; i < 4; i++)
    await invoke(
      'SAVE_MEETING',
      {
        id: `synthetic-workflow-${i}`,
        title: `Synthetic review ${i + 1}`,
        started_at: dates[i],
        enhanced_notes: notes[i],
        analysis_format_pass: 1,
      },
      { skipParticipantAssociation: true },
    );
  const person = await invoke('UPSERT_ENTITY', {
    id: 'synthetic-morgan',
    type: 'person',
    name: 'Morgan',
  });
  await invoke('UPSERT_ENTITY', {
    id: 'synthetic-closed',
    type: 'action_item',
    name: 'Archive the old checklist.',
    status: 'completed',
    assigned_to: person.id,
    metadata: {
      source_meeting_id: 'synthetic-workflow-0',
      full_description: 'Archive the old checklist.',
      owner_source: 'user',
    },
  });
  const run = async (id, query, priorTurns = []) => {
    const start = Date.now();
    const result = await invoke('intelligence:query', {
      requestId: `workflow-${id}`,
      query,
      priorTurns,
      modeOverride: 'fast',
    });
    report.push({ id, totalMs: Date.now() - start, result });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(
      'WORKFLOW',
      id,
      result.status,
      result.outcome,
      Date.now() - start,
    );
    return result;
  };
  const original = "What's assigned to Morgan?";
  const first = await run('assignment', original);
  assert.equal(first.status, 'answered');
  for (const term of [
    'acceptance report',
    'budget review',
    'release metrics',
    'readiness memo',
  ])
    assert(first.answer.toLowerCase().includes(term), `${term} present`);
  assert(!/morgan (?:owns|is responsible for) deployment/i.test(first.answer));
  assert.notEqual(first.trustStatus, 'grounded');
  const turns = [
    { role: 'user', content: original },
    {
      role: 'assistant',
      content: 'Morgan owns the acceptance report.',
      meetingIds: ['synthetic-workflow-0'],
      conversationAnchor: original,
    },
  ];
  const retry = await run('retry', 'try again?', turns);
  assert.equal(retry.status, 'answered');
  assert(retry.answer.trim());
  for (const term of [
    'acceptance report',
    'budget review',
    'release metrics',
    'readiness memo',
  ])
    assert(
      retry.answer.toLowerCase().includes(term),
      `${term} retained on retry`,
    );
  assert(/(?:completed|complete)/i.test(retry.answer));
  const more = await run('breadth', 'There should be more', turns);
  assert.equal(more.status, 'answered');
  assert(
    more.answer.toLowerCase().includes('readiness memo'),
    'fourth previously uncited meeting recovered',
  );
  const draft = await run(
    'draft',
    'Draft a short follow-up message to Morgan about the acceptance report. Ask for an update without adding a deadline.',
    turns,
  );
  assert.equal(draft.status, 'answered');
  assert(draft.answer.toLowerCase().includes('report'));
  assert(!/october|tomorrow|\bby\s+(?:\w+day|\d)/i.test(draft.answer));
  fakeMode = 'truncated';
  const truncated = await run('truncated', original);
  assert.equal(truncated.status, 'unavailable');
  assert.equal(truncated.failureReason, 'invalid_response');
  assert.equal(truncated.outcome, 'partial');
  assert(truncated.answer.includes('acceptance report'));
  fakeMode = 'unavailable';
  const unavailable = await run('unavailable', original);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.failureReason, 'provider_unavailable');
  fakeMode = 'wait';
  mockStarted = false;
  await window.webContents.executeJavaScript(
    `window.__workflowPending = window.ipcRenderer.invoke('intelligence:query',{requestId:'workflow-cancel',query:${JSON.stringify(original)},modeOverride:'fast'}); undefined`,
  );
  for (let attempt = 0; attempt < 150 && !mockStarted; attempt++)
    await sleep(50);
  assert(mockStarted, 'provider started');
  const start = Date.now();
  const cancelled = await invoke(
    'intelligence:query:cancel',
    'workflow-cancel',
  );
  assert.equal(cancelled.cancelled, true);
  const stopped = await window.webContents.executeJavaScript(
    'window.__workflowPending',
  );
  assert.equal(stopped.status, 'cancelled');
  report.push({ id: 'cancel', totalMs: Date.now() - start, result: stopped });
  fakeMode = 'healthy';
  const recovered = await run('after-cancel', original);
  assert.equal(recovered.status, 'answered');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log('WORKFLOW PASS', report.length, 'report:', outputPath);
}
async function finish(code) {
  let exitCode = code;
  server.closeAllConnections();
  server.close();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  // Let Chromium finish its profile writes before removing the fixture.
  await sleep(100);
  try {
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch (error) {
    console.error('WORKFLOW CLEANUP FAIL', error);
    exitCode = 1;
  } finally {
    app.exit(exitCode);
  }
}
execute().then(
  () => finish(0),
  (error) => {
    console.error('WORKFLOW FAIL', error);
    return finish(1);
  },
);
setTimeout(() => {
  console.error('WORKFLOW TIMEOUT');
  void finish(2);
}, 240000).unref();
