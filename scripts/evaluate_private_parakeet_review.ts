import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { evaluatePrivateTranscriptionReview } from '../src/services/privateTranscriptionReview.ts';

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const ratingsPath = path.resolve(option('--ratings'));
const manifestPath = path.resolve(option('--manifest'));
for (const filePath of [ratingsPath, manifestPath]) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size > 1024 * 1024) {
    throw new Error('private_review_file_invalid');
  }
}
const ratings = JSON.parse(fs.readFileSync(ratingsPath, 'utf8')) as unknown;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
console.log(
  JSON.stringify(evaluatePrivateTranscriptionReview(ratings, manifest)),
);
