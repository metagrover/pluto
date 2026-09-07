import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioKeyStore } from '../../electron/crypto/audioKeyStore';

describe('AudioKeyStore', () => {
  let sqlite: Database.Database;
  let wrappingKey: Buffer;
  let store: AudioKeyStore;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    wrappingKey = randomBytes(32);
    store = new AudioKeyStore({ sqlite, audioWrappingKey: wrappingKey });
  });

  it('creates and securely wraps a per-meeting key', () => {
    expect(store.getMeetingAudioKey('m1')).toBeNull();

    const created = store.getOrCreateMeetingAudioKey('m1');
    expect(created.meetingKey).toHaveLength(32);
    expect(created.keyId).toBeDefined();

    // Verify row exists and wrapped key is NOT stored in plaintext
    const row = sqlite
      .prepare(
        'SELECT wrapped_key FROM meeting_audio_keys WHERE meeting_id = ?',
      )
      .get('m1') as { wrapped_key: string };
    expect(row).toBeDefined();
    expect(
      Buffer.from(row.wrapped_key, 'base64').equals(created.meetingKey),
    ).toBe(false);

    // Read back
    const reloaded = store.getMeetingAudioKey('m1');
    expect(reloaded).not.toBeNull();
    expect(reloaded?.meetingKey.equals(created.meetingKey)).toBe(true);
    expect(reloaded?.keyId).toBe(created.keyId);
  });

  it('maintains key isolation across different meetings', () => {
    const key1 = store.getOrCreateMeetingAudioKey('meeting-1');
    const key2 = store.getOrCreateMeetingAudioKey('meeting-2');

    expect(key1.meetingKey.equals(key2.meetingKey)).toBe(false);
    expect(key1.keyId).not.toBe(key2.keyId);
  });

  it('fails authentication if wrapped ciphertext or tag is modified', () => {
    store.getOrCreateMeetingAudioKey('m-tamper');

    // Modify the tag
    sqlite
      .prepare(
        "UPDATE meeting_audio_keys SET tag = 'AAAA' WHERE meeting_id = 'm-tamper'",
      )
      .run();

    expect(() => store.getMeetingAudioKey('m-tamper')).toThrow(
      /Failed to unwrap/,
    );
  });

  it('deletes meeting keys cleanly', () => {
    store.getOrCreateMeetingAudioKey('m-del');
    expect(store.getMeetingAudioKey('m-del')).not.toBeNull();

    const deleted = store.deleteMeetingAudioKey('m-del');
    expect(deleted).toBe(true);
    expect(store.getMeetingAudioKey('m-del')).toBeNull();
  });
});
