import { describe, expect, it, vi } from 'vitest';

// Mock Electron and Database to prevent side effects during import
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp', // Return temp path for tests
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('better-sqlite3', () => {
  return {
    default: () => ({
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }),
      transaction: vi.fn((fn) => fn),
      exec: vi.fn(),
    }),
  };
});

import type { Entity } from '../../electron/db';
import {
  findSimilarEntity,
  normalizeForMatch,
  normalizeTokenSort,
} from '../../electron/entityPipeline';

describe('Entity Resolution Logic', () => {
  describe('normalizeForMatch', () => {
    it('should remove punctuation and lowercase', () => {
      expect(normalizeForMatch('Hello, World!')).toBe('hello world');
      expect(normalizeForMatch('Sarah-Jane')).toBe('sarahjane');
    });
  });

  describe('normalizeTokenSort', () => {
    it('should sort tokens alphabetically', () => {
      expect(normalizeTokenSort('Project Alpha')).toBe('alpha project');
      expect(normalizeTokenSort('Alpha Project')).toBe('alpha project');
      expect(normalizeTokenSort('The Big Project')).toBe('big project the');
    });
  });

  describe('findSimilarEntity', () => {
    const mockEntities: Entity[] = [
      {
        id: '1',
        type: 'person',
        name: 'Sarah Chen',
        normalized_name: 'sarah chen',
        status: null,
        due_date: null,
        assigned_to: null,
        metadata: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: '2',
        type: 'project',
        name: 'Alpha Project',
        normalized_name: 'alpha project',
        status: null,
        due_date: null,
        assigned_to: null,
        metadata: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: '3',
        type: 'topic',
        name: 'API Migration',
        normalized_name: 'api migration',
        status: null,
        due_date: null,
        assigned_to: null,
        metadata: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: '4',
        type: 'person',
        name: 'Michael Scott',
        normalized_name: 'michael scott',
        status: null,
        due_date: null,
        assigned_to: null,
        metadata: null,
        created_at: '',
        updated_at: '',
      },
    ];

    it('should find exact matches', () => {
      const match = findSimilarEntity('person', 'Sarah Chen', mockEntities);
      expect(match).toBeDefined();
      expect(match?.name).toBe('Sarah Chen');
    });

    it('should find substring matches (Sarah -> Sarah Chen)', () => {
      const match = findSimilarEntity('person', 'Sarah', mockEntities);
      expect(match).toBeDefined();
      expect(match?.name).toBe('Sarah Chen');
    });

    it('should find token sort matches (Project Alpha -> Alpha Project)', () => {
      const match = findSimilarEntity('project', 'Project Alpha', mockEntities);
      expect(match).toBeDefined();
      expect(match?.name).toBe('Alpha Project');
    });

    it('should find Levenshtein matches (Api migration -> API Migration)', () => {
      const match = findSimilarEntity('topic', 'Api migration', mockEntities);
      expect(match).toBeDefined();
      expect(match?.name).toBe('API Migration');
    });

    it('should NOT match unrelated names', () => {
      const match = findSimilarEntity('person', 'David', mockEntities);
      expect(match).toBeUndefined();
    });

    it('should NOT match names across types', () => {
      // "Alpha Project" matches the name but is a project, we ask for a person
      const match = findSimilarEntity('person', 'Alpha Project', mockEntities);
      expect(match).toBeUndefined();
    });

    it('should not match short substrings aggressively if threshold is high', () => {
      // "Sarah" matches "Sarah Chen", but "Sar" might be too short if we enforce length checks
      // Our current logic has a length check > 3
      const match = findSimilarEntity('person', 'Sar', mockEntities);
      // Should fail because strict length check > 3
      expect(match).toBeUndefined();
    });
  });
});
