/**
 * friction — 마찰 신호 집계 (도구 실패·중단·권한 요청/거부·API 실패·압축).
 *
 * 책임:
 *  - claude_events 의 마찰성 이벤트를 세션·기간·cwd 로 거른 뒤 세션별·도구별로 센다.
 *  - 새 테이블 없이 기존 claude_events 만 읽는다(읽기 전용 집계).
 *
 * 외부 노출: getFrictionSummary(DB 조회 + 집계), summarizeFriction(이미 읽은 이벤트의 순수 집계)
 * 호출자: server routes/friction.ts (GET /api/friction)
 * 의존: queries/event.ts getEventsByTypesInRange
 *
 * 소비자: 허브 task-observer 의 "객관 신호" 보조 입력. 교정·gap·blind-spot 판단은 여기서 하지 않는다.
 *
 * 한계:
 *  - 사용자 중단은 requests.tool_interrupted 가 비어 있어, PostToolUseFailure payload 의 is_interrupt 로 센다.
 *  - 성공한 도구 호출은 claude_events 에 없다. 그래서 "연속 실패"(repeated_failures)는 같은 세션의
 *    실패 이벤트 열에서 같은 도구가 끊김 없이 이어진 것을 뜻하고, 사이에 낀 성공 호출은 알 수 없다.
 *  - 오류문(last_error)에는 경로·토큰이 섞일 수 있어 첫 줄 앞부분만 돌려준다.
 */

import type { Database } from 'bun:sqlite';
import { getEventsByTypesInRange, type ClaudeEvent } from './event';

/** 마찰로 세는 event_type. 이 목록이 집계 대상의 SSoT. */
export const FRICTION_EVENT_TYPES = [
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'StopFailure',
  'PreCompact',
] as const;

/** last_error 에 싣는 최대 글자 수(첫 줄 기준). */
export const FRICTION_ERROR_MAX_CHARS = 200;
/** 같은 도구 실패가 이 간격 이내로 이어지면 한 묶음(연속)으로 본다. */
export const REPEAT_GAP_MS = 10 * 60 * 1000;
/** 읽을 이벤트 수 상한 기본/최대. */
export const FRICTION_DEFAULT_LIMIT = 5000;
export const FRICTION_MAX_LIMIT = 20000;
const BY_SESSION_MAX = 100;
const TOP_TOOLS_MAX = 20;

export interface FrictionFilter {
  fromTs?: number;
  toTs?: number;
  sessionId?: string;
  cwdPrefix?: string;
  /** 읽을 이벤트 수 상한(최신순). 기본 FRICTION_DEFAULT_LIMIT. */
  limit?: number;
  /** repeated_failures 로 올릴 최소 연속 횟수. 기본 3. */
  repeatMin?: number;
}

export interface FrictionCounts {
  tool_failures: number;
  interrupts: number;
  permission_requests: number;
  permission_denied: number;
  stop_failures: number;
  compactions: number;
}

export interface FrictionSessionRow extends FrictionCounts {
  session_id: string;
  last_event_at: number;
}

export interface FrictionToolRow {
  tool_name: string;
  failures: number;
  interrupts: number;
  last_error: string | null;
  last_at: number;
}

export interface FrictionRepeatRow {
  session_id: string;
  tool_name: string;
  streak: number;
  first_at: number;
  last_at: number;
}

export interface FrictionSummary {
  totals: FrictionCounts;
  by_session: FrictionSessionRow[];
  top_failing_tools: FrictionToolRow[];
  repeated_failures: FrictionRepeatRow[];
  /** 읽은 이벤트 수와 상한에 걸려 잘렸는지. */
  scanned_events: number;
  truncated: boolean;
}

function emptyCounts(): FrictionCounts {
  return { tool_failures: 0, interrupts: 0, permission_requests: 0, permission_denied: 0, stop_failures: 0, compactions: 0 };
}

interface FailurePayload {
  tool_name?: string;
  error?: string;
  is_interrupt?: boolean;
}

function parsePayload(e: ClaudeEvent): FailurePayload {
  try {
    const p = JSON.parse(e.payload);
    return p && typeof p === 'object' ? (p as FailurePayload) : {};
  } catch {
    return {};
  }
}

/** 오류문의 첫 줄만, 최대 FRICTION_ERROR_MAX_CHARS 자. */
function clipError(error: unknown): string | null {
  if (typeof error !== 'string' || error === '') return null;
  const firstLine = error.split('\n', 1)[0].trim();
  return firstLine.length > FRICTION_ERROR_MAX_CHARS ? firstLine.slice(0, FRICTION_ERROR_MAX_CHARS) : firstLine;
}

