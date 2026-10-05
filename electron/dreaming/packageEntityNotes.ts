import { createHash } from 'node:crypto';
import { normalizeEvidenceText } from '../../src/utils/evidenceText';
import * as db from '../db';
import type { DreamingEntityNoteSource, Entity } from '../db';
import type {
  DreamingEntityType,
  DreamingInputPackage,
  DreamingMeetingNote,
} from './types';

const MAX_MEETINGS = 8;
const MAX_NOTE_WORDS = 1_600;
const MAX_NOTE_PROCESSING_CHARACTERS = 65_536;
const MAX_NOTE_PROCESSING_BYTES = 65_536;
const MAX_BASELINE_TEXT_CHARACTERS = 512;
const MAX_BASELINE_TOTAL_TEXT_CHARACTERS = 6_000;
const MAX_BASELINE_NODES = 64;
const MAX_BASELINE_DEPTH = 4;
const MAX_CORRECTIONS = 64;
const MAX_CORRECTION_CHARACTERS = 128;
const MAX_LABEL_CHARACTERS = 256;

export interface PackageEntityNotesDeps {
  getEntity(id: string): Entity | null | undefined;
  resolvePersonIdentityId(id: string): string;
  resolveProjectIdentityId(id: string): string;
  getDreamingEntityNotes(
    entityId: string,
    limit: number,
  ): DreamingEntityNoteSource[];
  getDreamingEntityBaseline(entityId: string): Record<string, unknown>;
  getDreamingEntityCorrections(entityId: string): Array<{
    fingerprint: string;
  }>;
}

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const boundUtf8 = (
  value: string,
  maxCharacters: number,
  maxBytes: number,
): string => {
  const characterBounded = value.slice(0, maxCharacters);
  const encoded = Buffer.from(characterBounded, 'utf8');
  if (encoded.byteLength <= maxBytes) return characterBounded;
  return encoded.subarray(0, maxBytes).toString('utf8').replace(/�$/, '');
};

const boundLabel = (value: string): string =>
  boundUtf8(value, MAX_LABEL_CHARACTERS, MAX_LABEL_CHARACTERS).trim();

const noteContent = (source: DreamingEntityNoteSource): string => {
  const content = [source.user_notes, source.enhanced_notes]
    .flatMap((value) =>
      typeof value === 'string'
        ? [
            boundUtf8(
              value,
              MAX_NOTE_PROCESSING_CHARACTERS,
              MAX_NOTE_PROCESSING_BYTES,
            ).trim(),
          ]
        : [],
    )
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return boundUtf8(
    content,
    MAX_NOTE_PROCESSING_CHARACTERS,
    MAX_NOTE_PROCESSING_BYTES,
  ).trim();
};

const savedActionItems = (
  source: DreamingEntityNoteSource,
  notes: string,
): string[] => {
  if (
    !source.action_items_json ||
    source.action_items_json.length > MAX_NOTE_PROCESSING_CHARACTERS
  )
    return [];
  try {
    const parsed: unknown = JSON.parse(source.action_items_json);
    if (!Array.isArray(parsed)) return [];
    const normalizedNotes = normalizeEvidenceText(notes);
    return [
      ...new Set(
        parsed.flatMap((item) => {
          const text = item && typeof item === 'object' ? item.text : null;
          return typeof text === 'string' &&
            text.trim() &&
            text.length <= MAX_BASELINE_TEXT_CHARACTERS &&
            normalizedNotes.includes(normalizeEvidenceText(text))
            ? [text.trim()]
            : [];
        }),
      ),
    ].slice(0, 20);
  } catch {
    return [];
  }
};

const truncateToWords = (content: string, limit: number): string => {
  if (limit <= 0) return '';
  let words = 0;
  let inWord = false;
  for (let index = 0; index < content.length; index += 1) {
    if (/\s/.test(content[index])) {
      inWord = false;
    } else if (!inWord) {
      words += 1;
      inWord = true;
      if (words > limit) return content.slice(0, index).trim();
    }
  }
  return content.trim();
};

const countWords = (content: string): number => {
  let words = 0;
  let inWord = false;
  for (let index = 0; index < content.length; index += 1) {
    if (/\s/.test(content[index])) inWord = false;
    else if (!inWord) {
      words += 1;
      inWord = true;
    }
  }
  return words;
};

