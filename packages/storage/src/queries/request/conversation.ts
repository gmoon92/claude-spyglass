/**
 * Conversation 조회 — 날짜 범위 프롬프트·응답 대화 추출 (SELECT 전용).
 *
 * @description
 *   `GET /api/conversations` (주간 업무 보고·사용 패턴 분석) 전용 read 쿼리.
 *   이 파일의 변경 이유: "대화 프로젝션 정책 (어떤 행을 대화로 보는가) 변경" —
 *   read.ts(필터·정렬·페이지네이션 정책)와 변경 축이 달라 분리.
 *
 *   포함 행: type IN ('prompt','response') — 툴 호출(tool_call) 제외.
 *   payload/preview는 SELECT 출구에서 decodeText로 복호해 평문으로 반환한다
 *   (R3 at-rest 암호화 — preview SELECT 신규 경로는 decodeText 필수, Migration 057).
 *
 *   날짜 파싱 책임 없음 — 호출자(server 라우트)가 ISO 날짜를 ms로 변환해 넘긴다.
 */

import type { Database } from 'bun:sqlite';
import { ACTIVE_REQUEST_FILTER_SQL, decodeRequestRows, isActiveRequest } from './read';
import { archiveHasRowsInRange, getArchiveIndexRows, loadArchiveRows, getArchiveDir, FileArchiveStore } from '../../archive';

/** 대화 행 — 세션 메타(JOIN) + 디코드된 평문 본문 */
export interface ConversationRow {
  session_id: string;
  /** sessions.project_name */
  project_name: string;
  /** sessions.started_at */
  started_at: number;
  timestamp: number;
  type: 'prompt' | 'response';
  /** 디코드된 평문 JSON (raw hook payload) — 전문 추출 원천 */
  payload: string | null;
  /** 디코드된 평문 미리보기 (≤2000자) — payload 추출 실패 시 폴백 */
  preview: string | null;
}

type RawConversationRow = ConversationRow & {
  payload_algo: string | null;
  preview_algo: string | null;
};

/**
 * 날짜 범위 [fromTs, toTs] (ms)의 prompt·response 행을 세션 메타와 함께 조회.
 *
 * - project 지정 시 sessions.project_name 일치 행만 (idx_sessions_project)
 * - 정렬: session_id ASC → timestamp ASC (호출자가 1-pass 세션 그룹핑 가능)
 * - limit: 안전장치 상한 (호출자가 limit+1로 절단 감지)
 */
export function getConversationRows(
  db: Database,
  fromTs: number,
  toTs: number,
  project: string | undefined,
  limit: number,
): ConversationRow[] {
  const conditions = [
    "r.type IN ('prompt', 'response')",
    // sessions에 event_type/tool_name 컬럼이 없어 비한정 참조여도 모호성 없음
    ACTIVE_REQUEST_FILTER_SQL,
    'r.timestamp >= ?',
    'r.timestamp <= ?',
  ];
  const params: (string | number)[] = [fromTs, toTs];
  if (project) {
    conditions.push('s.project_name = ?');
    params.push(project);
  }
  params.push(limit);

  const hot = db.query(`
    SELECT
      r.session_id, s.project_name, s.started_at,
      r.timestamp, r.type,
      p.payload, p.payload_algo, r.preview, r.preview_algo
    FROM requests r
    JOIN sessions s ON s.id = r.session_id
    LEFT JOIN request_payloads p ON p.request_id = r.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY r.session_id ASC, r.timestamp ASC
    LIMIT ?
  `).all(...params) as RawConversationRow[];

  // Archive 병합: requests가 이주됐으면 Hot+Archive를 (session_id, timestamp) 복합 정렬로 병합.
  // router는 단일 timestamp 정렬이라 여기선 전용 병합. archive_index 비면 Hot 그대로(무변경).
  let merged = hot;
  if (archiveHasRowsInRange(db, 'requests', fromTs, toTs)) {
    const arch = loadConversationArchiveRows(db, fromTs, toTs, project);
    if (arch.length > 0) {
      merged = [...hot, ...arch]
        .sort((a, b) => (a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : a.timestamp - b.timestamp))
        .slice(0, limit);
    }
  }

  // R3: 모든 read 출구에서 payload/preview를 평문으로 복원 — 복호 정책 SSoT 는 read.ts
  return decodeRequestRows(merged).map(({ payload_algo, preview_algo, ...row }) => row);
}

/**
 * Archive된 requests 행을 ConversationRow(raw, decode 전) 형태로 로드한다.
 * 필터(type IN prompt/response, active, project) + Hot sessions 배치 JOIN(sessions 미이주라 Hot에 존재).
 * archive 라인의 off-row body 마커 `__payload`/`__payload_algo`를 payload 컬럼으로 매핑.
 */
function loadConversationArchiveRows(
  db: Database,
  fromTs: number,
  toTs: number,
  project: string | undefined,
): RawConversationRow[] {
  const store = new FileArchiveStore(getArchiveDir(db));
  const idx = getArchiveIndexRows(db, 'requests', { fromTs, toTs, order: 'ASC' });
  const rows = loadArchiveRows(store, idx, 'id') as Record<string, unknown>[];

  // type/active 1차 필터
  const candidates = rows.filter(
    (r) => (r.type === 'prompt' || r.type === 'response') && isActiveRequest(r as { event_type?: string | null; tool_name?: string | null }),
  );
  if (candidates.length === 0) return [];

  // sessions 배치 JOIN(Hot) — N+1 회피. inner JOIN 시맨틱(세션 없으면 제외).
  const sessionIds = [...new Set(candidates.map((r) => String(r.session_id)))];
  const placeholders = sessionIds.map(() => '?').join(',');
  const sessionMap = new Map<string, { project_name: string; started_at: number }>();
  for (const s of db.query(`SELECT id, project_name, started_at FROM sessions WHERE id IN (${placeholders})`).all(...sessionIds) as { id: string; project_name: string; started_at: number }[]) {
    sessionMap.set(s.id, { project_name: s.project_name, started_at: s.started_at });
  }

  const out: RawConversationRow[] = [];
  for (const r of candidates) {
    const s = sessionMap.get(String(r.session_id));
    if (!s) continue; // JOIN 대응
    if (project && s.project_name !== project) continue; // project 필터
    out.push({
      session_id: String(r.session_id),
      project_name: s.project_name,
      started_at: s.started_at,
      timestamp: r.timestamp as number,
      type: r.type as 'prompt' | 'response',
      payload: (r.__payload as string | null) ?? null,
      payload_algo: (r.__payload_algo as string | null) ?? null,
      preview: (r.preview as string | null) ?? null,
      preview_algo: (r.preview_algo as string | null) ?? null,
    });
  }
  return out;
}
