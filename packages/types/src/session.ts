/**
 * Session 모델 — server/TUI/web 공통.
 *
 * DB 스키마(storage/src/schema.ts)와 1:1 매핑.
 * 이 슬롯에 두는 이유: TUI가 server response shape을 복제하지 않도록 하기 위함.
 */

/**
 * 세션 엔티티 타입 (DB row 1:1).
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
}