const compareMeetingSources = (
  left: DreamingEntityNoteSource,
  right: DreamingEntityNoteSource,
): number => {
  const leftDate = left.started_at ?? left.created_at ?? '';
  const rightDate = right.started_at ?? right.created_at ?? '';
  return (
    compareCodeUnits(rightDate, leftDate) ||
    compareCodeUnits(String(right.id), String(left.id))
  );
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

const boundBaseline = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const budget = {
    textCharacters: MAX_BASELINE_TOTAL_TEXT_CHARACTERS,
    nodes: MAX_BASELINE_NODES,
  };
  const visit = (item: unknown, depth: number): unknown => {
    if (budget.nodes <= 0 || depth > MAX_BASELINE_DEPTH) return null;
    budget.nodes -= 1;
    if (typeof item === 'string') {
      const limit = Math.min(
        MAX_BASELINE_TEXT_CHARACTERS,
        budget.textCharacters,
      );
      const bounded = boundUtf8(item, limit, limit);
      budget.textCharacters -= bounded.length;
      return bounded;
    }
    if (typeof item === 'number') return Number.isFinite(item) ? item : null;
    if (typeof item === 'boolean' || item === null) return item;
    if (Array.isArray(item)) {
      const bounded: unknown[] = [];
      for (const child of item) {
        if (budget.nodes <= 0) break;
        bounded.push(visit(child, depth + 1));
      }
      return bounded;
    }
    if (item && typeof item === 'object') {
      const bounded: Record<string, unknown> = {};
      const entries: Array<[string, unknown]> = [];
      for (const key in item as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        entries.push([key, (item as Record<string, unknown>)[key]]);
        if (entries.length >= budget.nodes) break;
      }
      entries.sort(([left], [right]) => compareCodeUnits(left, right));
      for (const [key, child] of entries) {
        if (budget.nodes <= 0) break;
        bounded[boundLabel(key)] = visit(child, depth + 1);
      }
      return bounded;
    }
    return null;
  };
  return visit(value, 0) as Record<string, unknown>;
};

const computeSourceRevision = (input: {
  entityId: string;
  entityType: DreamingEntityType;
  entityName: string;
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
          entityName: input.entityName,
          meetings: input.meetings,
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
  let remainingNoteCharacters = MAX_NOTE_PROCESSING_CHARACTERS;
  let remainingNoteBytes = MAX_NOTE_PROCESSING_BYTES;
  for (const source of sources) {
    const packageBoundedContent = boundUtf8(
      noteContent(source),
      remainingNoteCharacters,
      remainingNoteBytes,
    );
    const boundedContent = truncateToWords(
      packageBoundedContent,
      remainingWords,
    );
    if (!boundedContent) break;
    const wordCount = countWords(boundedContent);
    const actionItems =
      entity.type === 'project' ? savedActionItems(source, boundedContent) : [];
    recentMeetingNotes.push({
      meetingId: boundLabel(String(source.id)),
      title: boundLabel(source.title || 'Untitled Meeting'),
      startedAt:
        boundLabel(source.started_at ?? source.created_at ?? '') || null,
      notesContent: boundedContent,
      ...(actionItems.length ? { actionItems } : {}),
    });
    remainingWords -= wordCount;
    remainingNoteCharacters -= boundedContent.length;
    remainingNoteBytes -= Buffer.byteLength(boundedContent, 'utf8');
    if (
      remainingWords === 0 ||
      remainingNoteCharacters === 0 ||
      remainingNoteBytes === 0
    ) {
      break;
    }
  }

  const currentBaseline = boundBaseline(
    (deps?.getDreamingEntityBaseline ?? db.getDreamingEntityBaseline)(
      canonicalId,
    ),
  );
  const correctionFingerprints = [
    ...new Set(
      (deps?.getDreamingEntityCorrections ?? db.getDreamingEntityCorrections)(
        canonicalId,
      )
        .map((correction) =>
          boundUtf8(
            correction.fingerprint.slice(0, MAX_CORRECTION_CHARACTERS * 4),
            MAX_CORRECTION_CHARACTERS,
            MAX_CORRECTION_CHARACTERS,
          )
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  ]
    .sort(compareCodeUnits)
    .slice(0, MAX_CORRECTIONS);
  const entityType = entity.type as DreamingEntityType;
  const entityName = boundLabel(entity.name);
  const sourceRevision = computeSourceRevision({
    entityId: canonicalId,
    entityType,
    entityName,
    meetings: recentMeetingNotes,
    currentBaseline,
    correctionFingerprints,
  });

  return {
    entityId: canonicalId,
    entityType,
    entityName,
    sourceRevision,
    currentBaseline,
    recentMeetingNotes,
    correctionFingerprints,
    negativeConstraints: correctionFingerprints,
  };
};
