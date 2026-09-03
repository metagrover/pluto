import { describe, expect, it, vi } from 'vitest';
import {
  createDirtyEntityQueue,
  invalidateDreamingWork,
} from '../../electron/dreaming/entityQueue';

describe('createDirtyEntityQueue', () => {
  it('scans one bounded epoch and stays quiescent until invalidated', () => {
    const getProjects = vi.fn(() => [{ id: 'proj-1' }]);
    const getPeople = vi.fn(() => [{ id: 'person-1' }]);
    const queue = createDirtyEntityQueue({ getProjects, getPeople });

    expect(queue.getNextCandidate()).toEqual({
      entityId: 'proj-1',
      type: 'project',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'person-1',
      type: 'person',
    });
    expect(queue.getNextCandidate()).toBeNull();
    expect(queue.getNextCandidate()).toBeNull();
    expect(getProjects).toHaveBeenCalledOnce();
    expect(getPeople).toHaveBeenCalledOnce();

    queue.invalidate();
    expect(queue.getPendingCount()).toBe(2);
    expect(getProjects).toHaveBeenCalledTimes(2);
  });

  it('excludes active aliases and de-duplicates targeted invalidation', () => {
    const queue = createDirtyEntityQueue({
      getProjects: () => [{ id: 'project-alias' }, { id: 'project-1' }],
      getPeople: () => [{ id: 'person-alias' }, { id: 'person-1' }],
      resolveProjectId: (id) => (id === 'project-alias' ? 'project-1' : id),
      resolvePersonId: (id) => (id === 'person-alias' ? 'person-1' : id),
    });

    expect(queue.getNextCandidate()).toEqual({
      entityId: 'project-1',
      type: 'project',
    });
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'person-1',
      type: 'person',
    });
    expect(queue.getNextCandidate()).toBeNull();
    queue.invalidate({ entityId: 'project-1', type: 'project' });
    queue.invalidate({ entityId: 'project-1', type: 'project' });
    expect(queue.getPendingCount()).toBe(1);
  });

  it('reschedules executable work after the queue became quiescent', () => {
    const queue = createDirtyEntityQueue({
      getProjects: () => [{ id: 'project-1' }],
      getPeople: () => [],
    });
    expect(queue.getNextCandidate()).not.toBeNull();
    expect(queue.getNextCandidate()).toBeNull();
    const schedule = vi.fn();
    invalidateDreamingWork(queue, schedule);
    expect(schedule).toHaveBeenCalledOnce();
    expect(queue.getNextCandidate()).toEqual({
      entityId: 'project-1',
      type: 'project',
    });
  });
});
