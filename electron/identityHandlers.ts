import type {
  IdentityProfileInput,
  IdentityUseCase,
} from '../src/types/identity';
import { getMeetingIdentityContext } from './commitmentIdentity';
import * as db from './db';

export const IDENTITY_CHANNELS = [
  'GET_IDENTITY_STATE',
  'SET_SELF_IDENTITY',
  'GET_MEETING_IDENTITY',
  'SET_MEETING_IDENTITY_BINDING',
  'CLEAR_MEETING_IDENTITY_BINDING',
  'RETRY_IDENTITY_RECONCILIATION',
  'SAVE_IDENTITY_PROFILE',
  'DISMISS_IDENTITY_PROFILE',
] as const;

const invalid = (field: string) => new Error(`identity_${field}_invalid`);

function payloadFields(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw invalid('payload');
  const payload = value as Record<string, unknown>;
  if (
    required.some((field) => !(field in payload)) ||
    Object.keys(payload).some(
      (field) => !required.includes(field) && !optional.includes(field),
    )
  )
    throw invalid('payload');
  return payload;
}

function id(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\p{Cc}]/u.test(value)
  )
    throw invalid(field);
  return value;
}

function requireRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalid('revision');
  if (db.identityStore.getRevision() !== value)
    throw new Error('identity_revision_stale');
  return value;
}

function selectedPerson(payload: Record<string, unknown>): string | null {
  if (Object.hasOwn(payload, 'personId') === Object.hasOwn(payload, 'newName'))
    throw invalid('person_selection');
  if ('personId' in payload) {
    if (payload.personId === null) return null;
    const personId = id(payload.personId, 'person');
    if (db.getEntity(personId)?.type !== 'person') throw invalid('person');
    return db.resolvePersonIdentityId(personId);
  }
  if (
    typeof payload.newName !== 'string' ||
    !payload.newName.trim() ||
    payload.newName.length > 256 ||
    /[\p{Cc}]/u.test(payload.newName)
  )
    throw invalid('person_name');
  return db.upsertEntity({
    type: 'person',
    name: payload.newName.trim(),
    dedupe_by_name: false,
  }).id;
}

function globalState() {
  const storedSelfPersonId = db.identityStore.getSelfPersonId();
  const selfPersonId = storedSelfPersonId
    ? db.resolvePersonIdentityId(storedSelfPersonId)
    : null;
  const profile = db.identityStore.getProfile();
  const self = selfPersonId ? db.getEntity(selfPersonId) : null;
  return {
    selfPersonId,
    people: db
      .getEntitiesByType('person')
      .map(({ id, name }) => ({ id, name })),
    revision: db.identityStore.getRevision(),
    profile: self ? { ...profile, preferredName: self.name } : profile,
  };
}

function profileText(value: unknown, limit: number): string {
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  )
    throw invalid('profile');
  return value.trim();
}

