import type Database from 'better-sqlite3';

type Row = Record<string, string | number | null>;
export interface ActionChange {
  table: string;
  keys: string[];
  before: Row | null;
  after: Row | null;
}
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
// Only domain records touched by the supported services. Derived FTS and reminder
// queues continue to be maintained by their normal database triggers.
const tables = [
  'notes',
  'entities',
  'entity_links',
  'meeting_entities',
  'commitment_aliases',
  'meetings',
];
export function captureActionChanges<T>(
  db: Database.Database,
  execute: () => T,
): { result: T; changes: ActionChange[] } {
  db.exec(
    'CREATE TEMP TABLE IF NOT EXISTS pluto_action_capture (sequence INTEGER PRIMARY KEY, table_name TEXT, keys_json TEXT, before_json TEXT, after_json TEXT); DELETE FROM pluto_action_capture',
  );
  const triggers: string[] = [];
  try {
    for (const table of tables) {
      const info = db
        .prepare(`PRAGMA table_info(${quote(table)})`)
        .all() as Array<{ name: string; pk: number }>;
      if (!info.length) continue;
      const keys = info
        .filter((c) => c.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      if (!keys.length) throw new Error(`Cannot journal ${table}`);
      const columns =
        table === 'meetings'
          ? info.filter((c) => ['id', 'user_edits_json'].includes(c.name))
          : info;
      const json = (side: string) =>
        `json_object(${columns.map((c) => `'${c.name}', ${side}.${quote(c.name)}`).join(',')})`;
      for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
        const name = `pluto_capture_${table}_${op}`;
        triggers.push(name);
        db.exec(`CREATE TEMP TRIGGER ${quote(name)} AFTER ${op} ON main.${quote(table)} BEGIN
          INSERT INTO pluto_action_capture(table_name, keys_json, before_json, after_json)
          VALUES ('${table}', '${JSON.stringify(keys)}', ${op === 'INSERT' ? 'NULL' : json('OLD')}, ${op === 'DELETE' ? 'NULL' : json('NEW')}); END`);
      }
    }
    const result = execute();
    const rows = db
      .prepare('SELECT * FROM pluto_action_capture ORDER BY sequence')
      .all() as Array<{
      table_name: string;
      keys_json: string;
      before_json: string | null;
      after_json: string | null;
    }>;
    const changes = rows
      .map((r) => ({
        table: r.table_name,
        keys: JSON.parse(r.keys_json),
        before: r.before_json ? JSON.parse(r.before_json) : null,
        after: r.after_json ? JSON.parse(r.after_json) : null,
      }))
      .filter((r) => JSON.stringify(r.before) !== JSON.stringify(r.after));
    return { result, changes };
  } finally {
    for (const name of triggers)
      db.exec(`DROP TRIGGER IF EXISTS temp.${quote(name)}`);
    db.exec('DELETE FROM pluto_action_capture');
  }
}
export function undoActionChanges(
  db: Database.Database,
  changes: ActionChange[],
) {
  const identity = (c: ActionChange) =>
    JSON.stringify([c.table, c.keys.map((k) => (c.after ?? c.before)![k])]);
  const finals = new Map<string, ActionChange>();
  for (const c of changes) finals.set(identity(c), c);
  for (const c of finals.values()) {
    if (!tables.includes(c.table)) throw new Error('Invalid action history');
    const row = (c.after ?? c.before)!;
    const current =
      db
        .prepare(
          `SELECT ${Object.keys(row).map(quote).join(',')} FROM ${quote(c.table)} WHERE ${c.keys.map((k) => `${quote(k)} = ?`).join(' AND ')}`,
        )
        .get(...c.keys.map((k) => row[k])) ?? null;
    if (JSON.stringify(current) !== JSON.stringify(c.after))
      throw new Error(
        'An affected item changed after this action. Undo would overwrite a later edit.',
      );
  }
  // A new relationship may not change the parent record itself. Never let a
  // cascading delete erase work created after the action.
  const deleting = [...finals.values()].filter((c) => {
    const first = changes.find((item) => identity(item) === identity(c));
    return first?.before === null && c.after !== null;
  });
  const schema = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as Array<{ name: string }>;
  for (const parent of deleting) {
    for (const { name } of schema) {
      const fks = db
        .prepare(`PRAGMA foreign_key_list(${quote(name)})`)
        .all() as Array<{ table: string; from: string; to: string }>;
      for (const fk of fks.filter(
        (f) => f.table === parent.table && f.to in parent.after!,
      )) {
        const refs = db
          .prepare(`SELECT * FROM ${quote(name)} WHERE ${quote(fk.from)} = ?`)
          .all(parent.after![fk.to]) as Row[];
        for (const row of refs) {
          if (
            !changes.some(
              (change) =>
                change.table === name &&
                change.before === null &&
                change.after &&
                change.keys.every((k) => change.after![k] === row[k]),
            )
          )
            throw new Error(
              'An affected item has new links. Undo would remove later work.',
            );
        }
      }
    }
  }
  for (const c of [...changes].reverse()) {
    const row = (c.before ?? c.after)!;
    const where = c.keys.map((k) => `${quote(k)} = ?`).join(' AND ');
    if (!c.before)
      db.prepare(`DELETE FROM ${quote(c.table)} WHERE ${where}`).run(
        ...c.keys.map((k) => row[k]),
      );
    else if (!c.after)
      db.prepare(
        `INSERT INTO ${quote(c.table)} (${Object.keys(row).map(quote).join(',')}) VALUES (${Object.keys(
          row,
        )
          .map(() => '?')
          .join(',')})`,
      ).run(...Object.values(row));
    else
      db.prepare(
        `UPDATE ${quote(c.table)} SET ${Object.keys(row)
          .map((k) => `${quote(k)} = ?`)
          .join(',')} WHERE ${where}`,
      ).run(...Object.values(row), ...c.keys.map((k) => row[k]));
  }
}
