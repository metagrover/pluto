// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/components/AudioManager', () => ({
  AudioManager: () => null,
}));

vi.mock('../../src/components/features/Dashboard', () => ({
  Dashboard: () => <div data-testid="dashboard" />,
}));

vi.mock('../../src/components/features/MeetingView', () => ({
  MeetingView: ({
    selectedMeeting,
    onBack,
    backLabel,
    onOpenPerson,
  }: {
    selectedMeeting?: { id: string; title: string };
    onBack?: () => void;
    backLabel?: string;
    onOpenPerson?: (id: string) => void;
  }) => (
    <div data-testid="meeting-view">
      <div data-testid="meeting-title">{selectedMeeting?.title}</div>
      {onBack && (
        <button type="button" data-testid="meeting-back" onClick={onBack}>
          {backLabel || 'Back'}
        </button>
      )}
      {onOpenPerson && (
        <button
          type="button"
          data-testid="meeting-open-person"
          onClick={() => onOpenPerson('person-avery')}
        >
          Open Avery
        </button>
      )}
    </div>
  ),
}));

vi.mock('../../src/components/KnowledgeGraph/PeopleTab', () => ({
  PeopleTab: ({
    selectedPersonId,
    onOpenMeeting,
    onBack,
    backLabel,
  }: {
    selectedPersonId?: string | null;
    onOpenMeeting?: (
      id: string,
      context?: { id?: string; name?: string },
    ) => void;
    onBack?: () => void;
    backLabel?: string;
  }) => (
    <div data-testid="people-tab">
      <div data-testid="selected-person-id">{selectedPersonId}</div>
      {onBack && (
        <button type="button" data-testid="people-back" onClick={onBack}>
          {backLabel || 'Back'}
        </button>
      )}
      <button
        type="button"
        data-testid="people-open-meeting"
        onClick={() =>
          onOpenMeeting?.('meeting-1', {
            id: 'person-avery',
            name: 'Avery Chen',
          })
        }
      >
        Open Sync
      </button>
    </div>
  ),
}));

const flush = async () => {
  for (let i = 0; i < 15; i += 1) await Promise.resolve();
};