function parseProfile(payload: Record<string, unknown>): IdentityProfileInput {
  if (
    !Array.isArray(payload.aliases) ||
    payload.aliases.length > 12 ||
    !Array.isArray(payload.useCases) ||
    payload.useCases.length > 3
  )
    throw invalid('profile');
  const names = payload.aliases.map((value) => profileText(value, 200));
  if (
    names.some((name) => !name) ||
    payload.useCases.some(
      (value) => !['work', 'study', 'personal'].includes(value),
    )
  )
    throw invalid('profile');
  const seen = new Set<string>();
  const aliases = names.filter((name) => {
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    preferredName: profileText(payload.preferredName, 200),
    aliases,
    useCases: [...new Set(payload.useCases)] as IdentityUseCase[],
    role: profileText(payload.role, 160),
    industry: profileText(payload.industry, 160),
  };
}

function meetingContext(value: unknown) {
  const meetingId = id(value, 'meeting');
  if (!db.getMeeting(meetingId)) throw invalid('meeting');
  return getMeetingIdentityContext(meetingId);
}

function meetingState(meetingId: string) {
  const context = meetingContext(meetingId);
  return {
    ...globalState(),
    meetingId,
    speakers: [...new Set(context.turns.map((turn) => turn.speaker))],
    bindings: context.bindings,
    capture: context.capture,
    job: db.identityStore.getStatus(meetingId),
  };
}

/** Synchronous transactions ensure person creation, correction and queueing are atomic. */
export function handleIdentityRequest(channel: string, value: unknown) {
  if (channel === 'GET_IDENTITY_STATE') {
    payloadFields(value, []);
    return globalState();
  }
  if (channel === 'SAVE_IDENTITY_PROFILE') {
    const payload = payloadFields(value, [
      'expectedRevision',
      'preferredName',
      'aliases',
      'useCases',
      'role',
      'industry',
    ]);
    const profile = parseProfile(payload);
    return db.withCommitmentTransaction(() => {
      requireRevision(payload.expectedRevision);
      if (profile.preferredName) {
        const storedSelfPersonId = db.identityStore.getSelfPersonId();
        const selfPersonId = storedSelfPersonId
          ? db.resolvePersonIdentityId(storedSelfPersonId)
          : null;
        const person = selfPersonId
          ? db.updatePersonName(selfPersonId, profile.preferredName)
          : db.upsertEntity({
              type: 'person',
              name: profile.preferredName,
              dedupe_by_name: false,
            });
        db.identityStore.setSelfPersonId(person.id);
      } else db.identityStore.setSelfPersonId(null);
      db.identityStore.saveProfile({ ...profile, disposition: 'completed' });
      return globalState();
    });
  }
  if (channel === 'DISMISS_IDENTITY_PROFILE') {
    const payload = payloadFields(value, ['expectedRevision']);
    return db.withCommitmentTransaction(() => {
      requireRevision(payload.expectedRevision);
      db.identityStore.saveProfile({
        ...db.identityStore.getProfile(),
        disposition: 'dismissed',
      });
      return globalState();
    });
  }
  if (channel === 'SET_SELF_IDENTITY') {
    const payload = payloadFields(
      value,
      ['expectedRevision'],
      ['personId', 'newName'],
    );
    return db.withCommitmentTransaction(() => {
      requireRevision(payload.expectedRevision);
      db.identityStore.setSelfPersonId(selectedPerson(payload));
      return globalState();
    });
  }
  if (
    channel === 'GET_MEETING_IDENTITY' ||
    channel === 'RETRY_IDENTITY_RECONCILIATION'
  ) {
    const payload = payloadFields(value, ['meetingId']);
    const { meetingId } = meetingContext(payload.meetingId);
    if (channel === 'RETRY_IDENTITY_RECONCILIATION') {
      const job = db.identityStore.getStatus(meetingId);
      if (!job || !job.error || !['pending', 'failed'].includes(job.state))
        throw invalid('retry');
      db.identityStore.retryJob(meetingId);
    }
    return meetingState(meetingId);
  }
  if (
    channel === 'SET_MEETING_IDENTITY_BINDING' ||
    channel === 'CLEAR_MEETING_IDENTITY_BINDING'
  ) {
    const setting = channel === 'SET_MEETING_IDENTITY_BINDING';
    const payload = payloadFields(
      value,
      [
        'meetingId',
        'speaker',
        'expectedRevision',
        ...(setting ? ['individual'] : []),
      ],
      setting ? ['personId', 'newName'] : [],
    );
    return db.withCommitmentTransaction(() => {
      const expectedRevision = requireRevision(payload.expectedRevision);
      const context = meetingContext(payload.meetingId);
      const speaker = id(payload.speaker, 'speaker');
      if (!context.turns.some((turn) => turn.speaker === speaker))
        throw invalid('speaker');
      if (setting) {
        if (payload.individual !== true) throw invalid('individual');
        db.identityStore.setBinding(
          context.meetingId,
          {
            speaker,
            personId: selectedPerson(payload),
            individual: true,
            source: 'user',
            sourceRevision: context.sourceRevision,
            evidence: [],
          },
          expectedRevision,
        );
      } else {
        db.identityStore.clearBinding(
          context.meetingId,
          speaker,
          expectedRevision,
        );
      }
      return meetingState(context.meetingId);
    });
  }
  throw invalid('channel');
}
