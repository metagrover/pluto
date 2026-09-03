import type { DirtyEntityCandidate } from './idleDreamingCoordinator';

type EntityRef = { id: string };

export interface DirtyEntityQueueDeps {
  getProjects: () => EntityRef[];
  getPeople: () => EntityRef[];
  resolveProjectId?: (id: string) => string;
  resolvePersonId?: (id: string) => string;
}

export interface DirtyEntityQueue {
  getNextCandidate: () => DirtyEntityCandidate | null;
  invalidate: (candidate?: DirtyEntityCandidate) => void;
  hasPendingWork: () => boolean;
  getPendingCount: () => number;
}

export const invalidateDreamingWork = (
  queue: Pick<DirtyEntityQueue, 'invalidate'>,
  schedule: () => void,
  candidate?: DirtyEntityCandidate,
) => {
  queue.invalidate(candidate);
  schedule();
};

const candidateKey = ({ entityId, type }: DirtyEntityCandidate) =>
  `${type}:${entityId}`;

/** Each canonical entity is yielded once until content invalidates the queue. */
export const createDirtyEntityQueue = (
  deps: DirtyEntityQueueDeps,
): DirtyEntityQueue => {
  let initialized = false;
  let pending: DirtyEntityCandidate[] = [];
  const pendingKeys = new Set<string>();

  const append = (candidate: DirtyEntityCandidate) => {
    const key = candidateKey(candidate);
    if (pendingKeys.has(key)) return;
    pendingKeys.add(key);
    pending.push(candidate);
  };

  const isCanonical = (id: string, resolve?: (id: string) => string) => {
    try {
      return (resolve?.(id) ?? id) === id;
    } catch {
      return false;
    }
  };

  const scanCatalog = () => {
    pending = [];
    pendingKeys.clear();
    const projects = deps.getProjects();
    const people = deps.getPeople();
    const maxLength = Math.max(projects.length, people.length);
    for (let index = 0; index < maxLength; index += 1) {
      const project = projects[index];
      if (project && isCanonical(project.id, deps.resolveProjectId)) {
        append({ entityId: project.id, type: 'project' });
      }
      const person = people[index];
      if (person && isCanonical(person.id, deps.resolvePersonId)) {
        append({ entityId: person.id, type: 'person' });
      }
    }
    initialized = true;
  };

  const ensureInitialized = () => {
    if (!initialized) scanCatalog();
  };

  return {
    getNextCandidate() {
      ensureInitialized();
      const next = pending.shift() ?? null;
      if (next) pendingKeys.delete(candidateKey(next));
      return next;
    },
    invalidate(candidate) {
      if (!candidate) {
        scanCatalog();
        return;
      }
      ensureInitialized();
      append(candidate);
    },
    hasPendingWork() {
      ensureInitialized();
      return pending.length > 0;
    },
    getPendingCount() {
      ensureInitialized();
      return pending.length;
    },
  };
};
