import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  bridge: undefined as
    | {
        memoryPressureSample?: () => {
          wallTimeMs: number;
          memoryPressureFreePercent: number;
        };
      }
    | undefined,
}));
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    setName: vi.fn(),
    setPath: vi.fn(),
    requestSingleInstanceLock: () => true,
    on: vi.fn(),
    whenReady: () => new Promise(() => {}),
    quit: vi.fn(),
  },
  dialog: {},
  shell: {},
}));
vi.mock('../../electron/appRuntimePolicy', () => ({
  PLUTO_BUNDLE_IDENTIFIER: 'test.pluto',
  PLUTO_DEVELOPMENT_PRODUCT_NAME: 'Test',
  PLUTO_PRODUCT_NAME: 'Test',
  canOpenProductionDatabase: () => true,
  resolveProductionUserDataDir: () => undefined,
  resolveSourceUserDataDir: () => undefined,
  resolveUserDataArgument: () => undefined,
}));
vi.mock('../../electron/commitmentReminderNotifications', () => ({
  initializeCommitmentNotificationBridge: () => state.bridge,
}));
vi.mock('../../electron/crypto/applicationKeyStore', () => ({
  ApplicationKeyStore: class {},
}));
vi.mock('../../electron/database/applicationDatabase', () => ({
  initializeApplicationDatabase: vi.fn(),
  resolveApplicationDatabasePath: vi.fn(),
}));
vi.mock('../../electron/database/storageSetup', () => ({
  initializeDatabaseStorageSetup: vi.fn(),
}));
vi.mock('../../electron/encryptionRollout', () => ({
  probeSignedMacBuild: vi.fn(),
}));
vi.mock('../../electron/logger', () => ({
  createLogger: () => ({ warn: vi.fn() }),
  initializeElectronLogging: vi.fn(),
}));
const originalExceptionListeners = new Set(
  process.listeners('uncaughtException'),
);
afterEach(() => {
  for (const listener of process.listeners('uncaughtException'))
    if (!originalExceptionListeners.has(listener))
      process.removeListener('uncaughtException', listener);
  vi.restoreAllMocks();
  vi.resetModules();
});
it('wires the already initialized native export with its receiver before startup inference', async () => {
  state.bridge = {
    memoryPressureSample() {
      expect(this).toBe(state.bridge);
      return { wallTimeMs: Date.now(), memoryPressureFreePercent: 50 };
    },
  };
  await import('../../electron/bootstrap');
  const { createLocalModelMemoryProbe } = await import(
    '../../electron/llm/localModelMemoryProbe'
  );
  const failure = vi.fn();
  const probe = createLocalModelMemoryProbe(failure);
  await probe.start();
  expect(probe.read()).toBe(50);
  expect(failure).not.toHaveBeenCalled();
  await probe.dispose();
});
it.each([undefined, {}])(
  'leaves missing or stale addons unavailable for local inference',
  async (bridge) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.bridge = bridge;
    await import('../../electron/bootstrap');
    const { createLocalModelMemoryProbe } = await import(
      '../../electron/llm/localModelMemoryProbe'
    );
    const failure = vi.fn();
    const probe = createLocalModelMemoryProbe(failure);
    await expect(probe.start()).rejects.toThrow('sample unavailable');
    expect(failure).toHaveBeenCalledOnce();
    await probe.dispose();
  },
);
