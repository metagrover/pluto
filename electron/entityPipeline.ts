/**
 * Entity Extraction Pipeline
 *
 * Processes LLM-extracted entities and stores them in the knowledge graph.
 * Handles entity resolution, relationship creation, and meeting associations.
 */

import { EntityExtractionContext, ExtractedEntities } from './llm/provider';
import * as db from './db';
import levenshtein from 'fast-levenshtein';

export interface ProcessedEntities {
  created: number;
  updated: number;
  linked: number;
  entities: db.Entity[];
}

const NON_PERSON_LABELS = new Set([
  'me',
  'them',
  'you',
  'i',
  'myself',
  'speaker',
]);

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const getRelationshipBias = (
  context: EntityExtractionContext | undefined,
  relationship: string,
): number => {
  const raw = context?.priorityHints?.relationship_bias?.[relationship];
  if (typeof raw !== 'number' || Number.isNaN(raw)) {
    return 0;
  }
  return clamp(raw, -0.2, 0.3);
};

/**
 * Normalized string for comparison (alphanumeric only)
 */
export function normalizeForMatch(str: string | null | undefined): string {
  if (typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
    .trim();
}

/**
 * Tokenize and sort string for bag-of-words comparison
 * e.g. "Project Alpha" -> "alpha project"
 */
export function normalizeTokenSort(str: string | null | undefined): string {
  if (typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
    .split(/\s+/)
    .sort()
    .join(' ')
    .trim();
}

function isPersonGroundedInTranscript(
  name: string,
  transcript: string,
): boolean {
  const normalizedName = normalizeForMatch(name);
  if (!normalizedName || NON_PERSON_LABELS.has(normalizedName)) {
    return false;
  }

  const normalizedTranscript = normalizeForMatch(transcript);
  if (!normalizedTranscript) {
    return false;
  }

  if (normalizedTranscript.includes(normalizedName)) {
    return true;
  }

  // Fallback: all meaningful tokens must be present in transcript words
  const transcriptTokens = new Set(
    normalizedTranscript.split(/\s+/).filter(Boolean),
  );
  const nameTokens = normalizedName
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  if (nameTokens.length === 0) {
    return false;
  }

  return nameTokens.every((token) => transcriptTokens.has(token));
}

function filterUngroundedPeople(
  people: ExtractedEntities['people'],
  transcript: string,
): ExtractedEntities['people'] {
  const grounded: ExtractedEntities['people'] = [];
  for (const person of people) {
    if (!person?.name || typeof person.name !== 'string') continue;
    if (isPersonGroundedInTranscript(person.name, transcript)) {
      grounded.push(person);
      continue;
    }
    console.log(
      `[EntityPipeline] Dropping ungrounded person entity "${person.name}" (not supported by transcript text)`,
    );
  }
  return grounded;
}

/**
 * Find a similar entity using fuzzy matching
 * Returns the best match if it exceeds the similarity threshold
 */
export function findSimilarEntity(
  type: db.EntityType,
  name: string,
  existingEntities: db.Entity[],
  threshold = 0.85,
): db.Entity | undefined {
  const normalizedTarget = normalizeForMatch(name);
  const sortedTarget = normalizeTokenSort(name);
  if (!normalizedTarget || !sortedTarget) return undefined;

  let bestMatch: db.Entity | undefined;
  let highCharScore = 0;

  for (const entity of existingEntities) {
    if (entity.type !== type) continue;

    const normalizedSource = normalizeForMatch(entity.name);
    const sortedSource = normalizeTokenSort(entity.name);
    if (!normalizedSource || !sortedSource) continue;

    // 1. Token Sort Match (handles "Project Alpha" vs "Alpha Project")
    if (sortedTarget === sortedSource) {
      return entity; // High confidence match
    }

    // 2. Direct Substring Match (handles "Sarah" vs "Sarah Chen")
    // We require the shorter string to be at least 4 chars to avoid matching "Sam" to "Samantha" too eagerly if unwanted,
    // but generally for names it's okay.
    if (normalizedTarget.length > 3 && normalizedSource.length > 3) {
      if (
        normalizedSource.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedSource)
      ) {
        // Return immediately or treat as very high score?
        // Let's treat as very high confidence 0.95
        if (0.95 > highCharScore) {
          highCharScore = 0.95;
          bestMatch = entity;
        }
        continue;
      }
    }

    // 3. Levenshtein Distance (typos)
    const distance = levenshtein.get(normalizedTarget, normalizedSource);
    const maxLength = Math.max(
      normalizedTarget.length,
      normalizedSource.length,
    );
    const similarity = 1 - distance / maxLength;

    if (similarity >= threshold) {
      if (similarity > highCharScore) {
        highCharScore = similarity;
        bestMatch = entity;
      }
    }
  }

  // Special handling for People: Acronyms or First/Last name logic could go here
  // For now, relies on high similarity or exact substring via normalization

  return bestMatch;
}

/**
 * Parse natural language due dates into ISO date strings
 * This is a simple implementation - could be enhanced with a date parsing library
 */
export function parseDueDate(dueDate: string): string | null {
  if (!dueDate || typeof dueDate !== 'string') return null;

  const now = new Date();
  const lower = dueDate.toLowerCase().trim();

  // Handle common patterns
  if (lower === 'today') {
    return now.toISOString();
  }
  if (lower === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString();
  }
  if (lower === 'next week' || lower === 'by next week') {
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek.toISOString();
  }
  if (lower === 'end of week' || lower === 'eow') {
    const eow = new Date(now);
    const daysUntilFriday = (5 - eow.getDay() + 7) % 7 || 7;
    eow.setDate(eow.getDate() + daysUntilFriday);
    return eow.toISOString();
  }

  // Handle day names (e.g., "by Friday", "on Monday")
  const dayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  for (let i = 0; i < dayNames.length; i++) {
    if (lower.includes(dayNames[i])) {
      const target = new Date(now);
      const daysUntil = (i - target.getDay() + 7) % 7 || 7;
      target.setDate(target.getDate() + daysUntil);
      return target.toISOString();
    }
  }

  // Try to parse as a date directly
  try {
    const parsed = new Date(dueDate);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

/**
 * Determine if an entity should be updated with a new name (Enrichment)
 * e.g. "Sarah" -> "Sarah Chen" is an enrichment
 */
export function shouldEnrichEntity(
  existingName: string,
  newName: string,
): boolean {
  const normalizedExisting = normalizeForMatch(existingName);
  const normalizedNew = normalizeForMatch(newName);
  if (!normalizedExisting || !normalizedNew) return false;

  // Using length as a heuristic for "more complete"
  // Only if the shorter one is effectively a substring/part of the longer one
  if (
    normalizedNew.includes(normalizedExisting) &&
    newName.length > existingName.length
  ) {
    return true;
  }
  return false;
}

/**
 * Process extracted entities and store them in the knowledge graph
 */
export async function processExtractedEntities(
  extracted: ExtractedEntities,
  meetingId: string,
  context?: EntityExtractionContext,
  transcriptForGrounding?: string,
): Promise<ProcessedEntities> {
  let created = 0;
  let updated = 0;
  let linked = 0;
  const entities: db.Entity[] = [];

  console.log(`[EntityPipeline] Processing entities for meeting ${meetingId}`);
  console.log(
    `[EntityPipeline] Found: ${extracted.people.length} people, ${extracted.topics.length} topics, ${extracted.action_items.length} action items, ${extracted.decisions.length} decisions`,
  );

  // Load existing entities for resolution
  const existingPeople = db.getEntitiesByType('person');
  const existingTopics = db.getEntitiesByType('topic');
  const existingProjects = db.getEntitiesByType('project');

  // 1. Process People
  for (const person of extracted.people) {
    if (!person?.name || typeof person.name !== 'string') continue;
    // Try to find a match
    const similar = findSimilarEntity(
      'person',
      person.name,
      existingPeople,
      0.82,
    );
    let entity: db.Entity;

    if (similar) {
      console.log(
        `[EntityPipeline] Resolved "${person.name}" to existing "${similar.name}"`,
      );

      // Enrichment logic
      if (shouldEnrichEntity(similar.name, person.name)) {
        console.log(
          `[EntityPipeline] Upgrading name "${similar.name}" -> "${person.name}"`,
        );
        entity = db.upsertEntity({
          ...similar, // Keep id
          name: person.name, // Update name
          metadata: person.role
            ? { ...JSON.parse(similar.metadata || '{}'), role: person.role }
            : undefined,
        });
        updated++;
      } else {
        entity = similar;
        // Still might want to update metadata if missing role
        if (person.role && !JSON.parse(similar.metadata || '{}').role) {
          entity = db.upsertEntity({
            ...similar,
            metadata: {
              ...JSON.parse(similar.metadata || '{}'),
              role: person.role,
            },
          });
          updated++;
        }
      }
    } else {
      // New entity
      entity = db.upsertEntity({
        type: 'person',
        name: person.name,
        metadata: person.role ? { role: person.role } : undefined,
      });
      created++;
      // Add to cache for next iterations in this loop
      existingPeople.push(entity);
    }

    entities.push(entity);

    // Associate with meeting
    db.addMeetingEntity({
      meeting_id: meetingId,
      entity_id: entity.id,
      context: person.role ? `Role: ${person.role}` : undefined,
    });
    linked++;
  }

  // 2. Process Topics
  for (const topic of extracted.topics) {
    if (!topic?.name || typeof topic.name !== 'string') continue;
    const similar = findSimilarEntity(
      'topic',
      topic.name,
      existingTopics,
      0.85,
    );
    let entity: db.Entity;

    if (similar) {
      // Use existing
      entity = similar;
      // Update importance if current is high and existing wasn't?
      // Logic: Keep existing metadata mostly, unless we want to merge.
      // For topics, just linking is usually enough.
      updated++;
    } else {
      entity = db.upsertEntity({
        type: 'topic',
        name: topic.name,
        metadata: { importance: topic.importance },
      });
      created++;
      existingTopics.push(entity);
    }

    entities.push(entity);

    // Associate with meeting
    db.addMeetingEntity({
      meeting_id: meetingId,
      entity_id: entity.id,
      context: `Importance: ${topic.importance}`,
    });
    linked++;
  }

  // 3. Process Action Items
  for (const actionItem of extracted.action_items) {
    if (!actionItem?.description || typeof actionItem.description !== 'string')
      continue;
    // Action items are always created fresh (not deduplicated by name)
    const dueDate = parseDueDate(actionItem.due_date || '');

    const entity = db.upsertEntity({
      type: 'action_item',
      name: actionItem.description.substring(0, 100), // Truncate for name
      status: 'active',
      due_date: dueDate,
      metadata: {
        full_description: actionItem.description,
        assignee_name: actionItem.assignee,
      },
    });

    created++;
    entities.push(entity);

    // Associate with meeting
    db.addMeetingEntity({
      meeting_id: meetingId,
      entity_id: entity.id,
      context: actionItem.description,
    });
    linked++;

    // If there's an assignee, find/create that person and link
    if (actionItem.assignee) {
      if (
        transcriptForGrounding &&
        !isPersonGroundedInTranscript(
          actionItem.assignee,
          transcriptForGrounding,
        )
      ) {
        console.log(
          `[EntityPipeline] Skipping ungrounded assignee "${actionItem.assignee}" for action item`,
        );
        continue;
      }
      // Use our fuzzy finder on the already-loaded/updated list
      const assigneeName = actionItem.assignee;
      const assigneeStart = db.findEntity('person', assigneeName); // Try exact first
      let assignee = assigneeStart;

      if (!assignee) {
        // Try fuzzy
        assignee = findSimilarEntity(
          'person',
          assigneeName,
          existingPeople,
          0.82,
        );
      }

      if (assignee) {
        const confidence = clamp(
          0.9 + getRelationshipBias(context, 'assigned_to'),
          0.5,
          0.98,
        );
        db.linkEntities({
          source_entity_id: entity.id,
          target_entity_id: assignee.id,
          relationship: 'assigned_to',
          meeting_id: meetingId,
          confidence,
        });
        linked++;
      } else {
        // Create the assignee as a person
        const newAssignee = db.upsertEntity({
          type: 'person',
          name: assigneeName,
        });
        existingPeople.push(newAssignee); // Update cache

        const confidence = clamp(
          0.9 + getRelationshipBias(context, 'assigned_to'),
          0.5,
          0.98,
        );
        db.linkEntities({
          source_entity_id: entity.id,
          target_entity_id: newAssignee.id,
          relationship: 'assigned_to',
          meeting_id: meetingId,
          confidence,
        });
        created++;
        linked++;
      }
    }
  }

  // 4. Process Decisions
  for (const decision of extracted.decisions) {
    if (!decision?.description || typeof decision.description !== 'string')
      continue;
    const entity = db.upsertEntity({
      type: 'decision',
      name: decision.description.substring(0, 100), // Truncate for name
      metadata: {
        full_description: decision.description,
        rationale: decision.rationale,
      },
    });

    created++;
    entities.push(entity);

    // Associate with meeting
    db.addMeetingEntity({
      meeting_id: meetingId,
      entity_id: entity.id,
      context: decision.rationale || decision.description,
    });
    linked++;
  }

  // 5. Process Projects
  if (extracted.projects) {
    for (const project of extracted.projects) {
      if (!project?.name || typeof project.name !== 'string') continue;
      const similar = findSimilarEntity(
        'project',
        project.name,
        existingProjects,
        0.8,
      );
      let entity: db.Entity;

      if (similar) {
        entity = similar;
        if (project.context && !JSON.parse(similar.metadata || '{}').context) {
          // enrich context
          db.upsertEntity({
            ...similar,
            metadata: {
              ...JSON.parse(similar.metadata || '{}'),
              context: project.context,
            },
          });
        }
        updated++;
      } else {
        entity = db.upsertEntity({
          type: 'project',
          name: project.name,
          metadata: project.context ? { context: project.context } : undefined,
        });
        created++;
        existingProjects.push(entity);
      }

      entities.push(entity);

      // Associate with meeting
      db.addMeetingEntity({
        meeting_id: meetingId,
        entity_id: entity.id,
        context: project.context,
      });
      linked++;

      // Link topics that might belong to this project (heuristic: same meeting)
      for (const topic of extracted.topics) {
        // We need to find the specific topic entity we worked with/created above
        // We can't just findByName because we might have resolved it to a different name
        // So we search in our local 'entities' array or just re-resolve
        const topicEntity = findSimilarEntity(
          'topic',
          topic.name,
          existingTopics,
          0.9,
        ); // Strong match since we just processed it

        if (topicEntity) {
          const confidence = clamp(
            0.7 + getRelationshipBias(context, 'belongs_to'),
            0.5,
            0.95,
          );
          db.linkEntities({
            source_entity_id: topicEntity.id,
            target_entity_id: entity.id,
            relationship: 'belongs_to',
            meeting_id: meetingId,
            confidence, // Lower confidence since it's inferred
          });
          linked++;
        }
      }
    }
  }

  // 6. Process Explicit Relationships
  if (extracted.relationships) {
    for (const rel of extracted.relationships) {
      if (
        !rel ||
        typeof rel.source !== 'string' ||
        typeof rel.target !== 'string'
      )
        continue;
      // Find Source
      let sourceEntity: db.Entity | undefined;
      // Try to find source in our just-processed list first (most likely context)
      // But we don't know the type. So we have to search our 'entities' accumulator.
      // Problem: 'entities' array has resolved objects.

      // Heuristic A: Try to find match in 'entities' accumulator
      // This is O(N) but N is small (entities in this meeting)
      const sourceMatch = entities.find(
        (e) =>
          normalizeForMatch(e.name) === normalizeForMatch(rel.source) ||
          normalizeTokenSort(e.name) === normalizeTokenSort(rel.source),
      );

      if (sourceMatch) {
        sourceEntity = sourceMatch;
      } else {
        // Heuristic B: Search standard types in DB
        // We don't know the type, so we might need to search globally or guess.
        // Let's try Person, Project, Topic in that order.
        sourceEntity =
          findSimilarEntity('person', rel.source, existingPeople, 0.85) ||
          findSimilarEntity('project', rel.source, existingProjects, 0.85) ||
          findSimilarEntity('topic', rel.source, existingTopics, 0.85);
      }

      // Find Target
      let targetEntity: db.Entity | undefined;
      const targetMatch = entities.find(
        (e) =>
          normalizeForMatch(e.name) === normalizeForMatch(rel.target) ||
          normalizeTokenSort(e.name) === normalizeTokenSort(rel.target),
      );

      if (targetMatch) {
        targetEntity = targetMatch;
      } else {
        targetEntity =
          findSimilarEntity('person', rel.target, existingPeople, 0.85) ||
          findSimilarEntity('project', rel.target, existingProjects, 0.85) ||
          findSimilarEntity('topic', rel.target, existingTopics, 0.85);
      }

      if (
        transcriptForGrounding &&
        sourceEntity?.type === 'person' &&
        !isPersonGroundedInTranscript(rel.source, transcriptForGrounding)
      ) {
        console.log(
          `[EntityPipeline] Skipping ungrounded relationship source "${rel.source}"`,
        );
        sourceEntity = undefined;
      }

      if (
        transcriptForGrounding &&
        targetEntity?.type === 'person' &&
        !isPersonGroundedInTranscript(rel.target, transcriptForGrounding)
      ) {
        console.log(
          `[EntityPipeline] Skipping ungrounded relationship target "${rel.target}"`,
        );
        targetEntity = undefined;
      }

      if (sourceEntity && targetEntity) {
        // Validate relationship type
        const validTypes = [
          'works_on',
          'impacts',
          'relates_to',
          'involved_in',
          'produced',
          'assigned_to',
        ];
        const relationship = validTypes.includes(rel.relationship)
          ? rel.relationship
          : 'relates_to';
        const confidence = clamp(
          0.85 + getRelationshipBias(context, relationship),
          0.5,
          0.98,
        );

        db.linkEntities({
          source_entity_id: sourceEntity.id,
          target_entity_id: targetEntity.id,
          relationship: relationship as any,
          meeting_id: meetingId,
          confidence,
        });
        linked++;
        console.log(
          `[EntityPipeline] Linked "${sourceEntity.name}" -> [${relationship}] -> "${targetEntity.name}"`,
        );
      } else {
        console.log(
          `[EntityPipeline] Could not link "${rel.source}" to "${rel.target}" - entity not found`,
        );
      }
    }
  }

  console.log(
    `[EntityPipeline] Complete: ${created} created, ${updated} updated, ${linked} links`,
  );

  return { created, updated, linked, entities };
}

/**
 * Extract and process entities from a transcript in one step
 */
export async function extractAndProcessEntities(
  provider: {
    extractEntities: (
      transcript: string,
      context?: EntityExtractionContext,
    ) => Promise<ExtractedEntities>;
  },
  transcript: string,
  meetingId: string,
  context?: EntityExtractionContext,
): Promise<ProcessedEntities> {
  console.log(`[EntityPipeline] Starting extraction for meeting ${meetingId}`);

  const extracted = await provider.extractEntities(transcript, context);
  const groundedExtraction: ExtractedEntities = {
    ...extracted,
    people: filterUngroundedPeople(extracted.people || [], transcript),
  };
  return processExtractedEntities(
    groundedExtraction,
    meetingId,
    context,
    transcript,
  );
}
