import { expect, it } from 'vitest';

it('blocks an unmocked provider request before it can reach a running local model', async () => {
  await expect(fetch('http://127.0.0.1:11434/api/generate')).rejects.toThrow(
    'Unit tests must mock fetch',
  );
});
