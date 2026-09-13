// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  archivePersonChatThread: vi.fn(),
  cancelPersonChatRequest: vi.fn(),
  createPersonChatThread: vi.fn(),
  getPersonChatCapability: vi.fn(),
  listPersonChatMessages: vi.fn(),
  listPersonChatThreads: vi.fn(),
  resumePersonChatThread: vi.fn(),
  sendPersonChatMessage: vi.fn(),
}));

vi.mock('../../src/api/personChat', () => api);

import { PersonChatDock } from '../../src/components/features/PersonChatDock';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PersonChatDock', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    api.getPersonChatCapability.mockResolvedValue({ enabled: true });
    api.listPersonChatThreads.mockResolvedValue([]);
    api.listPersonChatMessages.mockResolvedValue([]);
    api.createPersonChatThread.mockResolvedValue({
      id: 'thread-1',
      personId: 'maya',
      title: 'New conversation',
      createdAt: '2026-09-13T12:00:00Z',
      updatedAt: '2026-09-13T12:00:00Z',
      archivedAt: null,
    });
    api.sendPersonChatMessage.mockResolvedValue({
      status: 'answered',
      message: {
        id: 'assistant-1',
        threadId: 'thread-1',
        role: 'assistant',
        content: 'Start with the shared goal.',
        status: 'complete',
        createdAt: '2026-09-13T12:01:00Z',
        citations: [
          {
            id: 'meeting:meeting-1',
            type: 'meeting',
            meetingId: 'meeting-1',
            title: 'Weekly sync',
            date: '2026-09-12T10:00:00Z',
            evidenceClass: 'confirmed',
            excerpt: 'Discussed the shared goal.',
            answerUsage: 'used_during_generation',
          },
        ],
      },
    });
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        on: vi.fn(() => () => {}),
        off: vi.fn(),
        invoke: vi.fn(),
        send: vi.fn(),
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('opens from a floating launcher and persists a sourced response', async () => {
    const onOpenMeeting = vi.fn();
    await act(async () => {
      root.render(
        <PersonChatDock
          personId="maya"
          personName="Maya"
          onOpenMeeting={onOpenMeeting}
        />,
      );
      await Promise.resolve();
    });

    expect(host.querySelector('textarea')).toBeNull();
    const launcher = host.querySelector(
      'button[aria-label="Open chat about Maya"]',
    ) as HTMLButtonElement;
    await act(async () => launcher.click());
    expect(host.querySelector('textarea')).not.toBeNull();
    expect(host.textContent).toContain('What would you like to think through?');
    const starter = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Catch me up on Maya',
    ) as HTMLButtonElement;
    await act(async () => {
      starter.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.createPersonChatThread).toHaveBeenCalledWith('maya');
    expect(api.sendPersonChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'maya',
        threadId: 'thread-1',
        query: 'Catch me up on Maya',
      }),
    );
    expect(host.textContent).toContain('Start with the shared goal.');
    expect(host.textContent).toContain('Your conversations · 1');

    const summary = [...host.querySelectorAll('summary')].find((item) =>
      item.textContent?.includes('Your conversations'),
    ) as HTMLElement;
    summary.click();
    const source = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Weekly sync'),
    ) as HTMLButtonElement;
    source.click();
    expect(onOpenMeeting).toHaveBeenCalledWith('meeting-1');
  });
});
