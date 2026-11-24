/**
 * instruction-footprint — 지침 문서(CLAUDE.md·rules·메모리 색인)가 컨텍스트에 얼마나 실리는지 집계.
 *
 * 책임:
 *  - `proxy_requests.system_reminder`(첫 user 메시지의 `<system-reminder>` 누적 텍스트)에서
 *    `Contents of <경로> (<설명>):` 블록별 바이트를 뽑는다(parseInstructionBlocks — 순수 함수).
 *  - 세션별 가장 최근 요청 하나를 표본으로 파일별 주입 바이트를 평균·최대로 집계한다.
 *  - claude_events 의 InstructionsLoaded 이벤트(file_path·memory_type·load_reason)로 파일별 로드 횟수를 센다.
 *  - 최신 시스템 프롬프트 크기를 함께 돌려주고, 요청하면 system_reminder 크기의 일별 추이도 돌려준다.
 *
 * 외부 노출: getInstructionFootprint, parseInstructionBlocks
 * 호출자: server routes/instructions.ts (GET /api/instructions/footprint)
 * 의존: queries/event.ts getEventsByTypesInRange
 *
 * 한계:
 *  - 블록 분할은 Claude Code 가 붙이는 `Contents of <경로> (<설명>):` 줄 형식에 기댄다. 형식이 바뀌면
 *    파일별 바이트(avg_bytes 등)가 비고, InstructionsLoaded 기반 로드 집계만 남는다(깨지지 않고 비는 쪽으로 실패).
 *  - 스킬·에이전트 목록은 system_reminder 에서 찾지 못했다(별도 첨부 위치로 보이나 확인 못 함) — 집계에 없다.
 *  - 표본은 "세션별 가장 최근 요청 1건" 이다. 같은 세션의 지침 구성이 중간에 바뀌면 마지막 상태만 반영된다.
 */

import type { Database } from 'bun:sqlite';
import { getEventsByTypesInRange } from './event';

/** 표본으로 읽는 세션 수 기본/최대. 요청당 reminder 가 10~60KB 라 상한으로 응답 시간을 묶는다. */
export const FOOTPRINT_DEFAULT_SESSIONS = 200;
export const FOOTPRINT_MAX_SESSIONS = 1000;
/** InstructionsLoaded 이벤트를 읽는 상한. */
const LOAD_EVENT_LIMIT = 5000;
/** 기간을 주지 않았을 때의 기본 창. */
export const FOOTPRINT_DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// =============================================================================
// system_reminder 파싱 (순수)
// =============================================================================

export interface InstructionBlock {
  /** `Contents of` 뒤의 파일 경로(절대 경로 그대로). */
  file_path: string;
  /** 경로 뒤 괄호 설명(예: "project instructions, checked into the codebase"). 없으면 null. */
  description: string | null;
  /** 블록 본문의 UTF-8 바이트 수(앞뒤 공백 제외). */
  bytes: number;
}

/** `Contents of <경로> (<설명>):` 또는 `Contents of <경로>:` 한 줄. 줄 전체가 이 모양일 때만 마커로 본다. */
const MARKER = /^Contents of (.+?)(?: \(([^)\n]*)\))?:[ \t]*$/gm;
const REMINDER_CLOSE = '</system-reminder>';

/**
 * system_reminder 텍스트를 지침 파일 블록으로 나눈다.
 *
 * 블록 범위: 마커 줄 다음부터 "다음 마커 줄의 시작" 또는 "다음 `</system-reminder>`" 중 먼저 오는 곳까지.
 * 같은 파일이 여러 번 실리면(압축 뒤 재첨부 등) 실린 만큼 각각 한 항목으로 돌려준다.
 */
export function parseInstructionBlocks(text: string): InstructionBlock[] {
  const markers: Array<{ start: number; bodyStart: number; path: string; description: string | null }> = [];
  for (const m of text.matchAll(MARKER)) {
    const start = m.index ?? 0;
    markers.push({ start, bodyStart: start + m[0].length, path: m[1], description: m[2] ?? null });
  }
  const blocks: InstructionBlock[] = [];
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    let end = i + 1 < markers.length ? markers[i + 1].start : text.length;
    const close = text.indexOf(REMINDER_CLOSE, cur.bodyStart);
    if (close !== -1 && close < end) end = close;
    const body = text.slice(cur.bodyStart, end).trim();
    blocks.push({ file_path: cur.path, description: cur.description, bytes: Buffer.byteLength(body, 'utf8') });
  }
  return blocks;
}

// =============================================================================
// 집계
// =============================================================================

