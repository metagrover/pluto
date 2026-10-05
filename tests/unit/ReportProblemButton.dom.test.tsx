// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReportProblemButton } from '../../src/components/features/ReportProblemButton';
import { SettingsTab } from '../../src/components/features/SettingsTab';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'BUG_REPORT_PREPARE')
      return {
        id: 'report-1',
        title: 'Project updates failed',
        diagnostics: 'Pluto: 1.2.3\nerrorCode: timeout',
      };
    if (channel === 'BUG_REPORT_ACTION') return { status: 'opened' };
    return null;
  });
  Object.defineProperty(window, 'ipcRenderer', {
    configurable: true,
    value: { invoke, on: vi.fn(() => () => {}) },
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it('prepares nothing until requested, reviews scoped diagnostics and opens a draft', async () => {
  await act(async () =>
    root.render(<ReportProblemButton area="project_updates" entityId="p1" />),
  );
  expect(invoke).not.toHaveBeenCalled();
  await click('Report a problem');
  expect(invoke).toHaveBeenCalledWith('BUG_REPORT_PREPARE', {
    area: 'project_updates',
    entityId: 'p1',
  });
  expect(document.querySelector('dialog')?.open).toBe(true);
  expect(document.body.textContent).toContain('GitHub issues are public');
  expect(document.body.textContent).toContain('errorCode: timeout');
  const description = document.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  await act(async () => {
    setter.call(description, 'Clicked Prepare updates twice');
    description.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Open GitHub issue');
  expect(invoke).toHaveBeenCalledWith('BUG_REPORT_ACTION', {
    id: 'report-1',
    action: 'github',
    description: 'Clicked Prepare updates twice',
  });
  expect(document.body.textContent).toContain(
    'Draft opened. Review and send it there.',
  );
  expect(document.body.textContent).not.toContain('Report sent');
  await act(async () =>
    document
      .querySelector('dialog')!
      .dispatchEvent(new Event('cancel', { cancelable: true })),
  );
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.activeElement?.textContent).toBe('Report a problem');
});

it('explains oversized email handoff and recovers from action failure with copy', async () => {
  await act(async () => root.render(<ReportProblemButton />));
  await click('Report a problem');
  invoke.mockResolvedValueOnce({ status: 'opened_with_copy' });
  await click('Email support');
  expect(document.body.textContent).toContain('Paste it into the draft');
  invoke.mockRejectedValueOnce(new Error('no mail client'));
  await click('Email support');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Try copying or saving',
  );
  invoke.mockResolvedValueOnce({ status: 'copied' });
  await click('Copy report');
  expect(document.body.textContent).toContain('Report copied.');
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it('keeps actions disabled when diagnostics cannot be prepared', async () => {
  invoke.mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => root.render(<ReportProblemButton />));
  await click('Report a problem');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Couldn’t prepare diagnostics',
  );
  expect(
    Array.from(document.querySelectorAll('dialog button')).filter(
      (button) => button.disabled,
    ),
  ).toHaveLength(4);
});

it('makes reporting discoverable in Settings Help', async () => {
  await act(async () =>
    root.render(
      <SettingsTab
        initialTab="help"
        llmProvider="ollama"
        setLlmProvider={vi.fn()}
        ollamaModel=""
        setOllamaModel={vi.fn()}
        autoEndEnabled
        setAutoEndEnabled={vi.fn()}
        fetchMeetings={vi.fn()}
        setSelectedMeetingId={vi.fn()}
        theme="system"
        setTheme={vi.fn()}
      />,
    ),
  );
  expect(
    document.querySelector('#settings-tab-help')?.getAttribute('aria-selected'),
  ).toBe('true');
  expect(document.querySelector('#settings-panel-help')?.textContent).toContain(
    'Report a problem',
  );
  await click('Report a problem');
  expect(invoke).toHaveBeenCalledWith('BUG_REPORT_PREPARE', {
    area: 'general',
    entityId: undefined,
  });
});
