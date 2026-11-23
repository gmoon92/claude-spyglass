import type { Database } from 'bun:sqlite';
import { encodeText, decodeText } from '../payload-codec';
import { getActiveKey, shouldEncrypt } from '../runtime/encryption';
import { archiveHasRowsInRange, getArchiveIndexRows, loadArchiveRows, getArchiveDir, FileArchiveStore } from '../archive';

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
  permission_mode?: string | null;
  source?: string | null;
  end_reason?: string | null;
  model?: string | null;
  stop_hook_active?: number | null;
  task_id?: string | null;
  task_subject?: string | null;
  notification_type?: string | null;
  /** R3: payload at-rest 인코딩 마커. NULL=평문, 'aes256gcm'=암호문(base64-in-TEXT). */
  payload_algo?: string | null;
}

/** 읽은 행들의 payload를 payload_algo 분기로 복호(평문/암호문 혼재 대응). */
function decodeEventRows(rows: ClaudeEvent[]): ClaudeEvent[] {
  const key = getActiveKey();
  for (const r of rows) {
    r.payload = decodeText(r.payload, r.payload_algo, key) ?? r.payload;
  }
  return rows;
}

export function createEvent(db: Database, event: ClaudeEvent): void {
  // R3: 옵트인 시 payload를 AES-256-GCM(base64-in-TEXT)로 암호화. OFF면 평문(algo NULL).
  const { value: payloadValue, algo } = encodeText(
    event.payload,
    shouldEncrypt() ? getActiveKey() : null,
  );
  db.prepare(`
    INSERT OR IGNORE INTO claude_events
      (event_id, event_type, session_id, transcript_path, cwd, agent_id, agent_type,
       timestamp, payload, schema_version,
       permission_mode, source, end_reason, model, stop_hook_active,
       task_id, task_subject, notification_type, payload_algo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event_id,
    event.event_type,
    event.session_id,
    event.transcript_path ?? null,
    event.cwd ?? null,
    event.agent_id ?? null,
    event.agent_type ?? null,
    event.timestamp,
    payloadValue,
    event.schema_version ?? 1,
    event.permission_mode ?? null,
    event.source ?? null,
    event.end_reason ?? null,
    event.model ?? null,
    event.stop_hook_active ?? null,
    event.task_id ?? null,
    event.task_subject ?? null,
    event.notification_type ?? null,
    algo ?? null,
  );
}

/**
 * claude_events 조회의 Hot/Archive 병합 — 3함수 공통(전부 timestamp DESC LIMIT + optional 필터).
 * archive_index(claude_events)를 session/type으로 조회 → 파일 로드 → Hot과 timestamp DESC 병합 후 limit.
 * archive 비면 Hot 그대로(무변경). 병합 후 호출자가 decodeEventRows.
 */
function mergeEventArchive(
  db: Database,
  hot: ClaudeEvent[],
  filter: { sessionId?: string; eventType?: string },
  limit: number,
): ClaudeEvent[] {
  if (!archiveHasRowsInRange(db, 'claude_events', null, null)) return hot;
  const idx = getArchiveIndexRows(db, 'claude_events', {
    sessionId: filter.sessionId ?? null,
    type: filter.eventType ?? null,
    order: 'DESC',
    limit,
  });
  if (idx.length === 0) return hot;
  const store = new FileArchiveStore(getArchiveDir(db));
  const arch = loadArchiveRows(store, idx, 'event_id') as unknown as ClaudeEvent[];
  return [...hot, ...arch].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

export function getEventsBySession(db: Database, sessionId: string, limit = 100): ClaudeEvent[] {
  const hot = db.query(
    'SELECT * FROM claude_events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(sessionId, limit) as ClaudeEvent[];
  return decodeEventRows(mergeEventArchive(db, hot, { sessionId }, limit));
}

export function getEventsByType(db: Database, eventType: string, limit = 100): ClaudeEvent[] {
  const hot = db.query(
    'SELECT * FROM claude_events WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(eventType, limit) as ClaudeEvent[];
  return decodeEventRows(mergeEventArchive(db, hot, { eventType }, limit));
}

export function getRecentEvents(db: Database, limit = 100): ClaudeEvent[] {
  const hot = db.query(
    'SELECT * FROM claude_events ORDER BY timestamp DESC LIMIT ?'
  ).all(limit) as ClaudeEvent[];
  return decodeEventRows(mergeEventArchive(db, hot, {}, limit));
}

/** getEventsByTypesInRange 필터. 시각은 ms epoch, from·to 모두 포함(다른 stats 조회와 같은 규약). */
export interface EventRangeFilter {
  eventTypes: string[];
  fromTs?: number;
  toTs?: number;
  sessionId?: string;
  /** cwd 가 이 문자열로 시작하는 이벤트만. LIKE 를 쓰지 않아 `%`·`_` 를 이스케이프할 필요가 없다. */
  cwdPrefix?: string;
  limit: number;
}

/**
 * 여러 event_type 을 기간·세션·cwd 로 한 번에 거른 이벤트(최신순, payload 복호 완료).
 *
 * 기존 getEventsBySession/getEventsByType 은 타입이나 세션 하나에 limit 만 받아, 세션 이벤트의 절반을
 * 차지하는 CwdChanged·ConfigChange 에 밀려 원하는 타입이 limit 밖으로 나갈 수 있다. 이 함수는 타입을
 * SQL 에서 먼저 거르기 때문에 그 문제가 없다.
 *
 * Hot/Archive 병합은 mergeEventArchive 와 같은 규칙 — archive 가 범위에 없으면 Hot 그대로.
 *
 * 호출자: friction.ts getFrictionSummary (GET /api/friction).
 */
export function getEventsByTypesInRange(db: Database, f: EventRangeFilter): ClaudeEvent[] {
  if (f.eventTypes.length === 0) return [];
  const where: string[] = [`event_type IN (${f.eventTypes.map(() => '?').join(',')})`];
  const params: unknown[] = [...f.eventTypes];
  if (f.fromTs !== undefined) { where.push('timestamp >= ?'); params.push(f.fromTs); }
  if (f.toTs !== undefined) { where.push('timestamp <= ?'); params.push(f.toTs); }
  if (f.sessionId) { where.push('session_id = ?'); params.push(f.sessionId); }
  if (f.cwdPrefix) { where.push('substr(cwd, 1, ?) = ?'); params.push(f.cwdPrefix.length, f.cwdPrefix); }
  const hot = db.query(
    `SELECT * FROM claude_events WHERE ${where.join(' AND ')} ORDER BY timestamp DESC LIMIT ?`,
  ).all(...(params as []), f.limit) as ClaudeEvent[];

  let merged = hot;
  // archive_index 는 timestamp < ? (배타) 규약이라 to 를 +1 해 포함 범위로 맞춘다. cwd 는 인덱스에 없어 로드 뒤 거른다.
  const archFrom = f.fromTs ?? null;
  const archTo = f.toTs !== undefined ? f.toTs + 1 : null;
  if (archiveHasRowsInRange(db, 'claude_events', archFrom, archTo)) {
    const store = new FileArchiveStore(getArchiveDir(db));
    for (const type of f.eventTypes) {
      const idx = getArchiveIndexRows(db, 'claude_events', {
        fromTs: archFrom, toTs: archTo, sessionId: f.sessionId ?? null, type, order: 'DESC', limit: f.limit,
      });
      if (idx.length === 0) continue;
      const arch = loadArchiveRows(store, idx, 'event_id') as unknown as ClaudeEvent[];
      merged = merged.concat(f.cwdPrefix ? arch.filter((e) => (e.cwd ?? '').startsWith(f.cwdPrefix!)) : arch);
    }
    merged = merged.sort((a, b) => b.timestamp - a.timestamp).slice(0, f.limit);
  }
  return decodeEventRows(merged);
}

export function getEventStats(db: Database): { event_type: string; count: number }[] {
  return db.query(
    'SELECT event_type, COUNT(*) as count FROM claude_events GROUP BY event_type ORDER BY count DESC'
  ).all() as { event_type: string; count: number }[];
}