export interface FootprintFilter {
  fromTs?: number;
  toTs?: number;
  /** 지침 파일 경로가 이 문자열로 시작하는 것만(허브 루트 등). 지정하면 각 항목에 rel_path 가 붙는다. */
  pathPrefix?: string;
  /** 표본으로 읽는 세션 수(최근 활동 순). 기본 FOOTPRINT_DEFAULT_SESSIONS. */
  sessionLimit?: number;
  /**
   * reminder_bytes.by_day(일별 추이)를 계산한다. 기본 false — 기간 안 모든 요청의 reminder 본문(요청당 10~60KB)을
   * 읽어야 해서 기간이 길면 수백 ms~초 단위가 든다(운영 DB 복사본 2.4천 건에서 약 0.3~0.6초).
   */
  includeTrend?: boolean;
}

export interface FootprintFile {
  file_path: string;
  /** pathPrefix 아래일 때 그 접두를 뗀 경로(앞의 `/` 제거). 접두 밖이거나 접두 미지정이면 null. */
  rel_path: string | null;
  /** reminder 블록 설명(첫 표본 기준) 또는 InstructionsLoaded 의 memory_type. */
  kind: string | null;
  /** InstructionsLoaded 이벤트 횟수와 load_reason 별 분해. */
  loads: number;
  by_reason: Record<string, number>;
  last_loaded_at: number | null;
  /** 이 파일이 reminder 에 실려 있던 표본 세션 수. */
  sessions: number;
  /** 표본 세션당 이 파일의 주입 바이트(같은 reminder 에 여러 번 실렸으면 합) 평균·최대. 표본에 없으면 null. */
  avg_bytes: number | null;
  max_bytes: number | null;
  /** 한 reminder 에 같은 파일이 실린 최대 횟수(2 이상이면 중복 첨부). 표본에 없으면 null. */
  copies_max: number | null;
}

export interface FootprintSummary {
  files: FootprintFile[];
  reminder_bytes: {
    /** 표본 세션의 system_reminder 바이트 평균·최대(null = 표본 없음). */
    avg: number | null;
    max: number | null;
    sessions: number;
    /** includeTrend 가 꺼져 있으면 null. */
    by_day: Array<{ day: string; avg: number; requests: number }> | null;
  };
  system_prompt_bytes: { latest: number | null; max: number | null; latest_at: number | null };
  sampled_sessions: number;
  load_events: number;
}

interface FileAcc {
  file_path: string;
  kind: string | null;
  loads: number;
  by_reason: Record<string, number>;
  last_loaded_at: number | null;
  perSessionBytes: number[];
  copiesMax: number;
}

function relPath(filePath: string, prefix: string | undefined): string | null {
  if (!prefix || !filePath.startsWith(prefix)) return null;
  return filePath.slice(prefix.length).replace(/^\/+/, '');
}

/**
 * 기간 안의 지침 주입 현황을 집계한다.
 *
 * 호출자: server routes/instructions.ts
 */
