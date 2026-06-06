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
import { ACTIVE_REQUEST_FILTER_SQL, decodeRequestRows } from './read';

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

  const rows = db.query(`
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

  // R3: 모든 read 출구에서 payload/preview를 평문으로 복원 — 복호 정책 SSoT 는 read.ts
  return decodeRequestRows(rows).map(({ payload_algo, preview_algo, ...row }) => row);
}
