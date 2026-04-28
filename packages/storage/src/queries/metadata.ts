import type { Database } from 'bun:sqlite';

export function getMetadata(db: Database, key: string): string | null {
  const row = db.query<{ value: string }, [string]>(
    'SELECT value FROM metadata WHERE key = ?'
  ).get(key);
  return row?.value ?? null;
}

export function setMetadata(db: Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(key, value);
}
