import { describe, expect, it, vi } from 'vitest';

import {
  getLocalInferenceAdmission,
  runWithLocalInferenceCoordinator,
} from '../../electron/llm/inferenceCoordinator';

describe('local inference coordinator', () => {
  it('keeps task admission policy independent of a model backend', () => {
    expect(getLocalInferenceAdmission('askPluto')).toEqual({
      priority: 20,
      preemptible: false,
    });
    expect(getLocalInferenceAdmission('notesWriter')).toEqual({
      priority: 10,
      preemptible: true,
    });
    expect(getLocalInferenceAdmission('knowledgeDoc')).toEqual({
      priority: 0,
      preemptible: true,
    });
  });

  it('settles preemptible background work before foreground inference starts', async () => {
    const events: string[] = [];
    const background = runWithLocalInferenceCoordinator({
      key: Symbol('background'),
      task: 'knowledgeDoc',
      run: (signal) =>
        new Promise<string>((_resolve, reject) => {
          events.push('background:start');
          signal.addEventListener(
            'abort',
            () => {
              events.push('background:settled');
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    });
    await vi.waitFor(() => expect(events).toEqual(['background:start']));

    const foreground = runWithLocalInferenceCoordinator({
      key: Symbol('foreground'),
      task: 'askPluto',
      run: async () => {
        events.push('foreground:start');
        return 'answer';
      },
    });

    await expect(background).rejects.toMatchObject({
      name: 'AbortError',
      message: 'foreground_preempted',
    });
    await expect(foreground).resolves.toBe('answer');
    expect(events).toEqual([
      'background:start',
      'background:settled',
      'foreground:start',
    ]);
  });

  it('serializes foreground requests and reports content-free queue timing', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = runWithLocalInferenceCoordinator({
      key: Symbol('first'),
      task: 'askPluto',
      run: () =>
        new Promise<string>((resolve) => {
          events.push('first:start');
          releaseFirst = () => resolve('first');
        }),
    });
    await vi.waitFor(() => expect(events).toEqual(['first:start']));
    const onAdmitted = vi.fn();
    const second = runWithLocalInferenceCoordinator({
      key: Symbol('second'),
      task: 'askPlutoDeep',
      onAdmitted,
      run: async () => {
        events.push('second:start');
        return 'second';
      },
    });

    expect(events).toEqual(['first:start']);
    releaseFirst();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'second:start']);
    expect(onAdmitted).toHaveBeenCalledWith({
      task: 'askPlutoDeep',
      queueMs: expect.any(Number),
    });
    expect(Object.keys(onAdmitted.mock.calls[0][0])).toEqual([
      'task',
      'queueMs',
    ]);
  });
});
