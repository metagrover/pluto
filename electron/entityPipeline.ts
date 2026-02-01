/**
 * Entity Extraction Pipeline
 * 
 * Processes LLM-extracted entities and stores them in the knowledge graph.
 * Handles entity resolution, relationship creation, and meeting associations.
 */

import { ExtractedEntities } from './llm/provider'
import * as db from './db'

export interface ProcessedEntities {
    created: number
    updated: number
    linked: number
    entities: db.Entity[]
}

/**
 * Parse natural language due dates into ISO date strings
 * This is a simple implementation - could be enhanced with a date parsing library
 */
function parseDueDate(dueDate: string): string | null {
    if (!dueDate) return null

    const now = new Date()
    const lower = dueDate.toLowerCase().trim()

    // Handle common patterns
    if (lower === 'today') {
        return now.toISOString()
    }
    if (lower === 'tomorrow') {
        const tomorrow = new Date(now)
        tomorrow.setDate(tomorrow.getDate() + 1)
        return tomorrow.toISOString()
    }
    if (lower === 'next week' || lower === 'by next week') {
        const nextWeek = new Date(now)
        nextWeek.setDate(nextWeek.getDate() + 7)
        return nextWeek.toISOString()
    }
    if (lower === 'end of week' || lower === 'eow') {
        const eow = new Date(now)
        const daysUntilFriday = (5 - eow.getDay() + 7) % 7 || 7
        eow.setDate(eow.getDate() + daysUntilFriday)
        return eow.toISOString()
    }

    // Handle day names (e.g., "by Friday", "on Monday")
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    for (let i = 0; i < dayNames.length; i++) {
        if (lower.includes(dayNames[i])) {
            const target = new Date(now)
            const daysUntil = (i - target.getDay() + 7) % 7 || 7
            target.setDate(target.getDate() + daysUntil)
            return target.toISOString()
        }
    }

    // Try to parse as a date directly
    try {
        const parsed = new Date(dueDate)
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString()
        }
    } catch {
        // Ignore parse errors
    }

    return null
}

/**
 * Process extracted entities and store them in the knowledge graph
 */
export async function processExtractedEntities(
    extracted: ExtractedEntities,
    meetingId: string
): Promise<ProcessedEntities> {
    let created = 0
    let updated = 0
    let linked = 0
    const entities: db.Entity[] = []

    console.log(`[EntityPipeline] Processing entities for meeting ${meetingId}`)
    console.log(`[EntityPipeline] Found: ${extracted.people.length} people, ${extracted.topics.length} topics, ${extracted.action_items.length} action items, ${extracted.decisions.length} decisions`)

    // 1. Process People
    for (const person of extracted.people) {
        const existing = db.findEntity('person', person.name)
        const entity = db.upsertEntity({
            type: 'person',
            name: person.name,
            metadata: person.role ? { role: person.role } : undefined
        })

        if (existing) {
            updated++
        } else {
            created++
        }

        entities.push(entity)

        // Associate with meeting
        db.addMeetingEntity({
            meeting_id: meetingId,
            entity_id: entity.id,
            context: person.role ? `Role: ${person.role}` : undefined
        })
        linked++
    }

    // 2. Process Topics
    for (const topic of extracted.topics) {
        const existing = db.findEntity('topic', topic.name)
        const entity = db.upsertEntity({
            type: 'topic',
            name: topic.name,
            metadata: { importance: topic.importance }
        })

        if (existing) {
            updated++
        } else {
            created++
        }

        entities.push(entity)

        // Associate with meeting
        db.addMeetingEntity({
            meeting_id: meetingId,
            entity_id: entity.id,
            context: `Importance: ${topic.importance}`
        })
        linked++
    }

    // 3. Process Action Items
    for (const actionItem of extracted.action_items) {
        // Action items are always created fresh (not deduplicated by name)
        const dueDate = parseDueDate(actionItem.due_date || '')

        const entity = db.upsertEntity({
            type: 'action_item',
            name: actionItem.description.substring(0, 100), // Truncate for name
            status: 'active',
            due_date: dueDate,
            metadata: {
                full_description: actionItem.description,
                assignee_name: actionItem.assignee
            }
        })

        created++
        entities.push(entity)

        // Associate with meeting
        db.addMeetingEntity({
            meeting_id: meetingId,
            entity_id: entity.id,
            context: actionItem.description
        })
        linked++

        // If there's an assignee, find/create that person and link
        if (actionItem.assignee) {
            const assignee = db.findEntity('person', actionItem.assignee)
            if (assignee) {
                db.linkEntities({
                    source_entity_id: entity.id,
                    target_entity_id: assignee.id,
                    relationship: 'assigned_to',
                    meeting_id: meetingId
                })
                linked++
            } else {
                // Create the assignee as a person
                const newAssignee = db.upsertEntity({
                    type: 'person',
                    name: actionItem.assignee
                })
                db.linkEntities({
                    source_entity_id: entity.id,
                    target_entity_id: newAssignee.id,
                    relationship: 'assigned_to',
                    meeting_id: meetingId
                })
                created++
                linked++
            }
        }
    }

    // 4. Process Decisions
    for (const decision of extracted.decisions) {
        const entity = db.upsertEntity({
            type: 'decision',
            name: decision.description.substring(0, 100), // Truncate for name
            metadata: {
                full_description: decision.description,
                rationale: decision.rationale
            }
        })

        created++
        entities.push(entity)

        // Associate with meeting
        db.addMeetingEntity({
            meeting_id: meetingId,
            entity_id: entity.id,
            context: decision.rationale || decision.description
        })
        linked++
    }

    // 5. Process Projects
    if (extracted.projects) {
        for (const project of extracted.projects) {
            const existing = db.findEntity('project', project.name)
            const entity = db.upsertEntity({
                type: 'project',
                name: project.name,
                metadata: project.context ? { context: project.context } : undefined
            })

            if (existing) {
                updated++
            } else {
                created++
            }

            entities.push(entity)

            // Associate with meeting
            db.addMeetingEntity({
                meeting_id: meetingId,
                entity_id: entity.id,
                context: project.context
            })
            linked++

            // Link topics that might belong to this project (heuristic: same meeting)
            for (const topic of extracted.topics) {
                const topicEntity = db.findEntity('topic', topic.name)
                if (topicEntity) {
                    db.linkEntities({
                        source_entity_id: topicEntity.id,
                        target_entity_id: entity.id,
                        relationship: 'belongs_to',
                        meeting_id: meetingId,
                        confidence: 0.7 // Lower confidence since it's inferred
                    })
                    linked++
                }
            }
        }
    }

    console.log(`[EntityPipeline] Complete: ${created} created, ${updated} updated, ${linked} links`)

    return { created, updated, linked, entities }
}

/**
 * Extract and process entities from a transcript in one step
 */
export async function extractAndProcessEntities(
    provider: { extractEntities: (transcript: string) => Promise<ExtractedEntities> },
    transcript: string,
    meetingId: string
): Promise<ProcessedEntities> {
    console.log(`[EntityPipeline] Starting extraction for meeting ${meetingId}`)

    const extracted = await provider.extractEntities(transcript)
    return processExtractedEntities(extracted, meetingId)
}
