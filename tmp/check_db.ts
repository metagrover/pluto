import path from 'path';
import Database from 'better-sqlite3';

// Depending on the OS, the user data path varies.
// Using Mac OS path for Electron app "pluto"
const dbPath = path.join(
  process.env.HOME || '',
  'Library',
  'Application Support',
  'pluto',
  'pluto.db',
);
const db = new Database(dbPath);

console.log('--- FTS SEARCH FOR BERLIN ---');
try {
  const ftsDocs = db
    .prepare(
      `SELECT meeting_id, snippet(meetings_fts, -1, '[', ']', '...', 64) as snip FROM meetings_fts WHERE meetings_fts MATCH 'Berlin'`,
    )
    .all();
  console.log(`FTS found ${ftsDocs.length} matches.`);
  console.log(JSON.stringify(ftsDocs, null, 2));

  if (ftsDocs.length === 0) {
    console.log('\n--- LIKE SEARCH FOR BERLIN ---');
    const likeDocs = db
      .prepare(
        `SELECT id, title, enhanced_notes FROM meetings WHERE enhanced_notes LIKE '%Berlin%' OR transcript_json LIKE '%Berlin%' OR mid_json LIKE '%Berlin%'`,
      )
      .all();
    console.log(`LIKE found ${likeDocs.length} matches.`);
    for (const doc of likeDocs as any[]) {
      console.log(`ID: ${doc.id}, Title: ${doc.title}`);
    }
  }
} catch (e) {
  console.error(e);
}
