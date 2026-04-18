import type { Database } from 'bun:sqlite';

export interface ClaudeEvent {
  id?: number;
  event_id: string;
  event_type: string;
  session_id: string;
  transcript_path?: string | null;
  cwd?: string | null;
  agent_id?: string | null;
  agent_type?: string | null;
  timestamp: number;
  payload: string;
  schema_version?: number;
}

export function createEvent(db: Database, event: ClaudeEvent): void {
  db.prepare(`
    INSERT OR IGNORE INTO claude_events
      (event_id, event_type, session_id, transcript_path, cwd, agent_id, agent_type, timestamp, payload, schema_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event_id,
    event.event_type,
    event.session_id,
    event.transcript_path ?? null,
    event.cwd ?? null,
    event.agent_id ?? null,
    event.agent_type ?? null,
    event.timestamp,
    event.payload,
    event.schema_version ?? 1,
  );
}

export function getEventsBySession(db: Database, sessionId: string, limit = 100): ClaudeEvent[] {
  return db.query(
    'SELECT * FROM claude_events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(sessionId, limit) as ClaudeEvent[];
}

export function getEventsByType(db: Database, eventType: string, limit = 100): ClaudeEvent[] {
  return db.query(
    'SELECT * FROM claude_events WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(eventType, limit) as ClaudeEvent[];
}

export function getRecentEvents(db: Database, limit = 100): ClaudeEvent[] {
  return db.query(
    'SELECT * FROM claude_events ORDER BY timestamp DESC LIMIT ?'
  ).all(limit) as ClaudeEvent[];
}

export function getEventStats(db: Database): { event_type: string; count: number }[] {
  return db.query(
    'SELECT event_type, COUNT(*) as count FROM claude_events GROUP BY event_type ORDER BY count DESC'
  ).all() as { event_type: string; count: number }[];
}
