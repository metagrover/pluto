import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateMigrationManifest(migrationsFolder) {
  const journal = JSON.parse(
    readFileSync(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  );
  if (!Array.isArray(journal.entries)) {
    throw new Error('Migration journal must contain an entries array.');
  }

  const sqlTags = readdirSync(migrationsFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name.slice(0, -'.sql'.length))
    .sort();
  const journalTags = [];
  const seenTags = new Set();

  for (const [index, entry] of journal.entries.entries()) {
    if (!entry || typeof entry.tag !== 'string' || !entry.tag) {
      throw new Error(`Migration journal entry ${index} needs a tag.`);
    }
    if (entry.idx !== index) {
      throw new Error(
        `Migration journal entry ${entry.tag} has idx ${entry.idx}; expected ${index}.`,
      );
    }
    if (seenTags.has(entry.tag)) {
      throw new Error(`Duplicate migration journal tag: ${entry.tag}.`);
    }
    if (index > 0 && entry.tag <= journalTags[index - 1]) {
      throw new Error(
        `Migration journal tags are out of order at ${entry.tag}.`,
      );
    }
    seenTags.add(entry.tag);
    journalTags.push(entry.tag);
  }

  const sqlTagSet = new Set(sqlTags);
  const missingFromJournal = sqlTags.filter((tag) => !seenTags.has(tag));
  const missingSqlFiles = journalTags.filter((tag) => !sqlTagSet.has(tag));
  if (missingFromJournal.length || missingSqlFiles.length) {
    throw new Error(
      [
        missingFromJournal.length &&
          `SQL files missing from migration journal: ${missingFromJournal.join(', ')}`,
        missingSqlFiles.length &&
          `Migration journal entries missing SQL files: ${missingSqlFiles.join(', ')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateMigrationManifest(resolve(process.cwd(), 'drizzle'));
  console.log('Migration SQL files and journal entries match.');
}