export function getInstructionFootprint(db: Database, f: FootprintFilter): FootprintSummary {
  const fromTs = f.fromTs ?? 0;
  const toTs = f.toTs ?? Number.MAX_SAFE_INTEGER;
  const sessionLimit = Math.min(Math.max(1, f.sessionLimit ?? FOOTPRINT_DEFAULT_SESSIONS), FOOTPRINT_MAX_SESSIONS);
  const files = new Map<string, FileAcc>();
  const acc = (filePath: string): FileAcc => {
    let a = files.get(filePath);
    if (!a) {
      a = { file_path: filePath, kind: null, loads: 0, by_reason: {}, last_loaded_at: null, perSessionBytes: [], copiesMax: 0 };
      files.set(filePath, a);
    }
    return a;
  };
  const inScope = (p: string): boolean => !f.pathPrefix || p.startsWith(f.pathPrefix);

  // --- 1) 세션별 최근 요청 1건의 reminder 에서 파일별 바이트 -------------------------------------------
  //   GROUP BY + JOIN 패턴(request/turn.ts 의 ROW_NUMBER 대비 측정 이득과 같은 이유)으로 reminder 본문은
  //   선택된 행에서만 읽는다.
  const latestRows = db.query(`
    SELECT p.session_id AS session_id, p.timestamp AS timestamp, p.system_reminder AS system_reminder
    FROM proxy_requests p
    JOIN (
      SELECT session_id, MAX(timestamp) AS ts
      FROM proxy_requests
      WHERE system_reminder IS NOT NULL AND session_id IS NOT NULL
        AND timestamp >= ? AND timestamp <= ?
      GROUP BY session_id
      ORDER BY ts DESC
      LIMIT ?
    ) m ON p.session_id = m.session_id AND p.timestamp = m.ts
    WHERE p.system_reminder IS NOT NULL
  `).all(fromTs, toTs, sessionLimit) as Array<{ session_id: string; timestamp: number; system_reminder: string }>;

  const seenSessions = new Set<string>();
  const reminderSizes: number[] = [];
  for (const row of latestRows) {
    if (seenSessions.has(row.session_id)) continue; // 같은 timestamp 의 중복 행 방지
    seenSessions.add(row.session_id);
    reminderSizes.push(Buffer.byteLength(row.system_reminder, 'utf8'));

    const perFile = new Map<string, { bytes: number; copies: number; description: string | null }>();
    for (const b of parseInstructionBlocks(row.system_reminder)) {
      if (!inScope(b.file_path)) continue;
      const cur = perFile.get(b.file_path) ?? { bytes: 0, copies: 0, description: b.description };
      cur.bytes += b.bytes;
      cur.copies += 1;
      perFile.set(b.file_path, cur);
    }
    for (const [path, v] of perFile) {
      const a = acc(path);
      a.perSessionBytes.push(v.bytes);
      a.copiesMax = Math.max(a.copiesMax, v.copies);
      a.kind = a.kind ?? v.description;
    }
  }

  // --- 2) InstructionsLoaded 이벤트로 로드 횟수 ------------------------------------------------------
  const events = getEventsByTypesInRange(db, {
    eventTypes: ['InstructionsLoaded'],
    fromTs: f.fromTs,
    toTs: f.toTs,
    limit: LOAD_EVENT_LIMIT,
  });
  let loadEvents = 0;
  for (const e of events) {
    let p: { file_path?: unknown; memory_type?: unknown; load_reason?: unknown };
    try { p = JSON.parse(e.payload); } catch { continue; }
    if (typeof p.file_path !== 'string' || !inScope(p.file_path)) continue;
    loadEvents++;
    const a = acc(p.file_path);
    a.loads++;
    const reason = typeof p.load_reason === 'string' ? p.load_reason : 'unknown';
    a.by_reason[reason] = (a.by_reason[reason] ?? 0) + 1;
    a.last_loaded_at = Math.max(a.last_loaded_at ?? 0, e.timestamp);
    if (typeof p.memory_type === 'string') a.kind = a.kind ?? p.memory_type;
  }

  // --- 3) reminder 일별 추이(선택)·시스템 프롬프트 크기 ---------------------------------------------------------
  //   length(CAST(.. AS BLOB)) 는 바이트 수이고 TEXT length() 와 달리 문자 수를 세지 않아 싸다.
  const byDay = f.includeTrend
    ? (db.query(`
      SELECT date(timestamp / 1000, 'unixepoch', 'localtime') AS day,
             COUNT(*) AS requests,
             AVG(length(CAST(system_reminder AS BLOB))) AS avg
      FROM proxy_requests
      WHERE system_reminder IS NOT NULL AND timestamp >= ? AND timestamp <= ?
      GROUP BY day
      ORDER BY day
    `).all(fromTs, toTs) as Array<{ day: string; requests: number; avg: number }>)
    : null;

  const sys = db.query(`
    SELECT system_byte_size AS size, timestamp
    FROM proxy_requests
    WHERE system_byte_size IS NOT NULL AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp DESC LIMIT 1
  `).get(fromTs, toTs) as { size: number; timestamp: number } | null;
  const sysMax = db.query(`
    SELECT MAX(system_byte_size) AS max FROM proxy_requests
    WHERE system_byte_size IS NOT NULL AND timestamp >= ? AND timestamp <= ?
  `).get(fromTs, toTs) as { max: number | null } | null;

  const mean = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

  const out: FootprintFile[] = [...files.values()]
    .map((a) => ({
      file_path: a.file_path,
      rel_path: relPath(a.file_path, f.pathPrefix),
      kind: a.kind,
      loads: a.loads,
      by_reason: a.by_reason,
      last_loaded_at: a.last_loaded_at,
      sessions: a.perSessionBytes.length,
      avg_bytes: mean(a.perSessionBytes),
      max_bytes: a.perSessionBytes.length ? Math.max(...a.perSessionBytes) : null,
      copies_max: a.perSessionBytes.length ? a.copiesMax : null,
    }))
    .sort((a, b) => (b.avg_bytes ?? 0) - (a.avg_bytes ?? 0) || b.loads - a.loads || a.file_path.localeCompare(b.file_path));

  return {
    files: out,
    reminder_bytes: {
      avg: mean(reminderSizes),
      max: reminderSizes.length ? Math.max(...reminderSizes) : null,
      sessions: reminderSizes.length,
      by_day: byDay ? byDay.map((d) => ({ day: d.day, avg: Math.round(d.avg), requests: d.requests })) : null,
    },
    system_prompt_bytes: { latest: sys?.size ?? null, max: sysMax?.max ?? null, latest_at: sys?.timestamp ?? null },
    sampled_sessions: seenSessions.size,
    load_events: loadEvents,
  };
}
