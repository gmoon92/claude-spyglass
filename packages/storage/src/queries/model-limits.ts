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
