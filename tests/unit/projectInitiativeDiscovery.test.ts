import { describe, expect, it, vi } from 'vitest';
import {
  PROJECT_INITIATIVE_DISCOVERY_VERSION,
  discoverProjectInitiative,
} from '../../electron/projectInitiativeDiscovery';

const transcript =
  'Aurora will replace the legacy billing system. First migrate all customer records. Then rebuild the invoicing service.';
const response = {
  sourceMeetingId: 'm1',
  result: {
    kind: 'initiative',
    reason: 'A distinct migration outcome with two work packages.',
    name: 'Aurora billing replacement',
    outcome: 'Replace the legacy billing system',
    outcomeEvidenceQuote: 'Aurora will replace the legacy billing system.',
    workItems: [
      {
        description: 'Migrate customer records',
        evidenceQuote: 'First migrate all customer records.',
      },
      {
        description: 'Rebuild invoicing',
        evidenceQuote: 'Then rebuild the invoicing service.',
      },
    ],
  },
};

function makeDeps() {
  const states = new Map<string, any>();
  const initiatives = new Map<string, any>();
  const sources = [
    {
      id: 'm2',
      title: 'One mention',
      text: 'A short project mention.',
      projectCount: 1,
    },
    { id: 'm1', title: 'Aurora planning', text: transcript, projectCount: 3 },
  ];
  return {
    sources,
    states,
    initiatives,
    deps: {
      listSources: () => sources,
      getSource: (id: string) => sources.find((source) => source.id === id),
      getState: (id: string) => states.get(id) ?? null,
      saveState: vi.fn((id: string, state: any) => states.set(id, state)),
      getInitiative: (id: string) => initiatives.get(id),
      saveInitiative: vi.fn((initiative: any) => {
        initiatives.set(initiative.id, initiative);
      }),
      generate: vi.fn(async () => JSON.stringify(response)),
      isBusy: () => false,
    },
  };
}

