import { beforeEach } from 'vitest';

// Unit tests must never fall through a depleted mock into the user's live LLM.
// Explicit transport tests replace this with their own bounded fake. Opted-in
// real-provider acceptance uses a separate config without this setup file.
const rejectUnmockedFetch: typeof fetch = async () => {
  throw new Error(
    'Unit tests must mock fetch; real providers require the manual acceptance config',
  );
};
globalThis.fetch = rejectUnmockedFetch;
beforeEach(() => {
  globalThis.fetch = rejectUnmockedFetch;
});
