import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const writeOwnerOnlyPrivateFile = (
  filePath: string,
  contents: string,
) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && !fs.lstatSync(filePath).isFile()) {
    throw new Error('private_evaluation_path_unsafe');
  }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: number | undefined;
  try {
    handle = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    fs.fchmodSync(handle, 0o600);
    fs.writeFileSync(handle, contents, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
};

/** Append one durable JSONL record. Callers must write the scheduled/run start
 * before doing work so a crash remains visible instead of changing denominators. */
export const appendOwnerOnlyPrivateLine = (
  filePath: string,
  value: unknown,
): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && !fs.lstatSync(filePath).isFile()) {
    throw new Error('private_evaluation_path_unsafe');
  }
  const handle = fs.openSync(
    filePath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND,
    0o600,
  );
  try {
    fs.fchmodSync(handle, 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(value)}\n`, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
};
