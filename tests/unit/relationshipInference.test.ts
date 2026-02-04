vi.mock('../../electron/db', () => ({
    getEntitiesByType: vi.fn(),
    findEntity: vi.fn(),
    upsertEntity: vi.fn().mockImplementation((e: any) => ({ ...e, id: 'mock-id-' + Math.random() })),
    linkEntities: vi.fn().mockImplementation((l: any) => l),
    addMeetingEntity: vi.fn()
}))

import * as db from '../../electron/db'
import { processExtractedEntities } from '../../electron/entityPipeline'
import { ExtractedEntities } from '../../electron/llm/provider'

describe('Relationship Inference', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Default return values if needed, though simpler to set in test or let default undefined work
        vi.mocked(db.getEntitiesByType).mockReturnValue([])
        vi.mocked(db.findEntity).mockReturnValue(undefined)
    })

    it('should link simultaneously created entities', async () => {
        const extracted: ExtractedEntities = {
            people: [{ name: 'Alice' }],
            topics: [],
            action_items: [],
            decisions: [],
            projects: [{ name: 'Project X' }],
            relationships: [
                { source: 'Alice', target: 'Project X', relationship: 'works_on' }
            ]
        }

        const result = await processExtractedEntities(extracted, 'meeting-1')

        // Should have created 2 entities
        expect(result.created).toBe(2)

        // Should have searched for source and target match in the just-created list
        expect(db.linkEntities).toHaveBeenCalledWith(expect.objectContaining({
            relationship: 'works_on',
            meeting_id: 'meeting-1',
            confidence: 0.85
        }))
    })

    it('should link created entity to existing entity', async () => {
        // Setup existing person
        const existingPerson = { id: 'p1', type: 'person', name: 'Bob', created_at: '', updated_at: '' }
        vi.mocked(db.getEntitiesByType).mockImplementation((type) => type === 'person' ? [existingPerson] as any : [])

        const extracted: ExtractedEntities = {
            people: [{ name: 'Bob' }], // Should resolve to existing
            topics: [],
            action_items: [],
            decisions: [],
            projects: [{ name: 'Project Y' }], // New
            relationships: [
                { source: 'Bob', target: 'Project Y', relationship: 'involved_in' }
            ]
        }

        const result = await processExtractedEntities(extracted, 'meeting-2')

        expect(result.updated).toBe(0) // Bob resolved, not updated (unless enriched)
        expect(result.created).toBe(1) // Project Y

        expect(db.linkEntities).toHaveBeenCalledWith(expect.objectContaining({
            source_entity_id: 'p1',
            relationship: 'involved_in'
        }))
    })

    it('should handle fuzzy matching for relationships', async () => {
        const extracted: ExtractedEntities = {
            people: [{ name: 'Sarah Chen' }],
            topics: [],
            action_items: [],
            decisions: [],
            projects: [{ name: 'Alpha Protocol' }],
            relationships: [
                { source: 'Sarah', target: 'Alpha Protocol', relationship: 'works_on' } // "Sarah" vs "Sarah Chen"
            ]
        }

        await processExtractedEntities(extracted, 'meeting-3')

        expect(db.linkEntities).toHaveBeenCalled()
    })

    it('should ignore relationships where entities cannot be found', async () => {
        const extracted: ExtractedEntities = {
            people: [{ name: 'Dave' }],
            topics: [],
            action_items: [],
            decisions: [],
            projects: [],
            relationships: [
                { source: 'Dave', target: 'Ghost Project', relationship: 'works_on' }
            ]
        }

        await processExtractedEntities(extracted, 'meeting-4')

        expect(db.linkEntities).not.toHaveBeenCalled()
    })
})
