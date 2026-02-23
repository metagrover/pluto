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
    expect(result.appName).toBe('Chrome');
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
      ],
      runAudioProbe,
      browserProviders: new Map(),
    });

    const result = await detector();

    expect(result.active).toBe(true);
    expect(result.appName).toBe('Zoom');
    expect(result.confidence).toBe('high');
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
    expect(result.appName).toBe('Chrome');
    expect(result.confidence).toBe('medium');
    expect(result.reason).toBe('browser-call-tab-open-silent-fallback');
    expect(runAudioProbe).toHaveBeenCalledTimes(2);
  });
});
