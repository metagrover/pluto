import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  writeText: vi.fn(),
  showSaveDialog: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3' },
  clipboard: { writeText: mocks.writeText },
  dialog: { showSaveDialog: mocks.showSaveDialog },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) =>
      mocks.handlers.set(name, handler),
  },
  shell: { openExternal: mocks.openExternal },
}));
vi.mock('node:fs/promises', () => ({ writeFile: mocks.writeFile }));

let api: typeof import('../../electron/bugReports');
const owner = { sender: { id: 1 } };
const prepare = (context: object = {}) =>
  mocks.handlers.get('BUG_REPORT_PREPARE')!(owner, context);
const action = (id: string, kind: string, description = '', event = owner) =>
  mocks.handlers.get('BUG_REPORT_ACTION')!(event, {
    id,
    action: kind,
    description,
  });

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
  mocks.handlers.clear();
  api = await import('../../electron/bugReports');
  api.registerBugReportHandlers((key) =>
    key === 'llm_provider' ? 'ollama' : 'private-model-name',
  );
});

describe('bug report diagnostics', () => {
  it('retains the relevant failure even after recent successes replace the event window', () => {
    api.recordBugReportEvent({
      operation: 'project_updates',
      stage: 'prepare_updates',
      outcome: 'failed',
      durationMs: 12,
      entityId: 'p1',
      error: 'timeout',
    });
    for (let i = 0; i < 45; i++)
      api.recordBugReportEvent({
        operation: 'project_updates',
        stage: 'prepare_updates',
        outcome: 'complete',
        resultStatus: 'no_change',
        durationMs: i,
        entityId: 'p1',
      });
    const report = prepare({ area: 'project_updates', entityId: 'p1' });
    expect(report.diagnostics).toContain('Latest matching failure');
    expect(report.diagnostics).toContain('timeout');
    expect(report.diagnostics).toContain('no_change');
    expect(
      prepare({ area: 'project_updates', entityId: 'p2' }).diagnostics,
    ).not.toContain('timeout');
  });

  it('exports precise outcomes, shared attempt IDs and the operation’s required local model', () => {
    api.recordBugReportEvent({
      operation: 'project_updates',
      stage: 'prepare_updates',
      outcome: 'complete',
      durationMs: 12,
      resultStatus: 'proposed',
      proposalCount: 2,
      requiredProvider: 'ollama',
      requiredModel: 'gemma4:12b',
      attemptId: '11111111-1111-4111-8111-111111111111',
    });
    api.recordBugReportEvent({
      operation: 'project_themes',
      stage: 'route_projects',
      outcome: 'deferred',
      durationMs: 10,
      reason: 'foreground_preempted',
      remainingCount: 3,
    });
    const report = prepare();
    expect(report.diagnostics).toContain('"resultStatus":"proposed"');
    expect(report.diagnostics).toContain('"proposalCount":2');
    expect(report.diagnostics).toContain('"requiredModel":"gemma4:12b"');
    expect(report.diagnostics).toContain(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(report.diagnostics).toContain('foreground_preempted');
    expect(report.diagnostics).toContain(
      'No matching failure in retained session diagnostics.',
    );
  });

  it('does not expose arbitrary diagnostic reason, status, model or attempt strings', () => {
    api.recordBugReportEvent({
      operation: 'project_updates',
      stage: 'prepare_updates',
      outcome: 'complete',
      durationMs: 1,
      ...{
        reason: 'private-note',
        resultStatus: 'private-title',
        requiredModel: 'private-model',
        attemptId: 'private-id',
      },
    } as any);
    const report = prepare();
    for (const value of [
      'private-note',
      'private-title',
      'private-model',
      'private-id',
    ])
      expect(report.diagnostics).not.toContain(value);
  });
  it('exports only permitted fields and codes, never error contents or entity IDs', async () => {
    const error = new Error(
      'private-note with fake-token and /Users/private-user/meeting.wav',
    );
    error.stack =
      'Error: private-note\n    at synthesize (/Users/private-user/pluto/electron/projectThemeSynthesis.ts:459:5)\n    at privateFunction (/Users/private-user/private-title.js:10:1)';
    api.recordBugReportEvent({
      operation: 'project_updates',
      stage: 'prepare_updates',
      outcome: 'failed',
      durationMs: 52,
      entityId: 'private-project-id',
      error,
      ...{
        notes: 'private-note',
        apiKey: 'fake-token',
        title: 'private-title',
      },
    });
    const draft = prepare({
      area: 'project_updates',
      entityId: 'private-project-id',
    });
    expect(draft.diagnostics).toContain('unknown_error');
    expect(draft.diagnostics).toContain('"durationMs":52');
    expect(draft.diagnostics).toContain('projectThemeSynthesis.ts:459:5');
    expect(draft.diagnostics).toContain('custom (name omitted)');
    for (const privateText of [
      'private-note',
      'fake-token',
      'private-user',
      'private-project-id',
      'private-title',
      'private-model-name',
    ])
      expect(draft.diagnostics).not.toContain(privateText);
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(mocks.writeText).not.toHaveBeenCalled();
  });

  it('keeps project contexts separate and uses the reviewed snapshot for later actions', async () => {
    api.recordBugReportEvent({
      operation: 'project_updates',
      stage: 'prepare_updates',
      outcome: 'failed',
      durationMs: 10,
      entityId: 'p1',
      error: 'timeout',
    });
    const draft = prepare({ area: 'project_updates', entityId: 'p1' });
    api.recordBugReportEvent({
      operation: 'project_updates',
      stage: 'prepare_updates',
      outcome: 'failed',
      durationMs: 20,
      entityId: 'p2',
      error: 'persistence_failed',
    });
    expect(
      prepare({ area: 'project_updates', entityId: 'p1' }).diagnostics,
    ).not.toContain('persistence_failed');
    await action(draft.id, 'copy', 'Clicked Prepare updates');
    expect(mocks.writeText.mock.lastCall?.[0]).toContain(
      'Clicked Prepare updates',
    );
    expect(mocks.writeText.mock.lastCall?.[0]).toContain('timeout');
    expect(mocks.writeText.mock.lastCall?.[0]).not.toContain(
      'persistence_failed',
    );
  });

  it('limits report events and honestly reports absent diagnostics', () => {
    expect(prepare().diagnostics).toContain('No matching events recorded.');
    for (let i = 0; i < 50; i++)
      api.recordBugReportEvent({
        operation: 'project_themes',
        stage: 'route_projects',
        outcome: 'deferred',
        durationMs: i,
      });
    const draft = prepare();
    expect(draft.diagnostics.match(/"operation"/g)).toHaveLength(4);
    expect(draft.diagnostics).toContain('"durationMs":49');
    expect(draft.diagnostics).not.toContain('"durationMs":0');
    expect(draft.diagnostics).not.toContain('"outcome":"failed"');
  });

  it('retains known categories without exporting arbitrary provider errors', () => {
    expect(api.bugReportErrorCode(new SyntaxError('private output'))).toBe(
      'invalid_json',
    );
    expect(
      api.bugReportErrorCode(
        new DOMException('private request', 'TimeoutError'),
      ),
    ).toBe('timeout');
    expect(
      api.bugReportErrorCode({ code: 'ECONNREFUSED', message: 'private-host' }),
    ).toBe('ECONNREFUSED');
    expect(api.bugReportErrorCode('unsupported_project_commitment')).toBe(
      'unsupported_project_commitment',
    );
    expect(api.bugReportErrorCode({ code: 'fake-token' })).toBe(
      'unknown_error',
    );
  });
});

describe('report actions', () => {
  it('opens encoded drafts at fixed destinations without submitting', async () => {
    const draft = prepare();
    const description = 'Retry & expected result?';
    await action(draft.id, 'github', description);
    const github = new URL(mocks.openExternal.mock.lastCall![0]);
    expect(github.origin + github.pathname).toBe(
      'https://github.com/metagrover/pluto/issues/new',
    );
    expect(github.searchParams.get('body')).toContain(description);
    await action(draft.id, 'email', description);
    const email = new URL(mocks.openExternal.mock.lastCall![0]);
    expect(email.pathname).toBe('deepakgrover333+pluto@gmail.com');
    expect(email.searchParams.get('body')).toBe(
      github.searchParams.get('body'),
    );
  });

  it.each(['github', 'email'])(
    'preserves oversized %s reports on the clipboard',
    async (channel) => {
      const draft = prepare();
      const description = '詳細'.repeat(950);
      const result = await action(draft.id, channel, description);
      expect(result.status).toBe('opened_with_copy');
      expect(mocks.writeText.mock.lastCall?.[0]).toContain(description);
      expect(mocks.openExternal.mock.lastCall![0].length).toBeLessThan(500);
    },
  );

  it('rejects arbitrary actions, stale reports, and another window’s report', async () => {
    const draft = prepare();
    await expect(action(draft.id, 'https://untrusted.example')).rejects.toThrow(
      'Invalid report action',
    );
    await expect(
      action(draft.id, 'github', '', { sender: { id: 2 } }),
    ).rejects.toThrow('Report expired');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000);
    await expect(action(draft.id, 'github')).rejects.toThrow('Report expired');
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(() => prepare({ area: 'arbitrary', entityId: 'p1' })).toThrow(
      'Invalid report context',
    );
  });

  it('saves the same report only to the user-selected file and respects cancellation', async () => {
    const draft = prepare();
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await action(draft.id, 'save')).toEqual({ status: 'cancelled' });
    expect(mocks.writeFile).not.toHaveBeenCalled();
    mocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: '/tmp/pluto-report-test.txt',
    });
    expect(await action(draft.id, 'save')).toEqual({ status: 'saved' });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/tmp/pluto-report-test.txt',
      api.formatBugReport(draft, ''),
      { encoding: 'utf8', mode: 0o600 },
    );
  });

  it('propagates external-open failure so the UI can offer copy/save', async () => {
    mocks.openExternal.mockRejectedValueOnce(new Error('No mail handler'));
    await expect(action(prepare().id, 'email')).rejects.toThrow(
      'No mail handler',
    );
  });
});
