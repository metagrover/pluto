import fs from 'node:fs';
import path from 'node:path';

export const RECOVERY_KEY_FILE_NAME = 'app-recovery-key.json';
const MAX_RECOVERY_KEY_FILE_BYTES = 4096;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RecoveryKeyMaterial {
  key: Buffer;
  keyId: string;
  salt: Buffer;
}

const decodeCanonical32ByteBase64 = (value: unknown, field: string) => {
  if (typeof value !== 'string') {
    throw new Error(`Recovery key ${field} is invalid`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== value) {
    throw new Error(`Recovery key ${field} is invalid`);
  }
  return decoded;
};

export const resolveRecoveryKeyPath = (
  storageDir: string,
  fileName = RECOVERY_KEY_FILE_NAME,
): string => path.join(storageDir, fileName);

export const readRecoveryKeyFile = (input: {
  storageDir: string;
  fileName?: string;
  expectedUid?: number;
}): RecoveryKeyMaterial | null => {
  const recoveryPath = resolveRecoveryKeyPath(input.storageDir, input.fileName);
  if (!fs.existsSync(recoveryPath)) return null;

  const before = fs.lstatSync(recoveryPath);
  const expectedUid = input.expectedUid ?? process.getuid?.();
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size > MAX_RECOVERY_KEY_FILE_BYTES ||
    (before.mode & 0o777) !== 0o600 ||
    (expectedUid !== undefined && before.uid !== expectedUid)
  ) {
    throw new Error('Recovery key file ownership or permissions are invalid');
  }

  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(recoveryPath, fs.constants.O_RDONLY | noFollow);
  let raw: string;
  try {
    const opened = fs.fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > MAX_RECOVERY_KEY_FILE_BYTES
    ) {
      throw new Error('Recovery key file changed while opening');
    }
    raw = fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Recovery key file is malformed');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Recovery key file is malformed');
  }
  const record = parsed as Record<string, unknown>;
  const allowedKeys = ['key', 'keyId', 'purpose', 'salt', 'version'];
  if (
    record.version !== 1 ||
    record.purpose !== 'pluto-database-recovery' ||
    typeof record.keyId !== 'string' ||
    !UUID_PATTERN.test(record.keyId) ||
    Object.keys(record).sort().join(',') !== allowedKeys.join(',')
  ) {
    throw new Error('Recovery key file metadata is invalid');
  }

  return {
    key: decodeCanonical32ByteBase64(record.key, 'material'),
    keyId: record.keyId,
    salt: decodeCanonical32ByteBase64(record.salt, 'salt'),
  };
};

export const hasValidRecoveryKeyFile = (storageDir: string): boolean => {
  try {
    return readRecoveryKeyFile({ storageDir }) !== null;
  } catch {
    return false;
  }
};