describe('source-grounded project initiative discovery', () => {
  it('reviews one rich source, validates exact quotes, and saves a deterministic initiative', async () => {
    const fixture = makeDeps();
    const first = await discoverProjectInitiative(fixture.deps);
    expect(first).toMatchObject({
      discovered: 1,
      remaining: 1,
      deferred: false,
    });
    expect(fixture.deps.generate).toHaveBeenCalledOnce();
    expect(fixture.deps.generate.mock.calls[0][0]).toContain(
      'Extract the strongest cohesive goal-and-actions bundle',
    );
    expect(fixture.deps.generate.mock.calls[0][0]).toContain(
      'untrusted labels for locating related passages only',
    );
    expect(fixture.deps.generate.mock.calls[0][0]).toContain(
      'choose the single strongest one',
    );
    expect(fixture.deps.saveInitiative).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^project-discovery-[a-f0-9]{24}$/),
        name: 'Aurora billing replacement',
        sourceMeetingId: 'm1',
        metadata: expect.objectContaining({
          projectQualification: expect.objectContaining({
            state: 'qualified',
            sourceMeetingId: 'm1',
          }),
        }),
      }),
    );
    expect(fixture.states.get('m1')).toMatchObject({
      version: PROJECT_INITIATIVE_DISCOVERY_VERSION,
      status: 'complete',
      projectIds: [first.discoveredProjectId],
    });
  });

  it('persists a grounded no-result so it does not loop on reload', async () => {
    const fixture = makeDeps();
    fixture.deps.generate.mockResolvedValue(
      JSON.stringify({
        sourceMeetingId: 'm1',
        result: {
          kind: 'none',
          reason: 'Only a single task is discussed.',
          name: '',
          outcome: '',
          outcomeEvidenceQuote: '',
          workItems: [],
        },
      }),
    );
    expect(await discoverProjectInitiative(fixture.deps)).toMatchObject({
      discovered: 0,
      remaining: 1,
    });
    expect(fixture.states.get('m1')).toMatchObject({
      status: 'complete',
      projectIds: [],
    });
    await discoverProjectInitiative(fixture.deps);
    expect(fixture.deps.generate).toHaveBeenCalledTimes(2);
    expect(fixture.deps.generate.mock.calls[1][0]).toContain('One mention');
  });

  it('rejects invented or overlapping evidence without creating an initiative', async () => {
    const fixture = makeDeps();
    fixture.deps.generate.mockResolvedValue(
      JSON.stringify({
        ...response,
        result: {
          ...response.result,
          outcomeEvidenceQuote: 'Invented outcome evidence for Aurora.',
        },
      }),
    );
    const result = await discoverProjectInitiative(fixture.deps);
    expect(result).toMatchObject({ discovered: 0, failedSourceId: 'm1' });
    expect(fixture.deps.saveInitiative).not.toHaveBeenCalled();
    expect(fixture.states.get('m1')).toMatchObject({ status: 'failed' });
    await discoverProjectInitiative(fixture.deps);
    expect(fixture.deps.generate).toHaveBeenCalledOnce();
  });

  it('keeps provider failures retryable without writing state or entities', async () => {
    const fixture = makeDeps();
    fixture.deps.generate.mockRejectedValue(new Error('offline'));
    await expect(discoverProjectInitiative(fixture.deps)).rejects.toThrow(
      'offline',
    );
    expect(fixture.deps.saveState).not.toHaveBeenCalled();
    expect(fixture.deps.saveInitiative).not.toHaveBeenCalled();
  });

  it('does not write stale output after the source changes during generation', async () => {
    const fixture = makeDeps();
    fixture.deps.generate.mockImplementation(async () => {
      fixture.sources[1].text += ' A corrected ending.';
      return JSON.stringify(response);
    });
    expect(await discoverProjectInitiative(fixture.deps)).toMatchObject({
      discovered: 0,
      attemptedSourceId: 'm1',
    });
    expect(fixture.deps.saveState).not.toHaveBeenCalled();
    expect(fixture.deps.saveInitiative).not.toHaveBeenCalled();
  });

  it('is idempotent and does not overwrite an existing initiative', async () => {
    const fixture = makeDeps();
    const first = await discoverProjectInitiative(fixture.deps);
    const existing = fixture.initiatives.get(first.discoveredProjectId!);
    existing.name = 'User corrected name';
    fixture.states.delete('m1');
    await discoverProjectInitiative(fixture.deps);
    expect(fixture.deps.saveInitiative).toHaveBeenCalledTimes(1);
    expect(fixture.initiatives.get(first.discoveredProjectId!).name).toBe(
      'User corrected name',
    );
  });

  it('reconsiders completed state only after the source revision changes', async () => {
    const fixture = makeDeps();
    await discoverProjectInitiative(fixture.deps);
    fixture.sources[0].projectCount = 4;
    fixture.deps.generate.mockResolvedValueOnce(
      JSON.stringify({
        sourceMeetingId: 'm2',
        result: {
          kind: 'none',
          reason: 'No cohesive initiative is established.',
          name: '',
          outcome: '',
          outcomeEvidenceQuote: '',
          workItems: [],
        },
      }),
    );
    await discoverProjectInitiative(fixture.deps);
    expect(fixture.deps.generate).toHaveBeenCalledTimes(2);
    fixture.sources[1].text += ' A newly corrected source sentence.';
    await discoverProjectInitiative(fixture.deps);
    expect(fixture.deps.generate).toHaveBeenCalledTimes(3);
    expect(fixture.deps.generate.mock.calls[2][0]).toContain(
      'newly corrected source sentence',
    );
  });

  it('defers without model work while recording or foreground work is active', async () => {
    const fixture = makeDeps();
    fixture.deps.isBusy = () => true;
    expect(await discoverProjectInitiative(fixture.deps)).toMatchObject({
      deferred: true,
      remaining: 2,
    });
    expect(fixture.deps.generate).not.toHaveBeenCalled();
  });
});
