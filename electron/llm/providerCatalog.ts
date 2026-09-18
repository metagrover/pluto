import type { CloudProviderId, ProviderId } from './inferenceTypes';

export const CLOUD_CONSENT_VERSION = '1';

export const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string> = {
  ollama: 'phi4-reasoning-plus:latest',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  gemini: 'gemini-3.8-flash',
  claude: 'claude-3-haiku-20240307',
};

export const OPENROUTER_CURATED_MODELS = [
  'openai/gpt-4o-mini',
  'anthropic/claude-3.5-haiku',
  'google/gemini-2.5-flash',
] as const;

export const isCloudProvider = (
  provider: ProviderId,
): provider is CloudProviderId => provider !== 'ollama';

export const credentialSettingKey = (provider: CloudProviderId) =>
  `${provider}_api_key` as const;

export const cloudConsentSettingKey = (provider: CloudProviderId) =>
  `cloud_consent_${provider}` as const;