describe('App Navigation History', () => {
  let openSettingsFromMenu: (() => void) | undefined;
  let reportProblemFromMenu: (() => void) | undefined;
  const meeting = {
    id: 'meeting-1',
    title: 'Weekly Sync',
    created_at: '2026-09-01T00:00:00Z',
    transcript_status: 'validated',
    enhanced_notes: 'Sync notes',
  };

  beforeEach(() => {
    openSettingsFromMenu = undefined;
    reportProblemFromMenu = undefined;
    window.__PLUTO_BROWSER_PREVIEW__ = false;
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
          if (channel === 'GET_SETTING') return 'true';
          if (channel === 'GET_MEETINGS') return [meeting];
          if (channel === 'GET_MEETING') return meeting;
          if (channel === 'GET_MEETING_STATUS') return meeting;
          if (channel === 'CALENDAR_GET_STATE') return { enabled: false };
          if (channel === 'BOOT_PROBE_STATUS') return true;
          if (channel === 'DETECT_ACTIVE_CALL') return { active: false };
          if (channel === 'RECORDING_READINESS_STATUS') {
            return {
              details: {
                parakeetClient: true,
                parakeetModel: true,
                parakeetEouReady: true,
                audiocapExists: true,
                audiocapExecutable: true,
              },
            };
          }
          return null;
        }),
        send: vi.fn(),
        off: vi.fn(),
        on: vi.fn((channel: string, listener: () => void) => {
          if (channel === 'PLUTO_NATIVE_MENU_OPEN_SETTINGS') {
            openSettingsFromMenu = listener;
          }
          if (channel === 'PLUTO_NATIVE_MENU_REPORT_PROBLEM') {
            reportProblemFromMenu = listener;
          }
          return () => {};
        }),
      },
    });
  });

  it.each([900, 1200])(
    'can restore the sidebar with a visible control at %i pixels',
    async (width) => {
      const originalWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width,
      });
      const { default: App } = await import('../../src/App');
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(<App />);
          await flush();
        });
        const toggle = container.querySelector(
          '[aria-controls="app-sidebar"]',
        ) as HTMLButtonElement;
        const sidebar = container.querySelector('#app-sidebar')!;
        expect(toggle.getAttribute('aria-expanded')).toBe(
          String(width >= 1024),
        );
        if (width >= 1024) {
          await act(async () => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'b', metaKey: true }),
            );
          });
        }
        expect(toggle.getAttribute('aria-label')).toBe('Show sidebar');
        expect(sidebar.className).toContain('-translate-x-full');
        const newMeeting = Array.from(
          container.querySelectorAll('main button'),
        ).find(
          (button) => button.textContent?.trim() === 'New meeting',
        ) as HTMLButtonElement;
        expect(newMeeting).toBeTruthy();
        expect(newMeeting.disabled).toBe(false);
        expect(container.querySelector('main')?.textContent).not.toContain(
          'Local · Ollama',
        );
        expect(toggle.className).toContain('no-drag');
        expect(toggle.closest('[aria-hidden="true"]')).toBeNull();
        expect(toggle.closest('main')).not.toBeNull();
        expect(sidebar.contains(toggle)).toBe(false);
        expect(toggle.textContent).toBe('');
        await act(async () => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(sidebar.className).not.toContain('-translate-x-full');
        await act(async () => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        await act(async () => toggle.click());
        expect(toggle.getAttribute('aria-label')).toBe('Hide sidebar');
        await act(async () => {
          container
            .querySelector('main')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(toggle.getAttribute('aria-label')).toBe('Hide sidebar');
        const backdrop = container.querySelector('.lg\\:hidden.bg-black\\/20')!;
        await act(async () => {
          backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const close = container.querySelector(
          '[aria-label="Close sidebar"]',
        ) as HTMLButtonElement;
        await act(async () => close.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(
          container.querySelector('[data-testid="dashboard"]'),
        ).not.toBeNull();
      } finally {
        act(() => root.unmount());
        container.remove();
        Object.defineProperty(window, 'innerWidth', {
          configurable: true,
          value: originalWidth,
        });
      }
    },
  );

  it('opens the shared report dialog from native Help', async () => {
    const showModal = vi
      .spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.open = true;
      });
    const close = vi
      .spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.open = false;
      });
    const { default: App } = await import('../../src/App');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<App />);
        await flush();
      });
      await act(async () => {
        reportProblemFromMenu?.();
        await flush();
      });
      expect(document.querySelector('dialog[open]')).not.toBeNull();
      expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
        'BUG_REPORT_PREPARE',
        {
          area: 'general',
          entityId: undefined,
        },
      );
      expect(document.body.textContent).toContain('Email support');
      await act(async () => {
        (
          document.querySelector(
            '[aria-label="Close report"]',
          ) as HTMLButtonElement
        ).click();
      });
      expect(document.querySelector('dialog')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
      showModal.mockRestore();
      close.mockRestore();
    }
  });

  it('opens Settings from the native menu while a meeting is selected', async () => {
    const { default: App } = await import('../../src/App');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<App />);
        await flush();
      });
      expect(window.ipcRenderer.send).toHaveBeenCalledWith(
        'PLUTO_NATIVE_MENU_RENDERER_READY',
      );
      const meetingButton = Array.from(
        container.querySelectorAll('button'),
      ).find((button) => button.textContent?.includes('Weekly Sync'));
      await act(async () => {
        meetingButton?.click();
        await flush();
      });
      expect(
        container.querySelector('[data-testid="meeting-view"]'),
      ).not.toBeNull();

      await act(async () => {
        openSettingsFromMenu?.();
        await flush();
      });
      expect(
        container.querySelector('[data-testid="meeting-view"]'),
      ).toBeNull();
      expect(container.textContent).toContain('Personal');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('navigates from person dossier to meeting and preserves back navigation to that person', async () => {
    const { default: App } = await import('../../src/App');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<App />);
        await flush();
      });

      // Navigate to People tab via sidebar
      const peopleTabButton = Array.from(
        container.querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('People'));
      expect(peopleTabButton).toBeDefined();

      await act(async () => {
        peopleTabButton?.click();
        await flush();
      });

      expect(
        container.querySelector('[data-testid="people-tab"]'),
      ).not.toBeNull();

      // Open meeting from person
      const openMeetingBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="people-open-meeting"]',
      );
      expect(openMeetingBtn).not.toBeNull();

      await act(async () => {
        openMeetingBtn?.click();
        await flush();
      });

      // Now in MeetingView
      expect(
        container.querySelector('[data-testid="meeting-view"]'),
      ).not.toBeNull();
      const meetingBack = container.querySelector<HTMLButtonElement>(
        '[data-testid="meeting-back"]',
      );
      expect(meetingBack).not.toBeNull();
      expect(meetingBack?.textContent).toContain('Avery Chen');

      // Click back to return to Avery
      await act(async () => {
        meetingBack?.click();
        await flush();
      });

      // Should be back on People tab with Avery selected
      expect(
        container.querySelector('[data-testid="people-tab"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-testid="meeting-view"]'),
      ).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('navigates from meeting to person and preserves back navigation to that meeting', async () => {
    const { default: App } = await import('../../src/App');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<App />);
        await flush();
      });

      // Click Weekly Sync directly from sidebar recent meetings
      const meetingButton = Array.from(
        container.querySelectorAll('button'),
      ).find((b) => b.textContent?.includes('Weekly Sync'));
      expect(meetingButton).toBeDefined();

      await act(async () => {
        meetingButton?.click();
        await flush();
      });

      // Now in MeetingView
      expect(
        container.querySelector('[data-testid="meeting-view"]'),
      ).not.toBeNull();

      // Open person profile from meeting
      const openPersonBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="meeting-open-person"]',
      );
      expect(openPersonBtn).not.toBeNull();

      await act(async () => {
        openPersonBtn?.click();
        await flush();
      });

      // Should now be on People tab
      expect(
        container.querySelector('[data-testid="people-tab"]'),
      ).not.toBeNull();
      const peopleBack = container.querySelector<HTMLButtonElement>(
        '[data-testid="people-back"]',
      );
      expect(peopleBack).not.toBeNull();
      expect(peopleBack?.textContent).toContain('Weekly Sync');

      // Click back to return to the meeting
      await act(async () => {
        peopleBack?.click();
        await flush();
      });

      // Should be back in MeetingView
      expect(
        container.querySelector('[data-testid="meeting-view"]'),
      ).not.toBeNull();
      expect(container.querySelector('[data-testid="people-tab"]')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
