/**
 * Model Limits — 모델별 context window 한도 SSoT (Migration 026)
 *
 * @description
 *   모델 → max_tokens 매핑을 코드 하드코딩이 아닌 데이터로 관리한다.
 *   spyglass는 단일 사용자 도구가 아니라 운영 환경 전반에서 쓰이므로,
 *   신규 모델(Anthropic Opus/Sonnet/Haiku, Moonshot Kimi 등)이 등장할 때마다
 *   코드/환경변수를 갱신할 필요가 없도록 DB 시드 + 운영자 직접 SQL 수정으로 진화시킨다.
 *
 *   본 모듈은 raw SELECT만 제공하고, 추론 로직(헤더·suffix 우선순위 등)은
 *   server/src/model-limits.ts 가 담당한다.
 */

import type { Database } from 'bun:sqlite';

export interface ModelLimitRow {
  /** 모델명에 포함되면 매칭되는 패턴 (substring match — 코드에서 최장 우선 매칭). */
  pattern: string;
  /** 토큰 단위 context window 한도. */
  max_tokens: number;
  /** 출처/근거 (운영자 메모 — UI 노출 가능). */
  notes: string | null;
}

/**
 * model_limits 테이블의 모든 행을 반환.
 * 호출자(server model-limits)는 프로세스 라이프 동안 결과를 캐시한다.
 */
export function getAllModelLimits(db: Database): ModelLimitRow[] {
  return db.query(
    'SELECT pattern, max_tokens, notes FROM model_limits ORDER BY length(pattern) DESC, pattern ASC',
  ).all() as ModelLimitRow[];
}

/**
 * model별 관측된 최대 컨텍스트 크기를 proxy_requests에서 추출.
 *
 * @description
 *   "요청 페이로드 = 진리" 정책의 데이터 소스. CLI가 운영하는 실제 컨텍스트 한도는
 *   spyglass가 미리 알 수 없으므로, 그 모델로 실제 흘러간 요청의 최대 컨텍스트를
 *   하한선으로 사용한다.
 *
 *   "컨텍스트 크기"는 `tokens_input + cache_creation_tokens + cache_read_tokens`로 정의 —
 *   클라이언트 차트의 `context_tokens` 정의와 동일(SSoT).
 *
 *   exact match — `proxy_requests.model = ?`. prefix/substring 매칭 안 함.
 *   (CLI별로 model 문자열이 분리되어 들어오므로 정확 일치가 정답.)
 *
 *   NULL/0 행은 SUM에 영향 없음 (COALESCE 처리).
 *
 * 호출자: server/src/model-limits.ts `getModelMaxTokens()` —
 *   시드(`model_limits`)와 max(seed, observedMax) 결합 정책.
 *
 * @param db DB 인스턴스
 * @param model 정확한 model 문자열 (proxy_requests.model)
 * @returns 관측된 최대 컨텍스트 토큰. 해당 model 요청이 0건이면 0.
 */
export function getObservedMaxContextForModel(db: Database, model: string): number {
  // 테스트 in-memory DB처럼 proxy_requests 테이블 자체가 없는 환경에서도 안전해야 한다.
  // 부재 시 관측치 0 → 호출자(getModelMaxTokens)에서 max(seed, 0) = seed로 자연스럽게 폴백.
  try {
    const row = db.query(
      `SELECT COALESCE(MAX(
         COALESCE(tokens_input, 0)
         + COALESCE(cache_creation_tokens, 0)
         + COALESCE(cache_read_tokens, 0)
       ), 0) AS observed_max
       FROM proxy_requests
       WHERE model = ?`,
    ).get(model) as { observed_max: number } | undefined;
    return row?.observed_max ?? 0;
  } catch {
    return 0;
  }
}
