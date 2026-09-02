import type { DirtyEntityCandidate } from './idleDreamingCoordinator';

export interface RoundRobinEntityQueueDeps {
  getProjects: () => Array<{ id: string }>;
  getPeople: () => Array<{ id: string }>;
}

export interface RoundRobinEntityQueue {
  getNextCandidate: () => DirtyEntityCandidate | null;
  reset: () => void;
  getVisitedCount: () => number;
}

export const createRoundRobinEntityQueue = (
  deps: RoundRobinEntityQueueDeps,
): RoundRobinEntityQueue => {
  const visitedIds = new Set<string>();

  const getNextCandidate = (): DirtyEntityCandidate | null => {
    const projects = deps.getProjects();
    const people = deps.getPeople();

    const maxLen = Math.max(projects.length, people.length);
    const candidates: DirtyEntityCandidate[] = [];

    for (let i = 0; i < maxLen; i++) {
      if (i < projects.length) {
        candidates.push({ entityId: projects[i].id, type: 'project' });
      }
      if (i < people.length) {
        candidates.push({ entityId: people[i].id, type: 'person' });
      }
    }

    if (candidates.length === 0) {
      visitedIds.clear();
      return null;
    }

    // Prune visitedIds that no longer exist in either list
    const currentIdSet = new Set(candidates.map((c) => c.entityId));
    for (const id of visitedIds) {
      if (!currentIdSet.has(id)) {
        visitedIds.delete(id);
      }
    }

    // Find first unvisited candidate in fair round-robin order
    let next = candidates.find((c) => !visitedIds.has(c.entityId));

    // If all current candidates have been visited, reset cycle and pick the first
    if (!next) {
      visitedIds.clear();
      next = candidates[0];
    }

    visitedIds.add(next.entityId);
    return next;
  };

  const reset = () => {
    visitedIds.clear();
  };

  const getVisitedCount = () => visitedIds.size;

  return {
    getNextCandidate,
    reset,
    getVisitedCount,
  };
};
