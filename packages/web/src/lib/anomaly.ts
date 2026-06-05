// @ts-check
// anomaly.js — 서버 응답 표시 헬퍼 (ADR-003 적용으로 계산 로직 폐기)
//
// 변경 이력 (anomaly-bloated-sys ADR-003):
//   기존: 서버 응답을 받아 클라이언트에서 spike/loop/slow + bloated-sys/agent-spike 재계산.
//   현재: 서버 단일 SSoT. /api/requests, /api/sessions/*/requests, SSE new_request 응답에
//        포함된 `bloated_sys` / `agent_spike` 필드 + (선택) 기존 spike/loop/slow 응답 필드를
//        그대로 표시.
//
// 본 파일은 표시 매핑 헬퍼만 유지하며, DB·임계·재귀 SQL 계산은 하지 않는다.
// 거울 동기화 비용을 제거하고 계산 책임을 서버로 일원화한다.
//
// SSoT 쌍 (반드시 함께 변경):
//  - packages/server/src/metrics/calculators/anomaly.ts (검출 알고리즘)
//  - packages/server/src/domain/anomaly-enricher.ts (행 부여 정책)
//  - packages/types/src/request.ts (NormalizedRequest.bloated_sys / agent_spike)
//
// @see .claude/docs/plans/anomaly-bloated-sys/adr.md ADR-003

import type { RowAnomalyReader } from './view-types';

/**
 * 행 객체에서 서버가 채운 anomaly 플래그 Set 을 추출 (표시용).
 *
 * 서버는 다음 필드를 각 행에 부여한다 (anomaly-enricher.ts):
 *  - bloated_sys: { stage: 'warn'|'critical'|null, pct, system_tokens, ... } | null
 *  - agent_spike: { stage: 'spike'|null, multiplier, ... } | null
 *  - spike:       { stage: 'spike'|null } | null   (v2.0.1 회귀 복원)
 *  - loop:        { stage: 'loop'|null  } | null   (v2.0.1 회귀 복원)
 *  - slow:        { stage: 'slow'|null, p95_ms? } | null (v2.0.1 회귀 복원)
 *
 * spike/loop/slow는 ADR-003 정책상 서버에서 계산 → 본 헬퍼는 stage 표시만 한다.
 * 클라이언트 거울 계산 금지 — 입력은 항상 서버 응답 필드.
 *
 * @param {object} r — NormalizedRequest 형태의 응답 행
 * @returns {Set<'bloated-sys-warn'|'bloated-sys-critical'|'agent-spike'|'spike'|'loop'|'slow'>}
 */
export function getAnomalyFlagsForRow(r: unknown) {
  const flags = new Set<string>();
  if (!r || typeof r !== 'object') return flags;
  const row = r as RowAnomalyReader;

  const bs = row.bloated_sys;
  if (bs && bs.stage === 'warn') flags.add('bloated-sys-warn');
  if (bs && bs.stage === 'critical') flags.add('bloated-sys-critical');

  const as = row.agent_spike;
  if (as && as.stage === 'spike') flags.add('agent-spike');

  // v2.0.1 회귀 복원 — spike/loop/slow 행 필드 부착 매핑.
  if (row.spike && row.spike.stage === 'spike') flags.add('spike');
  if (row.loop  && row.loop.stage  === 'loop')  flags.add('loop');
  if (row.slow  && row.slow.stage  === 'slow')  flags.add('slow');

  return flags;
}
