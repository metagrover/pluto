vi.mock('../../electron/db', () => ({
  getEntitiesByType: vi.fn(),
  findEntity: vi.fn(),
  upsertEntity: vi
    .fn()
    .mockImplementation((e: Record<string, unknown>) => ({
      ...e,
      id: `mock-id-${Math.random()}`,
    })),
  linkEntities: vi.fn().mockImplementation((l: unknown) => l),
  addMeetingEntity: vi.fn(),
}));

import * as db from '../../electron/db';
import { processExtractedEntities } from '../../electron/entityPipeline';
import type { ExtractedEntities } from '../../electron/llm/provider';
import type { Entity } from '../../electron/db';

describe('Relationship Inference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default return values if needed, though simpler to set in test or let default undefined work
    vi.mocked(db.getEntitiesByType).mockReturnValue([]);
    vi.mocked(db.findEntity).mockReturnValue(undefined);
  });

  it('should link simultaneously created entities', async () => {
    const extracted: ExtractedEntities = {
      people: [{ name: 'Alice' }],
      topics: [],
      action_items: [],
      decisions: [],
      projects: [{ name: 'Project X' }],
      relationships: [
        { source: 'Alice', target: 'Project X', relationship: 'works_on' },
      ],
    };

    const result = await processExtractedEntities(extracted, 'meeting-1');

    // Should have created 2 entities
    expect(result.created).toBe(2);

    // Should have searched for source and target match in the just-created list
    expect(db.linkEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        relationship: 'works_on',
        meeting_id: 'meeting-1',
        confidence: 0.85,
      }),
    );
  });

  it('should link created entity to existing entity', async () => {
    // Setup existing person
    const existingPerson: Entity = {
      id: 'p1',
      type: 'person',
      name: 'Bob',
      normalized_name: 'bob',
      status: null,
      due_date: null,
      assigned_to: null,
      metadata: null,
      created_at: '',
      updated_at: '',
    };
    vi.mocked(db.getEntitiesByType).mockImplementation((type) =>
      type === 'person' ? [existingPerson] : [],
    );

    const extracted: ExtractedEntities = {
      people: [{ name: 'Bob' }], // Should resolve to existing
      topics: [],
      action_items: [],
      decisions: [],
      projects: [{ name: 'Project Y' }], // New
      relationships: [
        { source: 'Bob', target: 'Project Y', relationship: 'involved_in' },
      ],
    };

    const result = await processExtractedEntities(extracted, 'meeting-2');

    expect(result.updated).toBe(0); // Bob resolved, not updated (unless enriched)
    expect(result.created).toBe(1); // Project Y

    expect(db.linkEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        source_entity_id: 'p1',
        relationship: 'involved_in',
      }),
    );
  });

  it('should handle fuzzy matching for relationships', async () => {
    const extracted: ExtractedEntities = {
      people: [{ name: 'Sarah Chen' }],
      topics: [],
      action_items: [],
      decisions: [],
      projects: [{ name: 'Alpha Protocol' }],
      relationships: [
        { source: 'Sarah', target: 'Alpha Protocol', relationship: 'works_on' }, // "Sarah" vs "Sarah Chen"
      ],
    };

    await processExtractedEntities(extracted, 'meeting-3');

    expect(db.linkEntities).toHaveBeenCalled();
  });

  it('should ignore relationships where entities cannot be found', async () => {
    const extracted: ExtractedEntities = {
      people: [{ name: 'Dave' }],
      topics: [],
      action_items: [],
      decisions: [],
      projects: [],
      relationships: [
        { source: 'Dave', target: 'Ghost Project', relationship: 'works_on' },
      ],
    };

    await processExtractedEntities(extracted, 'meeting-4');

    expect(db.linkEntities).not.toHaveBeenCalled();
  });

  it('should apply soft confidence bias from priority hints', async () => {
    const extracted: ExtractedEntities = {
      people: [{ name: 'Alice' }],
      topics: [],
      action_items: [],
      decisions: [],
      projects: [{ name: 'Project X' }],
      relationships: [
        { source: 'Alice', target: 'Project X', relationship: 'works_on' },
      ],
    };

    await processExtractedEntities(extracted, 'meeting-5', {
      priorityHints: {
        prioritized_terms: ['project x'],
        relationship_bias: { works_on: 0.1 },
      },
    });

    expect(db.linkEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        relationship: 'works_on',
        meeting_id: 'meeting-5',
        confidence: 0.95,
      }),
    );
  });

  it('should not link ungrounded person relationships even if person exists in DB', async () => {
    const existingPerson: Entity = {
      id: 'p-sarah',
      type: 'person',
      name: 'Sarah Chen',
      normalized_name: 'sarah chen',
      status: null,
      due_date: null,
      assigned_to: null,
      metadata: null,
      created_at: '',
      updated_at: '',
    };
    vi.mocked(db.getEntitiesByType).mockImplementation((type) => {
      if (type === 'person') return [existingPerson];
      return [];
    });

    const extracted: ExtractedEntities = {
      people: [],
      topics: [{ name: 'open call exploration', importance: 'medium' }],
      action_items: [],
      decisions: [],
      projects: [],
      relationships: [
        {
          source: 'Sarah Chen',
          target: 'open call exploration',
          relationship: 'impacts',
        },
      ],
    };

    await processExtractedEntities(
      extracted,
      'meeting-6',
      undefined,
      'So there is a lot of programmers and builders who draw inspiration for your story.',
    );

    expect(db.linkEntities).not.toHaveBeenCalledWith(
      expect.objectContaining({
        source_entity_id: 'p-sarah',
      }),
    );
  });
});
