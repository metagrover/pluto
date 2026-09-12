import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RECOVERY_KEY_FILE_NAME,
  hasValidRecoveryKeyFile,
  readRecoveryKeyFile,
} from '../../electron/crypto/recoveryKeyFile';

const roots: string[] = [];
const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-recovery-key-'));
  roots.push(root);
  return root;
};
const validPayload = () => ({
  version: 1,
  purpose: 'pluto-database-recovery',
  keyId: '123e4567-e89b-42d3-a456-426614174000',
  key: Buffer.alloc(32, 0x11).toString('base64'),
  salt: Buffer.alloc(32, 0x22).toString('base64'),
});
const writeRecoveryKey = (root: string, payload = validPayload()) => {
  const target = path.join(root, RECOVERY_KEY_FILE_NAME);
  fs.writeFileSync(target, JSON.stringify(payload), { mode: 0o600 });
  fs.chmodSync(target, 0o600);
  return target;
};

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe('database recovery key file', () => {
  it('reads exact owner-only key material', () => {
    const root = makeRoot();
    writeRecoveryKey(root);

    expect(readRecoveryKeyFile({ storageDir: root })).toEqual({
      key: Buffer.alloc(32, 0x11),
      keyId: '123e4567-e89b-42d3-a456-426614174000',
      salt: Buffer.alloc(32, 0x22),
    });
    expect(hasValidRecoveryKeyFile(root)).toBe(true);
  });

  it('rejects permissive files, symlinks, and malformed material', () => {
    const root = makeRoot();
    const target = writeRecoveryKey(root);
    fs.chmodSync(target, 0o644);
    expect(() => readRecoveryKeyFile({ storageDir: root })).toThrow(
      'ownership or permissions',
    );

    fs.unlinkSync(target);
    const source = path.join(root, 'source.json');
    fs.writeFileSync(source, JSON.stringify(validPayload()), { mode: 0o600 });
    fs.symlinkSync(source, target);
    expect(() => readRecoveryKeyFile({ storageDir: root })).toThrow(
      'ownership or permissions',
    );

    fs.unlinkSync(target);
    writeRecoveryKey(root, { ...validPayload(), key: 'not-base64' });
    expect(() => readRecoveryKeyFile({ storageDir: root })).toThrow(
      'material is invalid',
    );
  });
});
