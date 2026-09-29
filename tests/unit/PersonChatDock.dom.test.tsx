// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  archivePersonChatThread: vi.fn(),
  cancelPersonChatRequest: vi.fn(),
  createPersonChatThread: vi.fn(),
  deletePersonChatThread: vi.fn(),
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
  let ipcListeners: Map<string, (...args: unknown[]) => void>;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcListeners = new Map();
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
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
    api.deletePersonChatThread.mockResolvedValue({ deleted: true });
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
        on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
          ipcListeners.set(channel, listener);
          return () => ipcListeners.delete(channel);
        }),
        off: vi.fn(),
        invoke: vi.fn(),
        send: vi.fn(),
      },
    });
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('opens from the fixed launcher and persists a sourced response', async () => {
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

    expect(document.querySelector('textarea')).toBeNull();
    const launcher = document.querySelector(
      'button[aria-label="Ask about Maya"]',
    ) as HTMLButtonElement;
    await act(async () => launcher.click());
    expect(document.querySelector('textarea')).not.toBeNull();
    expect(document.body.textContent).toContain(
      'What would you like to think through?',
    );
    const starter = [...document.querySelectorAll('button')].find(
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
    expect(document.body.textContent).toContain('Start with the shared goal.');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(document.body.textContent).toContain('1 source');
    expect(document.body.textContent).not.toContain('Your conversations');
    expect(
      document.querySelector('.person-chat__assistant-mark'),
    ).not.toBeNull();

    const summary = [...document.querySelectorAll('summary')].find((item) =>
      item.textContent?.includes('1 source'),
    ) as HTMLElement;
    summary.click();
    const source = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Weekly sync'),
    ) as HTMLButtonElement;
    source.click();
    expect(onOpenMeeting).toHaveBeenCalledWith('meeting-1');
  });

  it('keeps the reading position stable while a person-chat answer streams', async () => {
    let resolveAnswer!: (
      value: Awaited<ReturnType<typeof api.sendPersonChatMessage>>,
    ) => void;
    api.sendPersonChatMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAnswer = resolve;
        }),
    );

    await act(async () => {
      root.render(
        <PersonChatDock
          personId="person-alpha"
          personName="Colleague"
          onOpenMeeting={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    const launcher = document.querySelector(
      'button[aria-label="Ask about Colleague"]',
    ) as HTMLButtonElement;
    await act(async () => launcher.click());
    const starter = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Catch me up on Colleague',
    ) as HTMLButtonElement;
    await act(async () => {
      starter.click();
      await Promise.resolve();
    });

    const requestId = api.sendPersonChatMessage.mock.calls[0]?.[0]
      ?.requestId as string;
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    await act(async () => {
      ipcListeners.get('intelligence:person-chat:delta')?.(
        {},
        {
          requestId,
          delta: 'A useful first point.',
        },
      );
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('A useful first point.');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAnswer({
        status: 'answered',
        message: {
          id: 'assistant-final',
          threadId: 'thread-1',
          role: 'assistant',
          content: 'A useful first point, with context.',
          status: 'complete',
          createdAt: '2026-09-13T12:01:00Z',
          citations: [],
        },
      });
      await Promise.resolve();
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('uses a hamburger sidebar menu to show past conversations and a header plus button for new threads', async () => {
    api.listPersonChatThreads.mockResolvedValue([
      {
        id: 'thread-current',
        personId: 'maya',
        title: 'Current priorities',
        createdAt: '2026-09-13T12:00:00Z',
        updatedAt: '2026-09-13T12:00:00Z',
        archivedAt: null,
      },
      {
        id: 'thread-archived',
        personId: 'maya',
        title: 'Launch history',
        createdAt: '2026-09-10T12:00:00Z',
        updatedAt: '2026-09-10T12:00:00Z',
        archivedAt: '2026-09-11T12:00:00Z',
      },
    ]);

    await act(async () => {
      root.render(
        <PersonChatDock
          personId="maya"
          personName="Maya"
          onOpenMeeting={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    const launcher = document.querySelector(
      'button[aria-label="Ask about Maya"]',
    ) as HTMLButtonElement;
    await act(async () => launcher.click());

    // 1. Dropdown picker is not rendered
    expect(document.querySelector('.person-chat__thread-picker')).toBeNull();

    // 2. Header has hamburger button and new conversation plus button next to archive
    const hamburger = document.querySelector(
      'button[aria-label="Past conversations"]',
    ) as HTMLButtonElement;
    expect(hamburger).not.toBeNull();
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');

    const newConversationHeaderBtn = document.querySelector(
      'button[aria-label="New conversation"]',
    ) as HTMLButtonElement;
    expect(newConversationHeaderBtn).not.toBeNull();

    const archiveBtn = document.querySelector(
      'button[aria-label="Archive chat"]',
    ) as HTMLButtonElement;
    expect(archiveBtn).not.toBeNull();
    expect(newConversationHeaderBtn.nextElementSibling).toBe(archiveBtn);

    // 3. Sidebar is initially hidden
    expect(document.querySelector('.person-chat__sidebar')).toBeNull();

    // 4. Click hamburger to toggle sidebar open
    await act(async () => hamburger.click());
    expect(hamburger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.person-chat__sidebar')).not.toBeNull();
    expect(document.body.textContent).toContain('Past conversations');
    expect(document.body.textContent).toContain('New conversation');
    expect(document.body.textContent).toContain('Recent conversations');
    expect(document.body.textContent).toContain('Current priorities');
    expect(document.body.textContent).toContain('Launch history');
    expect(document.body.textContent).toContain('Archived');

    // 5. Escape key dismisses sidebar
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(document.querySelector('.person-chat__sidebar')).toBeNull();
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');

    // 6. Reopen sidebar and click a past conversation
    await act(async () => hamburger.click());
    expect(document.querySelector('.person-chat__sidebar')).not.toBeNull();

    const archivedThread = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Launch history'),
    ) as HTMLButtonElement;
    await act(async () => {
      archivedThread.click();
      await Promise.resolve();
    });

    expect(api.listPersonChatMessages).toHaveBeenCalledWith(
      'maya',
      'thread-archived',
    );
    expect(document.querySelector('.person-chat__sidebar')).toBeNull();

    expect(document.querySelector('textarea')).toBeNull();
    expect(document.body.textContent).toContain(
      'This conversation is archived. Resume it to ask more questions.',
    );

    await act(async () => hamburger.click());
    api.listPersonChatThreads.mockResolvedValueOnce([
      {
        id: 'thread-current',
        personId: 'maya',
        title: 'Current priorities',
        createdAt: '2026-09-13T12:00:00Z',
        updatedAt: '2026-09-13T12:00:00Z',
        archivedAt: null,
      },
    ]);
    const deleteArchived = document.querySelector(
      'button[aria-label="Delete conversation: Launch history"]',
    ) as HTMLButtonElement;
    await act(async () => {
      deleteArchived.click();
      await Promise.resolve();
    });
    expect(api.deletePersonChatThread).toHaveBeenCalledWith(
      'maya',
      'thread-archived',
    );
    expect(window.confirm).toHaveBeenCalled();

    // 7. Click header plus button to start a fresh thread
    await act(async () => newConversationHeaderBtn.click());
    expect(
      document.querySelector('button[aria-label="Archive chat"]'),
    ).toBeNull();
  });
});
