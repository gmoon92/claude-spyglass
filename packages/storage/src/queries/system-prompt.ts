/**
 * System Prompt CRUD — content-addressable dedup 정규화 카탈로그 (v22 / ADR-001, ADR-005)
 *
 * 책임:
 *  - body.system 본문을 hash 기반으로 1회만 저장하고 매 참조마다 ref_count 증가.
 *  - 라이브러리 패널(옵션 B) 목록 조회 + 단건 본문 lazy-fetch 제공.
 *
 * 데이터 모델 (system_prompts 테이블, 022-system-prompts.sql 참조):
 *  - hash             : SHA-256(normalized) hex 64자, PK (content-addressable)
 *  - content          : 정규화된 system 본문 (idx[0] billing-header 제외)
 *  - byte_size        : UI 'X KB' 라벨용 캐시
 *  - segment_count    : 정규화에 사용된 text 항목 수
 *  - first_seen_at    : 최초 INSERT 시각 (ms)
 *  - last_seen_at     : 마지막 사용 시각 (ms) — UPSERT마다 갱신
 *  - ref_count        : 참조된 proxy_requests 수 — UPSERT마다 +1
 *
 * 호출자:
 *  - proxy/handler.ts: 요청 응답 종료 직전 db.transaction 안에서 upsertSystemPrompt 호출
 *  - api.ts: GET /api/system-prompts (목록), /api/system-prompts/:hash (본문 lazy)
 *
 * 의존성: bun:sqlite Database
 *
 * 모듈 경계 (ADR-007): v21 system_reminder(user 메시지 안 reminder)와 다른 채널.
 *  본 모듈은 body.system 본문 dedup만 담당하며 system_reminder와 데이터를 섞지 않는다.
 */

import type { Database } from 'bun:sqlite';

// =============================================================================
// 타입 정의
// =============================================================================

/** system_prompts 행 전체 (본문 포함). 단건 lazy-fetch 결과. */
export interface SystemPromptRow {
  hash: string;
  content: string;
  byte_size: number;
  segment_count: number;
  first_seen_at: number;
  last_seen_at: number;
  ref_count: number;
  created_at: number;
}

/** 라이브러리 목록용 — 본문(content) 제외, 메타만. JOIN/응답 페이로드를 가볍게 유지. */
export interface SystemPromptSummary {
  hash: string;
  byte_size: number;
  segment_count: number;
  first_seen_at: number;
  last_seen_at: number;
  ref_count: number;
}

/** UPSERT 입력 — system-hash.ts NormalizedSystem + nowMs(요청 timestamp). */
export interface UpsertSystemPromptParams {
  hash: string;
  content: string;
  byteSize: number;
  segmentCount: number;
  /** 요청 시점 timestamp(ms). 신규면 first_seen_at·last_seen_at 둘 다, 기존이면 last_seen_at 갱신용. */
  nowMs: number;
}

/** listSystemPrompts 정렬 옵션 — 라이브러리 패널 UX. */
export type SystemPromptOrderBy =
  | 'last_seen_at'
  | 'ref_count'
  | 'byte_size'
  | 'first_seen_at';

// =============================================================================
// SQL
// =============================================================================

/**
 * UPSERT (ADR-005): hash 충돌 시 last_seen_at 갱신 + ref_count + 1.
 * single statement이므로 bun:sqlite에서 atomic.
 *
 * NOTE: ON CONFLICT의 excluded.last_seen_at은 INSERT 시도하던 행의 last_seen_at(=nowMs).
 *       기존 행의 last_seen_at보다 더 이르면(시간 역행 케이스) 그대로 덮어쓰므로,
 *       호출자가 nowMs를 정상적인 요청 타임스탬프로 보장해야 한다.
 */
const SQL_UPSERT = `
  INSERT INTO system_prompts (hash, content, byte_size, segment_count, first_seen_at, last_seen_at, ref_count)
  VALUES (?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(hash) DO UPDATE SET
    last_seen_at = excluded.last_seen_at,
    ref_count    = ref_count + 1
`;

const SQL_GET_BY_HASH = `
  SELECT hash, content, byte_size, segment_count, first_seen_at, last_seen_at, ref_count, created_at
  FROM system_prompts
  WHERE hash = ?
`;

// 목록은 content 제외 (본문 28KB가 100건이면 응답 2.8MB — 라이브러리 패널 표 표시에 불필요).
const SQL_LIST_BASE = `
  SELECT hash, byte_size, segment_count, first_seen_at, last_seen_at, ref_count
  FROM system_prompts
`;

// =============================================================================
// CRUD
// =============================================================================

/**
 * system_prompts UPSERT — INSERT OR (ON CONFLICT) UPDATE.
 *
 * proxy/handler.ts에서 db.transaction 내부에 createProxyRequest와 함께 호출되어
 * 두 INSERT가 원자적으로 commit된다 (ADR-005).
 *
 * @param db   bun:sqlite Database
 * @param p    UpsertSystemPromptParams (hash + content + byteSize + segmentCount + nowMs)
 */
export function upsertSystemPrompt(db: Database, p: UpsertSystemPromptParams): void {
  db.run(SQL_UPSERT, [
    p.hash,
    p.content,
    p.byteSize,
    p.segmentCount,
    p.nowMs,
    p.nowMs,
  ]);
}

/**
 * 단건 본문 lazy-fetch — UI에서 system_hash 클릭 시 호출되는 endpoint(/api/system-prompts/:hash) 백엔드.
 *
 * @returns SystemPromptRow 또는 hash 미존재 시 null
 */
export function getSystemPromptByHash(db: Database, hash: string): SystemPromptRow | null {
  return (db.query(SQL_GET_BY_HASH).get(hash) as SystemPromptRow | null) ?? null;
}

/**
 * 라이브러리 목록 조회 — 본문 제외 메타만.
 *
 * 정렬은 라이브러리 패널의 UX 결정에 따라 호출자가 선택.
 *  - last_seen_at DESC : 최근 사용 순 (기본)
 *  - ref_count DESC    : 빈도 높은 페르소나 순
 *  - byte_size DESC    : 큰 system 우선 (cache miss 비용 신호)
 *  - first_seen_at DESC: 새로 등장한 순
 *
 * @param limit 기본 100, 상한은 호출자가 보호 (api 라우터 단)
 */
export function listSystemPrompts(
  db: Database,
  options: { limit?: number; orderBy?: SystemPromptOrderBy } = {},
): SystemPromptSummary[] {
  const limit = options.limit ?? 100;
  const orderBy: SystemPromptOrderBy = options.orderBy ?? 'last_seen_at';
  // ORDER BY 컬럼은 화이트리스트 검증된 4종 — SQL injection 안전.
  const sql = `${SQL_LIST_BASE} ORDER BY ${orderBy} DESC LIMIT ?`;
  return db.query(sql).all(limit) as SystemPromptSummary[];
}
