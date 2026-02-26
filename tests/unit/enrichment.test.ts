import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Electron and Database to prevent side effects during import
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('better-sqlite3', () => {
  function BetterSqlite3Mock() {
    return {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }),
      transaction: vi.fn((fn) => fn),
      exec: vi.fn(),
    };
  }

  return {
    default: BetterSqlite3Mock,
  };
});

import {
  parseDueDate,
  shouldEnrichEntity,
} from '../../electron/entityPipeline';

describe('Critical Business Logic', () => {
  describe('Enrichment Logic (shouldEnrichEntity)', () => {
    it('should enrich "Sarah" with "Sarah Chen"', () => {
      expect(shouldEnrichEntity('Sarah', 'Sarah Chen')).toBe(true);
    });

    it('should NOT enrich "Sarah Chen" with "Sarah"', () => {
      expect(shouldEnrichEntity('Sarah Chen', 'Sarah')).toBe(false);
    });

    it('should enrich "Project Alpha" with "Project Alpha v2"', () => {
      expect(shouldEnrichEntity('Project Alpha', 'Project Alpha v2')).toBe(
        true,
      );
    });

    it('should NOT enrich distinct names like "David" with "Sarah"', () => {
      expect(shouldEnrichEntity('David', 'Sarah')).toBe(false);
    });

    it('should handle different casing/punctuation', () => {
      // "P.O.C." -> "Proof of Concept" might not work with current simple logic
      // but let's test strict "substring-ish" enrichment
      expect(shouldEnrichEntity('sarah', 'Sarah Chen')).toBe(true);
    });
  });

  describe('Date Parsing Logic (parseDueDate)', () => {
    beforeEach(() => {
      // Freeze time to a known Monday for consistent testing
      vi.useFakeTimers();
      const monday = new Date(2023, 0, 2, 12, 0, 0); // Jan 2, 2023 is a Monday
      vi.setSystemTime(monday);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should parse "today"', () => {
      const date = parseDueDate('today');
      expect(date).toBeDefined();
      expect(date?.split('T')[0]).toBe('2023-01-02'); // Monday
    });

    it('should parse "tomorrow"', () => {
      const date = parseDueDate('tomorrow');
      expect(date).toBeDefined();
      expect(date?.split('T')[0]).toBe('2023-01-03'); // Tuesday
    });

    it('should parse "next week"', () => {
      const date = parseDueDate('next week');
      expect(date).toBeDefined();
      expect(date?.split('T')[0]).toBe('2023-01-09'); // Next Monday
    });

    it('should parse "by Friday"', () => {
      const date = parseDueDate('by Friday');
      expect(date).toBeDefined();
      expect(date?.split('T')[0]).toBe('2023-01-06'); // This Friday
    });

    it('should parse "end of week"', () => {
      // Assuming default logic maps to Friday or Sunday.
      // Current impl is +daysUntilFriday
      const date = parseDueDate('end of week');
      expect(date).toBeDefined();
      expect(date?.split('T')[0]).toBe('2023-01-06'); // Friday
    });

    it('should handle invalid dates gracefully', () => {
      expect(parseDueDate('invalid date string')).toBeNull();
      expect(parseDueDate('')).toBeNull();
    });
  });
});
