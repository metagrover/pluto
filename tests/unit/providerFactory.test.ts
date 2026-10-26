import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ available: vi.fn() }));
vi.mock('../../electron/llm/unifiedProvider', () => ({
  UnifiedLLMProvider: class {
    isAvailable = mocks.available;
  },
}));
import { bugReportErrorCode } from '../../electron/bugReports';
import {
  getAllSettings,
  getProvider,
  invalidateProviderCache,
  invalidateSettingsCache,
} from '../../electron/llm/factory';

beforeEach(() => {
  invalidateProviderCache();
  mocks.available.mockReset();
});
describe('provider recovery', () => {
  it('reports an unavailable local provider with a safe diagnostic code and retries after restart', async () => {
    mocks.available.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const settings = {
      llm_provider: 'ollama' as const,
      ollama_model: 'fixture',
    };
    const error = await getProvider(settings).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(bugReportErrorCode(error)).toBe('provider_unavailable');
    await expect(getProvider(settings)).resolves.toBeDefined();
    expect(mocks.available).toHaveBeenCalledTimes(2);
  });

  it('shares concurrent initialization without retaining its rejection', async () => {
    mocks.available.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const settings = { llm_provider: 'ollama' as const };
    const results = await Promise.allSettled([
      getProvider(settings),
      getProvider(settings),
    ]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(mocks.available).toHaveBeenCalledOnce();
    await expect(getProvider(settings)).resolves.toBeDefined();
    expect(mocks.available).toHaveBeenCalledTimes(2);
  });
});

describe('active provider identity', () => {
  it('retains the local allocation owner when inactive cloud settings change', async () => {
    mocks.available.mockResolvedValue(true);
    const settings = {
      llm_provider: 'ollama' as const,
      ollama_model: 'gemma4:12b',
      ollama_fast_model: 'phi4-mini:3.8b',
    };
    const first = await getProvider(settings);
    expect(
      await getProvider({
        ...settings,
        openrouter_model: 'fictional/new-model',
        openrouter_api_key: 'fictional-inactive-key',
      }),
    ).toBe(first);
  });

  it('replaces the provider when an active credential is rotated', async () => {
    mocks.available.mockResolvedValue(true);
    const { CLOUD_CONSENT_VERSION } = await import(
      '../../electron/llm/providerCatalog'
    );
    const settings = {
      llm_provider: 'openai' as const,
      openai_api_key: 'fictional-active-key-a',
      cloud_consents: { openai: CLOUD_CONSENT_VERSION },
    };
    const first = await getProvider(settings);
    expect(
      await getProvider({
        ...settings,
        openai_api_key: 'fictional-active-key-b',
      }),
    ).not.toBe(first);
  });
});

it('refreshes settings without losing a compatible provider and reloads changed local models', async () => {
  mocks.available.mockResolvedValue(true);
  let model = 'gemma4:12b';
  const db = {
    getSetting: (key: string) =>
      key === 'llm_provider'
        ? 'ollama'
        : key === 'ollama_model'
          ? model
          : undefined,
  };
  const firstSettings = await getAllSettings(db);
  const first = await getProvider(firstSettings);
  invalidateSettingsCache();
  const refreshed = await getAllSettings(db);
  expect(refreshed).not.toBe(firstSettings);
  expect(await getProvider(refreshed)).toBe(first);
  model = 'fictional-changed-model';
  invalidateSettingsCache();
  expect(await getProvider(await getAllSettings(db))).not.toBe(first);
});

it('rechecks active cloud consent after a settings refresh', async () => {
  mocks.available.mockResolvedValue(true);
  const { CLOUD_CONSENT_VERSION } = await import(
    '../../electron/llm/providerCatalog'
  );
  const settings = {
    llm_provider: 'openai' as const,
    openai_api_key: 'fictional-key',
    cloud_consents: { openai: CLOUD_CONSENT_VERSION },
  };
  await getProvider(settings);
  invalidateSettingsCache();
  await expect(
    getProvider({ ...settings, cloud_consents: { openai: 'revoked' } }),
  ).rejects.toThrow('openai_cloud_consent_required');
});
