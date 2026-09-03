import { createHash } from 'node:crypto';
import * as db from '../db';
import type { DreamingEntityNoteSource, Entity } from '../db';
import type {
  DreamingEntityType,
  DreamingInputPackage,
  DreamingMeetingNote,
} from './types';

const MAX_MEETINGS = 8;
const MAX_NOTE_WORDS = 1_600;

export interface PackageEntityNotesDeps {
  getEntity(id: string): Entity | null | undefined;
  resolvePersonIdentityId(id: string): string;
  resolveProjectIdentityId(id: string): string;
  getDreamingEntityNotes(
    entityId: string,
    limit: number,
  ): DreamingEntityNoteSource[];
  getDreamingEntityBaseline(entityId: string): Record<string, unknown>;
  getEntityCorrections(entityId: string): Array<{ fingerprint: string }>;
}

const noteContent = (source: DreamingEntityNoteSource): string =>
  [source.user_notes, source.enhanced_notes]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n\n')
    .trim();

const truncateToWords = (content: string, limit: number): string => {
  if (limit <= 0) return '';
  const matches = [...content.matchAll(/\S+/g)];
  if (matches.length <= limit) return content.trim();
  const last = matches[limit - 1];
  return content.slice(0, (last.index ?? 0) + last[0].length).trim();
};

const compareMeetingSources = (
  left: DreamingEntityNoteSource,
  right: DreamingEntityNoteSource,
): number => {
  const leftDate = left.started_at ?? left.created_at ?? '';
  const rightDate = right.started_at ?? right.created_at ?? '';
  return rightDate.localeCompare(leftDate) || right.id.localeCompare(left.id);
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

const computeSourceRevision = (input: {
  entityId: string;
  entityType: DreamingEntityType;
  meetings: DreamingMeetingNote[];
  currentBaseline: Record<string, unknown>;
  correctionFingerprints: string[];
}): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          entityId: input.entityId,
          entityType: input.entityType,
          meetings: input.meetings.map((meeting) => ({
            meetingId: meeting.meetingId,
            notesContent: meeting.notesContent,
          })),
          currentBaseline: input.currentBaseline,
          correctionFingerprints: input.correctionFingerprints,
        }),
      ),
    )
    .digest('hex');

export const packageEntityNotes = (
  entityId: string,
  deps?: Partial<PackageEntityNotesDeps>,
): DreamingInputPackage | null => {
  const getEntity = deps?.getEntity ?? db.getEntity;
  const sourceEntity = getEntity(entityId);
  if (!sourceEntity) return null;
  if (sourceEntity.type !== 'project' && sourceEntity.type !== 'person') {
    return null;
  }

  const canonicalId =
    sourceEntity.type === 'person'
      ? (deps?.resolvePersonIdentityId ?? db.resolvePersonIdentityId)(entityId)
      : (deps?.resolveProjectIdentityId ?? db.resolveProjectIdentityId)(
          entityId,
        );
  const entity =
    canonicalId === entityId ? sourceEntity : getEntity(canonicalId);
  if (!entity || (entity.type !== 'project' && entity.type !== 'person')) {
    return null;
  }

  const sources = (deps?.getDreamingEntityNotes ?? db.getDreamingEntityNotes)(
    canonicalId,
    MAX_MEETINGS,
  )
    .filter((source) => Boolean(noteContent(source)))
    .sort(compareMeetingSources)
    .slice(0, MAX_MEETINGS);
  const recentMeetingNotes: DreamingMeetingNote[] = [];
  let remainingWords = MAX_NOTE_WORDS;
  for (const source of sources) {
    const boundedContent = truncateToWords(noteContent(source), remainingWords);
    if (!boundedContent) break;
    const wordCount = boundedContent.match(/\S+/g)?.length ?? 0;
    recentMeetingNotes.push({
      meetingId: String(source.id),
      title: source.title || 'Untitled Meeting',
      startedAt: source.started_at ?? source.created_at ?? null,
      notesContent: boundedContent,
    });
    remainingWords -= wordCount;
    if (remainingWords === 0) break;
  }

  const currentBaseline = (
    deps?.getDreamingEntityBaseline ?? db.getDreamingEntityBaseline
  )(canonicalId);
  const correctionFingerprints = (
    deps?.getEntityCorrections ?? db.getEntityCorrections
  )(canonicalId)
    .map((correction) => correction.fingerprint.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  const entityType = entity.type as DreamingEntityType;
  const sourceRevision = computeSourceRevision({
    entityId: canonicalId,
    entityType,
    meetings: recentMeetingNotes,
    currentBaseline,
    correctionFingerprints,
  });

  return {
    entityId: canonicalId,
    entityType,
    entityName: entity.name,
    sourceRevision,
    currentBaseline,
    recentMeetingNotes,
    correctionFingerprints,
    negativeConstraints: correctionFingerprints,
  };
};