/**
 * 이미 읽은 이벤트를 집계한다(순수 함수 — DB 접근 없음).
 *
 * @param events 순서 무관. 내부에서 시간 오름차순으로 정렬한다.
 */
export function summarizeFriction(
  events: ClaudeEvent[],
  opts: { repeatMin?: number } = {},
): Omit<FrictionSummary, 'scanned_events' | 'truncated'> {
  const repeatMin = Math.max(2, opts.repeatMin ?? 3);
  const sorted = events.slice().sort((a, b) => a.timestamp - b.timestamp);

  const totals = emptyCounts();
  const sessions = new Map<string, FrictionSessionRow>();
  const tools = new Map<string, FrictionToolRow>();
  // 세션별 실패 이벤트 열 — 연속 실패 계산용.
  const failureSeq = new Map<string, Array<{ tool: string; at: number }>>();

  for (const e of sorted) {
    let s = sessions.get(e.session_id);
    if (!s) {
      s = { session_id: e.session_id, ...emptyCounts(), last_event_at: e.timestamp };
      sessions.set(e.session_id, s);
    }
    s.last_event_at = Math.max(s.last_event_at, e.timestamp);

    switch (e.event_type) {
      case 'PostToolUseFailure': {
        const p = parsePayload(e);
        const tool = p.tool_name || 'unknown';
        const interrupted = p.is_interrupt === true;
        totals.tool_failures++; s.tool_failures++;
        if (interrupted) { totals.interrupts++; s.interrupts++; }

        let t = tools.get(tool);
        if (!t) { t = { tool_name: tool, failures: 0, interrupts: 0, last_error: null, last_at: e.timestamp }; tools.set(tool, t); }
        t.failures++;
        if (interrupted) t.interrupts++;
        t.last_at = e.timestamp;
        t.last_error = clipError(p.error) ?? t.last_error;

        const seq = failureSeq.get(e.session_id) ?? [];
        seq.push({ tool, at: e.timestamp });
        failureSeq.set(e.session_id, seq);
        break;
      }
      case 'PermissionRequest': totals.permission_requests++; s.permission_requests++; break;
      case 'PermissionDenied': totals.permission_denied++; s.permission_denied++; break;
      case 'StopFailure': totals.stop_failures++; s.stop_failures++; break;
      case 'PreCompact': totals.compactions++; s.compactions++; break;
      default: break;
    }
  }

  const repeated: FrictionRepeatRow[] = [];
  for (const [sessionId, seq] of failureSeq) {
    let runStart = 0;
    for (let i = 1; i <= seq.length; i++) {
      const prev = seq[i - 1];
      const cur = seq[i];
      const continues = cur !== undefined && cur.tool === prev.tool && cur.at - prev.at <= REPEAT_GAP_MS;
      if (continues) continue;
      const len = i - runStart;
      if (len >= repeatMin) {
        repeated.push({ session_id: sessionId, tool_name: prev.tool, streak: len, first_at: seq[runStart].at, last_at: prev.at });
      }
      runStart = i;
    }
  }

  return {
    totals,
    by_session: [...sessions.values()]
      .sort((a, b) => friction(b) - friction(a) || b.last_event_at - a.last_event_at)
      .slice(0, BY_SESSION_MAX),
    top_failing_tools: [...tools.values()]
      .sort((a, b) => b.failures - a.failures || b.last_at - a.last_at)
      .slice(0, TOP_TOOLS_MAX),
    repeated_failures: repeated.sort((a, b) => b.streak - a.streak || b.last_at - a.last_at),
  };
}

/** 세션 정렬용 마찰 합계(압축은 마찰이라기보다 상태 변화라 제외). */
function friction(s: FrictionCounts): number {
  return s.tool_failures + s.permission_requests + s.permission_denied + s.stop_failures;
}

/**
 * 기간·세션·cwd 로 거른 마찰 이벤트를 읽어 집계한다.
 *
 * 호출자: server routes/friction.ts
 */
export function getFrictionSummary(db: Database, f: FrictionFilter): FrictionSummary {
  const limit = Math.min(Math.max(1, f.limit ?? FRICTION_DEFAULT_LIMIT), FRICTION_MAX_LIMIT);
  const events = getEventsByTypesInRange(db, {
    eventTypes: [...FRICTION_EVENT_TYPES],
    fromTs: f.fromTs,
    toTs: f.toTs,
    sessionId: f.sessionId,
    cwdPrefix: f.cwdPrefix,
    limit,
  });
  return {
    ...summarizeFriction(events, { repeatMin: f.repeatMin }),
    scanned_events: events.length,
    truncated: events.length >= limit,
  };
}
