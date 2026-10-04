import { setImmediate } from 'node:timers';
import { describe, expect, it, vi } from 'vitest';
import { collectProjectSynthesisSources } from '../../electron/projectSynthesisSources';

const source = (id: string) => ({
  id,
  title: 'Fictional planning',
  notes: 'Fictional evidence',
  candidateProjects: [],
});

describe('project synthesis source collection', () => {
  it('defers before any database/source reads while foreground work is active', async () => {
    const listMeetings = vi.fn(() => ['one']);
    const buildSource = vi.fn(source);
    expect(
      await collectProjectSynthesisSources({
        listMeetings,
        buildSource,
        shouldContinue: () => false,
      }),
    ).toBeNull();
    expect(listMeetings).not.toHaveBeenCalled();
    expect(buildSource).not.toHaveBeenCalled();
  });
  it('yields between source reads and stops when foreground activity resumes', async () => {
    let eligible = true;
    const buildSource = vi.fn((id: string) => {
      setImmediate(() => {
        eligible = false;
      });
      return source(id);
    });
    expect(
      await collectProjectSynthesisSources({
        listMeetings: () => ['one', 'two'],
        buildSource,
        shouldContinue: () => eligible,
      }),
    ).toBeNull();
    expect(buildSource).toHaveBeenCalledTimes(1);
  });
  it('collects all usable sources once with stable ordering', async () => {
    const listMeetings = vi.fn(() => ['one', 'empty', 'two']);
    const buildSource = vi.fn((id: string) =>
      id === 'empty' ? null : source(id),
    );
    expect(
      await collectProjectSynthesisSources({
        listMeetings,
        buildSource,
        shouldContinue: () => true,
      }),
    ).toEqual([source('one'), source('two')]);
    expect(listMeetings).toHaveBeenCalledOnce();
    expect(buildSource).toHaveBeenCalledTimes(3);
  });
});
