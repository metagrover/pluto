// @vitest-environment happy-dom

import type React from 'react';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entity } from '../../src/api/knowledgeGraph';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const searchEntitiesMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/api/knowledgeGraph', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/api/knowledgeGraph')>();
  return {
    ...actual,
    searchEntities: searchEntitiesMock,
    updateActionCommitmentState: vi.fn(),
    updateEntityStatus: vi.fn(),
  };
});

vi.mock('../../src/components/AudioManager', () => ({
  AudioManager: ({
    onStartSessionRef,
    onStopSessionRef,
  }: {
    onStartSessionRef?: React.MutableRefObject<(() => void) | null>;
    onStopSessionRef?: React.MutableRefObject<(() => void) | null>;
  }) => {
    useEffect(() => {
      if (onStartSessionRef) onStartSessionRef.current = () => {};
      if (onStopSessionRef) onStopSessionRef.current = () => {};
      return () => {
        if (onStartSessionRef) onStartSessionRef.current = null;
        if (onStopSessionRef) onStopSessionRef.current = null;
      };
    }, [onStartSessionRef, onStopSessionRef]);
    return null;
  },
}));

vi.mock('../../src/components/KnowledgeGraph/ProjectsExecutionTab', () => ({
  ProjectsExecutionTab: ({
    selectedProjectId,
  }: {
    selectedProjectId?: string | null;
  }) => (
    <section>
      <h1>Projects</h1>
      <p data-testid="selected-project">{selectedProjectId ?? 'none'}</p>
    </section>
  ),
}));

vi.mock('../../src/components/KnowledgeGraph/PeopleTab', () => ({
  PeopleTab: ({ selectedPersonId }: { selectedPersonId?: string | null }) => (
    <section>
      <h1>People</h1>
      <p data-testid="selected-person">{selectedPersonId ?? 'none'}</p>
    </section>
  ),
}));

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const makeEntity = (overrides: Partial<Entity>): Entity => ({
  id: 'project-1',
  type: 'project',
  name: 'Launch Project',
  normalized_name: 'launch project',
  status: 'active',
  due_date: null,
  assigned_to: null,
  metadata: null,
  saliency_score: 1,
  domain_tag: 'general',
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
  ...overrides,
});

const typeSearchQuery = async (
  input: HTMLInputElement,
  value: string,
  windowRef: Window & typeof globalThis,
) => {
  const valueSetter = Object.getOwnPropertyDescriptor(
    windowRef.HTMLInputElement.prototype,
    'value',
  )?.set;
  expect(valueSetter).toBeDefined();

  await act(async () => {
    valueSetter!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
  });
};

describe('App Search Pluto navigation', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    searchEntitiesMock.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    window.__PLUTO_BROWSER_PREVIEW__ = false;
    Object.defineProperty(window, 'ipcRenderer', {
      configurable: true,
      value: {
        invoke: vi.fn(async (channel: string, key?: string) => {
          if (channel === 'GET_SETTING') {
            if (key === 'setup_complete') return 'true';
            if (key === 'theme') return 'system';
            if (key === 'auto_end_enabled') return 'false';
            if (key === 'llm_provider') return 'ollama';
            if (key === 'transcription_language') return '';
            return null;
          }
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
          if (channel === 'GET_MEETINGS') return [];
          if (channel === 'BOOT_PROBE_STATUS') return true;
          if (channel === 'DETECT_ACTIVE_CALL') return { active: false };
          return null;
        }),
        send: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    });
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.__PLUTO_BROWSER_PREVIEW__ = undefined;
  });

  it('debounces entity search and opens the exact selected project result', async () => {
    let resolveLaunch:
      | ((entities: Entity[] | PromiseLike<Entity[]>) => void)
      | undefined;
    searchEntitiesMock.mockImplementation(
      (query: string) =>
        new Promise<Entity[]>((resolve) => {
          if (query === 'launch') resolveLaunch = resolve;
        }),
    );
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', metaKey: true }),
      );
      await flushPromises();
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search Pluto"]',
    );
    expect(input).not.toBeNull();

    await typeSearchQuery(input!, 'launch', window);
    expect(searchEntitiesMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushPromises();
    });
    expect(searchEntitiesMock).toHaveBeenCalledWith('launch');

    await act(async () => {
      resolveLaunch?.([
        makeEntity({
          id: 'project-launch',
          type: 'project',
          name: 'Launch Project',
        }),
      ]);
      await flushPromises();
    });

    const projectResult = container.querySelector<HTMLButtonElement>(
      '[data-search-result-kind="project"]',
    );
    expect(projectResult).not.toBeNull();
    await act(async () => {
      projectResult?.click();
      await flushPromises();
    });

    expect(
      container.querySelector('[data-testid="selected-project"]')?.textContent,
    ).toBe('project-launch');

    await act(async () => root.unmount());
  });

  it('ignores stale entity search responses and opens the exact selected person result', async () => {
    let resolveLaunch:
      | ((entities: Entity[] | PromiseLike<Entity[]>) => void)
      | undefined;
    let resolveLuna:
      | ((entities: Entity[] | PromiseLike<Entity[]>) => void)
      | undefined;
    searchEntitiesMock.mockImplementation(
      (query: string) =>
        new Promise<Entity[]>((resolve) => {
          if (query === 'launch') resolveLaunch = resolve;
          if (query === 'luna') resolveLuna = resolve;
        }),
    );
    const { default: App } = await import('../../src/App');
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushPromises();
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', metaKey: true }),
      );
      await flushPromises();
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search Pluto"]',
    );
    expect(input).not.toBeNull();

    await typeSearchQuery(input!, 'launch', window);
    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushPromises();
    });
    expect(searchEntitiesMock).toHaveBeenCalledWith('launch');

    await typeSearchQuery(input!, 'luna', window);
    await act(async () => {
      vi.advanceTimersByTime(200);
      await flushPromises();
    });
    expect(searchEntitiesMock).toHaveBeenCalledWith('luna');

    await act(async () => {
      resolveLuna?.([
        makeEntity({
          id: 'person-luna',
          type: 'person',
          name: 'Luna Person',
        }),
      ]);
      resolveLaunch?.([
        makeEntity({
          id: 'project-stale',
          type: 'project',
          name: 'Launch Luna Project',
        }),
      ]);
      await flushPromises();
    });

    expect(container.querySelector('[data-search-result-kind="project"]')).toBe(
      null,
    );
    const personResult = container.querySelector<HTMLButtonElement>(
      '[data-search-result-kind="person"]',
    );
    expect(personResult).not.toBeNull();
    await act(async () => {
      personResult?.click();
      await flushPromises();
    });

    expect(
      container.querySelector('[data-testid="selected-person"]')?.textContent,
    ).toBe('person-luna');

    await act(async () => root.unmount());
  });
});
