import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type Database from 'better-sqlite3-multiple-ciphers';

export interface MeetingAudioKeyResult {
  meetingKey: Buffer; // 32 bytes
  keyId: string;
}

export interface AudioKeyStoreOptions {
  sqlite: Database.Database;
  audioWrappingKey: Buffer; // 32 bytes derived from master key
}

export class AudioKeyStore {
  private readonly sqlite: Database.Database;
  private readonly wrappingKey: Buffer;

  constructor(options: AudioKeyStoreOptions) {
    if (options.audioWrappingKey.length !== 32) {
      throw new Error(
        `Invalid audioWrappingKey length: ${options.audioWrappingKey.length}`,
      );
    }
    this.sqlite = options.sqlite;
    this.wrappingKey = options.audioWrappingKey;
    this.initTable();
  }

  private initTable() {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS meeting_audio_keys (
        meeting_id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        wrapped_key TEXT NOT NULL,
        nonce TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
    `);
  }

  getMeetingAudioKey(meetingId: string): MeetingAudioKeyResult | null {
    const row = this.sqlite
      .prepare(
        'SELECT key_id, algorithm, wrapped_key, nonce, tag FROM meeting_audio_keys WHERE meeting_id = ?',
      )
      .get(meetingId) as
      | {
          key_id: string;
          algorithm: string;
          wrapped_key: string;
          nonce: string;
          tag: string;
        }
      | undefined;

    if (!row) return null;

    if (row.algorithm !== 'AES-256-GCM') {
      throw new Error(`Unsupported audio key algorithm: ${row.algorithm}`);
    }

    try {
      const nonce = Buffer.from(row.nonce, 'base64');
      const tag = Buffer.from(row.tag, 'base64');
      const wrapped = Buffer.from(row.wrapped_key, 'base64');
      const aad = Buffer.from(`${meetingId}:${row.key_id}`, 'utf8');

      const decipher = createDecipheriv('aes-256-gcm', this.wrappingKey, nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const meetingKey = Buffer.concat([
        decipher.update(wrapped),
        decipher.final(),
      ]);

      if (meetingKey.length !== 32) {
        throw new Error(
          `Invalid unwrapped meeting key length: ${meetingKey.length}`,
        );
      }

      return {
        meetingKey,
        keyId: row.key_id,
      };
    } catch (error) {
      throw new Error(
        `Failed to unwrap meeting audio key for meeting ${meetingId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getOrCreateMeetingAudioKey(meetingId: string): MeetingAudioKeyResult {
    const existing = this.getMeetingAudioKey(meetingId);
    if (existing) return existing;

    const meetingKey = randomBytes(32);
    const keyId = randomUUID();
    const nonce = randomBytes(12);
    const aad = Buffer.from(`${meetingId}:${keyId}`, 'utf8');

    const cipher = createCipheriv('aes-256-gcm', this.wrappingKey, nonce);
    cipher.setAAD(aad);
    const wrapped = Buffer.concat([cipher.update(meetingKey), cipher.final()]);
    const tag = cipher.getAuthTag();

    const createdAtMs = Date.now();
    this.sqlite
      .prepare(
        `INSERT INTO meeting_audio_keys (
          meeting_id, key_id, algorithm, wrapped_key, nonce, tag, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meetingId,
        keyId,
        'AES-256-GCM',
        wrapped.toString('base64'),
        nonce.toString('base64'),
        tag.toString('base64'),
        createdAtMs,
      );

    return {
      meetingKey,
      keyId,
    };
  }

  deleteMeetingAudioKey(meetingId: string): boolean {
    const result = this.sqlite
      .prepare('DELETE FROM meeting_audio_keys WHERE meeting_id = ?')
      .run(meetingId);
    return result.changes > 0;
  }
}

let audioKeyStoreInstance: AudioKeyStore | null = null;

export function getAudioKeyStore(): AudioKeyStore | null {
  if (audioKeyStoreInstance) return audioKeyStoreInstance;
  try {
    const { ApplicationKeyStore } = require('./applicationKeyStore');
    const { deriveAudioWrappingKey } = require('./keyDerivation');
    const {
      getApplicationDatabase,
    } = require('../database/applicationDatabase');
    const keyStore = new ApplicationKeyStore();
    const masterKey = keyStore.getMasterKey();
    if (!masterKey) return null;
    const wrappingKey = deriveAudioWrappingKey(masterKey.key, masterKey.salt);
    const sqlite = getApplicationDatabase();
    audioKeyStoreInstance = new AudioKeyStore({
      sqlite,
      audioWrappingKey: wrappingKey,
    });
    return audioKeyStoreInstance;
  } catch {
    return null;
  }
}

export function resetAudioKeyStoreInstance(): void {
  audioKeyStoreInstance = null;
}
