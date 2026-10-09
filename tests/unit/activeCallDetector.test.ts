import { afterEach, describe, expect, it, vi } from 'vitest';

import { createActiveCallDetector } from '../../electron/activeCall/detector';

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  process,
  'platform',
);

const setPlatform = (value: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', { value });
};

type StubProcess = {
  pid: number;
  ppid: number;
  name: string;
  command: string;
};

const createDetector = ({
  processes,
  runAudioProbe,
  browserProviders,
}: {
  processes: StubProcess[];
  runAudioProbe: ReturnType<typeof vi.fn>;
  browserProviders?: Map<string, 'google-meet' | 'zoom' | 'teams' | 'slack'>;
}) => {
  return createActiveCallDetector({
    browserInspectionEnabled: () => true,
    runAudioProbe,
    getRunningProcesses: async () => processes,
    detectBrowserCallProviders: async () => browserProviders ?? new Map(),
  });
};

afterEach(() => {
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
});

describe('createActiveCallDetector', () => {
  it('does not inspect browser tabs or request Automation access without opt-in', async () => {
    setPlatform('darwin');
    const inspect = vi.fn(async () => new Map());
    const detector = createActiveCallDetector({
      runAudioProbe: vi.fn(async () => true),
      getRunningProcesses: async () => [
        {
          pid: 101,
          ppid: 1,
          name: 'google chrome',
          command:
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        },
      ],
      detectBrowserCallProviders: inspect,
    });
    expect(await detector()).toMatchObject({
      active: false,
      reason: 'browser-tab-inspection-unavailable',
    });
    expect(inspect).not.toHaveBeenCalled();
  });
  it('ignores browser-only audio when no supported meeting tab is detected', async () => {
    setPlatform('darwin');
    const runAudioProbe = vi.fn(async () => true);
    const detector = createDetector({
      processes: [
        {
          pid: 101,
          ppid: 1,
          name: 'google chrome',
          command:
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        },
      ],
      runAudioProbe,
      browserProviders: new Map(),
    });

    const result = await detector();

    expect(result.active).toBe(false);
    expect(result.appName).toBe('Chrome');
    expect(result.confidence).toBe('low');
    expect(result.reason).toBe('browser-call-tab-closed');
    expect(runAudioProbe).not.toHaveBeenCalled();
  });

  it('marks browser calls active when a supported meeting tab and audio are both present', async () => {
    setPlatform('darwin');
    const runAudioProbe = vi.fn(
      async ({ allowSilent }: { allowSilent?: boolean }) => !allowSilent,
    );
    const detector = createDetector({
      processes: [
        {
          pid: 201,
          ppid: 1,
          name: 'google chrome',
          command:
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        },
      ],
      runAudioProbe,
      browserProviders: new Map([['Google Chrome', 'google-meet']]),
    });

    const result = await detector();

    expect(result.active).toBe(true);
    expect(result.appName).toBe('Google Meet');
    expect(result.confidence).toBe('high');
    expect(result.reason).toBe('call-app-running-with-active-audio');
  });

  it('still detects desktop Zoom calls by process + audio', async () => {
    setPlatform('darwin');
    const runAudioProbe = vi.fn(async () => true);
    const detector = createDetector({
      processes: [
        {
          pid: 301,
          ppid: 1,
          name: 'zoom.us',
          command: '/Applications/zoom.us.app/Contents/MacOS/zoom.us',
        },
        {
          pid: 302,
          ppid: 301,
          name: 'cpthost',
          command:
            '/Applications/zoom.us.app/Contents/Frameworks/CptHost.app/Contents/MacOS/CptHost',
        },
      ],
      runAudioProbe,
      browserProviders: new Map(),
    });

    const result = await detector();

    expect(result.active).toBe(true);
    expect(result.appName).toBe('Zoom');
    expect(result.confidence).toBe('high');
  });

  it('reports silent attached Zoom as medium-confidence fallback', async () => {
    setPlatform('darwin');
    const runAudioProbe = vi.fn(
      async ({ allowSilent }: { allowSilent?: boolean }) =>
        Boolean(allowSilent),
    );
    const detector = createDetector({
      processes: [
        {
          pid: 303,
          ppid: 1,
          name: 'zoom.us',
          command: '/Applications/zoom.us.app/Contents/MacOS/zoom.us',
        },
        {
          pid: 304,
          ppid: 303,
          name: 'cpthost',
          command:
            '/Applications/zoom.us.app/Contents/Frameworks/CptHost.app/Contents/MacOS/CptHost',
        },
      ],
      runAudioProbe,
      browserProviders: new Map(),
    });

    const result = await detector();

    expect(result.active).toBe(true);
    expect(result.appName).toBe('Zoom');
    expect(result.confidence).toBe('medium');
    expect(result.reason).toBe('call-app-running-silent-fallback');
  });

  it('rejects idle Zoom when only its persistent generic audio host remains', async () => {
    setPlatform('darwin');
    const runAudioProbe = vi.fn(async () => true);
    const detector = createDetector({
      processes: [
        {
          pid: 305,
          ppid: 1,
          name: 'zoom.us',
          command: '/Applications/zoom.us.app/Contents/MacOS/zoom.us',
        },
        {
          pid: 306,
          ppid: 305,
          name: 'caphost',
          command:
            '/Applications/zoom.us.app/Contents/Frameworks/caphost.app/Contents/MacOS/caphost',
        },
      ],
      runAudioProbe,
      browserProviders: new Map(),
    });

    const result = await detector();

    expect(result.active).toBe(false);
    expect(result.reason).toBe('no-call-app-running');
    expect(runAudioProbe).not.toHaveBeenCalled();
  });

  it('falls back to medium confidence for supported browser calls when audio probe is silent', async () => {
    setPlatform('darwin');
    const runAudioProbe = vi.fn(
      async ({ allowSilent }: { allowSilent?: boolean }) =>
        Boolean(allowSilent),
    );
    const detector = createDetector({
      processes: [
        {
          pid: 401,
          ppid: 1,
          name: 'google chrome',
          command:
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        },
      ],
      runAudioProbe,
      browserProviders: new Map([['Google Chrome', 'google-meet']]),
    });

    const result = await detector();

    expect(result.active).toBe(true);
    expect(result.appName).toBe('Google Meet');
    expect(result.confidence).toBe('medium');
    expect(result.reason).toBe('browser-call-tab-open-silent-fallback');
    expect(runAudioProbe).toHaveBeenCalledTimes(2);
  });

  it.each(['desktop', 'browser'])(
    'does not report a closed tab when a silent %s meeting is still open',
    async (kind) => {
      setPlatform('darwin');
      const detector = createDetector({
        processes: [
          {
            pid: 601,
            ppid: 1,
            name: 'google chrome',
            command:
              '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          },
          kind === 'desktop'
            ? {
                pid: 602,
                ppid: 1,
                name: 'Microsoft Teams',
                command:
                  '/Applications/Microsoft Teams.app/Contents/MacOS/Microsoft Teams',
              }
            : {
                pid: 602,
                ppid: 1,
                name: 'Safari',
                command: '/Applications/Safari.app/Contents/MacOS/Safari',
              },
        ],
        runAudioProbe: vi.fn(async () => false),
        browserProviders:
          kind === 'browser' ? new Map([['Safari', 'google-meet']]) : new Map(),
      });
      expect(await detector()).toMatchObject({
        active: false,
        reason: 'call-app-running-without-target-audio',
      });
    },
  );

  it.each(['Microsoft Teams', 'Slack', 'Zoom', 'Safari'])(
    'detects the tracked Chrome tab closing while %s remains open',
    async (otherApp) => {
      setPlatform('darwin');
      const providers = new Map<string, 'google-meet'>([
        ['Google Chrome', 'google-meet'],
      ]);
      const processes: StubProcess[] = [
        { pid: 701, ppid: 1, name: 'google chrome', command: 'google chrome' },
        { pid: 702, ppid: 1, name: otherApp, command: otherApp },
        { pid: 703, ppid: 702, name: 'cpthost', command: 'cpthost' },
      ];
      const probe = vi.fn(async () => true);
      const detector = createDetector({
        processes,
        runAudioProbe: probe,
        browserProviders: providers,
      });
      const joined = await detector();
      expect(joined).toMatchObject({
        active: true,
        appName: 'Google Meet',
        sourceApp: 'Google Chrome',
      });
      providers.delete('Google Chrome');
      if (otherApp === 'Safari') providers.set('Safari', 'google-meet');
      probe.mockClear();
      expect(await detector(joined.sourceApp)).toMatchObject({
        active: false,
        reason: 'browser-call-tab-closed',
      });
      expect(probe).not.toHaveBeenCalled();
    },
  );

  it.each(['Google Chrome', 'Zoom'])(
    'detects the tracked %s process exiting despite another active app',
    async (sourceApp) => {
      setPlatform('darwin');
      const detector = createDetector({
        processes: [
          {
            pid: 801,
            ppid: 1,
            name: 'Microsoft Teams',
            command: 'Microsoft Teams',
          },
        ],
        runAudioProbe: vi.fn(async () => true),
      });
      expect(await detector(sourceApp)).toMatchObject({
        active: false,
        reason: 'no-call-app-running',
      });
    },
  );

  it('keeps a silent tracked Chrome meeting open despite another browser closing', async () => {
    setPlatform('darwin');
    const detector = createDetector({
      processes: [
        { pid: 901, ppid: 1, name: 'google chrome', command: 'google chrome' },
        { pid: 902, ppid: 1, name: 'Safari', command: 'Safari' },
      ],
      runAudioProbe: vi.fn(async () => false),
      browserProviders: new Map([['Google Chrome', 'google-meet']]),
    });
    expect(await detector('Google Chrome')).toMatchObject({
      active: false,
      reason: 'call-app-running-without-target-audio',
    });
  });

  it('treats a failed process inspection as unknown instead of call exit', async () => {
    setPlatform('darwin');
    const detector = createActiveCallDetector({
      getRunningProcesses: async () => null,
      runAudioProbe: vi.fn(async () => false),
    });
    expect(await detector('Zoom')).toMatchObject({
      active: false,
      reason: 'process-inspection-unavailable',
    });
  });

  it.each(['Google Meet', '', {}, 12])(
    'rejects invalid call source %j without inspecting apps',
    async (sourceApp) => {
      setPlatform('darwin');
      const processes = vi.fn(async () => []);
      const detector = createActiveCallDetector({
        getRunningProcesses: processes,
        runAudioProbe: vi.fn(),
      });
      expect(await detector(sourceApp)).toMatchObject({
        active: false,
        reason: 'invalid-call-source',
      });
      expect(processes).not.toHaveBeenCalled();
    },
  );

  it('reports when browser meeting-tab inspection is unavailable', async () => {
    setPlatform('darwin');
    const runAudioProbe = vi.fn(async () => true);
    const detector = createActiveCallDetector({
      browserInspectionEnabled: () => true,
      runAudioProbe,
      getRunningProcesses: async () => [
        {
          pid: 501,
          ppid: 1,
          name: 'google chrome',
          command:
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        },
      ],
      detectBrowserCallProviders: async () => ({
        providerByLabel: new Map(),
        inspectionFailures: new Set(['Google Chrome']),
      }),
    });

    const result = await detector('Google Chrome');

    expect(result.active).toBe(false);
    expect(result.reason).toBe('browser-tab-inspection-unavailable');
    expect(runAudioProbe).not.toHaveBeenCalled();
  });
});
