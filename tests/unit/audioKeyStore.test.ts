import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioKeyStore } from '../../electron/crypto/audioKeyStore';

describe('AudioKeyStore', () => {
  let db: Database.Database;
  let wrappingKey: Buffer;

  beforeEach(() => {
    db = new Database(':memory:');
    wrappingKey = randomBytes(32);
  });

  it('generates, wraps, and recovers meeting audio keys', () => {
    const store = new AudioKeyStore({
      sqlite: db,
      audioWrappingKey: wrappingKey,
    });

    const result = store.getOrCreateMeetingAudioKey('meeting-1');
    expect(result.meetingKey).toHaveLength(32);
    expect(result.keyId).toBeDefined();

    // Re-reading should yield identical meeting key
    const recovered = store.getMeetingAudioKey('meeting-1');
    expect(recovered).not.toBeNull();
    expect(recovered!.meetingKey.equals(result.meetingKey)).toBe(true);
    expect(recovered!.keyId).toBe(result.keyId);
  });

  it('fails closed when wrong wrapping key is provided', () => {
    const store1 = new AudioKeyStore({
      sqlite: db,
      audioWrappingKey: wrappingKey,
    });
    store1.getOrCreateMeetingAudioKey('meeting-1');

    const wrongWrappingKey = randomBytes(32);
    const store2 = new AudioKeyStore({
      sqlite: db,
      audioWrappingKey: wrongWrappingKey,
    });

    expect(() => store2.getMeetingAudioKey('meeting-1')).toThrow(
      /Failed to unwrap meeting audio key/,
    );
  });

  it('deletes meeting audio key and returns false for nonexistent key', () => {
    const store = new AudioKeyStore({
      sqlite: db,
      audioWrappingKey: wrappingKey,
    });
    store.getOrCreateMeetingAudioKey('meeting-1');

    expect(store.deleteMeetingAudioKey('meeting-1')).toBe(true);
    expect(store.getMeetingAudioKey('meeting-1')).toBeNull();
    expect(store.deleteMeetingAudioKey('meeting-1')).toBe(false);
  });
});
