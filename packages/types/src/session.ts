/**
 * Session 모델 — server/TUI/web 공통.
 *
 * DB 스키마(storage/src/schema.ts)와 1:1 매핑.
 * 이 슬롯에 두는 이유: TUI가 server response shape을 복제하지 않도록 하기 위함.
 */

/**
 * 세션 라이브 상태 — 서버 단일 결정.
 *
 *  - 'live'  : ended_at NULL + 최근 STALE_THRESHOLD 이내 visible 활동
 *  - 'stale' : ended_at NULL + 최근 활동 없음 (SessionEnd 누락 의심)
 *  - 'ended' : ended_at IS NOT NULL (정상 종료)
 *
 * 정의는 storage/queries/session/_shared.ts(LIVE_STALE_THRESHOLD_MS,
 * buildLiveStateColumn) SSoT. 클라이언트는 이 필드 분기만 한다 — 자체 시각으로
 * 재계산 금지.
 */
export type SessionLiveState = 'live' | 'stale' | 'ended';

/**
 * 세션 엔티티 타입 (DB row 1:1 + derive).
 */
export interface Session {
  id: string;
  project_name: string;
  started_at: number;
  ended_at: number | null;
  total_tokens: number;
  created_at?: number;
  /** v22+: 첫 prompt 페이로드 (사이드바 미리보기용) */
  first_prompt_payload?: string | null;
  /** v22+: 마지막 활동 시각 (Stop 훅 또는 마지막 request) */
  last_activity_at?: number | null;
  /** v(이번)+: 서버가 결정한 라이브 상태. /api/sessions* 응답 derived 컬럼. */
  live_state?: SessionLiveState;
}
