/**
 * Anomaly enricher — NormalizedRequest 배열에 `bloated_sys` / `agent_spike` 필드 부여.
 *
 * @description
 *   anomaly-bloated-sys ADR-003 (서버 단일 SSoT) 적용 지점.
 *   라우트(`requests.ts` / `sessions.ts`)가 normalizeRequests 후 본 함수를 호출하여
 *   클라이언트에 노출할 anomaly 결과를 행 단위로 채운다.
 *
 *   부여 정책:
 *   - bloated_sys: 첫 prompt 행 1건에만 부여 (단일 prompt 세션 포함 — ADR-001 흡수).
 *                  proxy_requests에서 `system_byte_size`/`model`/`anthropic_beta`를 조회해 계산.
 *   - agent_spike: tool_name 이 Agent/Skill/Task 계열인 tool_call 행에 부여.
 *                  WITH RECURSIVE 깊이 3으로 자식 합산해 AND 조건 검증.
 *
 *   부여되지 않은 행은 필드를 `null`로 둔다 (응답 contract 일관성).
 *
 * @see packages/server/src/metrics/calculators/anomaly.ts (`detectBloatedSys` / `detectAgentSpike`)
 * @see packages/types/src/request.ts (`NormalizedRequest.bloated_sys` / `agent_spike`)
 * @see .claude/docs/plans/anomaly-bloated-sys/adr.md ADR-001 / ADR-002 / ADR-003
 */

import type { Database } from 'bun:sqlite';
import { getSessionSystemContextMeta } from '@spyglass/storage';
import {
  computeRowAnomalies,
  detectAgentSpike,
  detectBloatedSys,
  toAgentSpikeField,
  toBloatedSysField,
} from '../metrics/calculators/anomaly';
import type { NormalizedRequest } from './request-normalizer';

/**
 * NormalizedRequest 배열에 anomaly 필드를 부여.
 *
 * pure function 아님 — DB를 읽지만 외부 상태는 변경하지 않는다.
 * 반환은 새로운 배열(원본 보존). 입력 배열의 각 요소는 spread로 복사 후 anomaly 필드 추가.
 *
 * 비용:
 *   - bloated_sys 조회: 세션 수만큼 `getSessionSystemContextMeta` (인덱스로 가벼움).
 *     같은 세션의 여러 prompt가 있으면 첫 prompt 1건에만 부여 → 호출 메모이즈.
 *   - agent_spike 조회: Agent/Skill/Task 후보 행 수만큼 WITH RECURSIVE (인덱스 사용).
 *
 *   /api/requests 한 페이지 200건 기준 cold-cache 200~500ms 예상. 캐시 후 1ms 이하.
 *
 * @param db — DB 인스턴스
 * @param rows — 정규화된 행 배열
 * @returns anomaly 필드가 채워진 새 배열
 */
export function enrichWithAnomalies(
  db: Database,
  rows: NormalizedRequest[],
): NormalizedRequest[] {
  if (rows.length === 0) return rows;

  // 세션별 system_byte_size 메타 캐시 (같은 세션 여러 행이 있어도 한 번만 조회).
  const sessionMetaCache = new Map<
    string,
    ReturnType<typeof getSessionSystemContextMeta>
  >();
  const getSessionMeta = (sessionId: string) => {
    if (!sessionMetaCache.has(sessionId)) {
      sessionMetaCache.set(sessionId, getSessionSystemContextMeta(db, sessionId));
    }
    return sessionMetaCache.get(sessionId) ?? null;
  };

  // 첫 prompt 행 식별 — 세션별 timestamp ASC로 정렬한 뒤 첫 prompt 1건.
  // rows는 일반적으로 DESC로 들어오므로 세션별로 sortedAsc 후 첫 prompt를 찾는다.
  const firstPromptIds = computeFirstPromptIdsBySession(rows);

  // v2.0.1 회귀 복원: spike/loop/slow 페이지 단위 검출 (id → stages 맵).
  // SSE 단일 행 경로(enrichRowWithAnomalies)에는 적용 안 함 — 페이지 컨텍스트 부재.
  const rowStages = computeRowAnomalies(
    rows.map((r) => ({
      id: r.id,
      session_id: r.session_id ?? null,
      turn_id: r.turn_id ?? null,
      type: r.type,
      tool_name: r.tool_name ?? null,
      timestamp: r.timestamp,
      tokens_input: r.tokens_input,
      duration_ms: r.duration_ms,
    })),
  );

  return rows.map((r) => {
    const next: NormalizedRequest = {
      ...r,
      bloated_sys: null,
      agent_spike: null,
      spike: null,
      loop: null,
      slow: null,
    };

    // ── spike/loop/slow 부여 (페이지 컨텍스트) ──
    const stages = rowStages.get(r.id);
    if (stages) {
      if (stages.spike.stage) next.spike = stages.spike;
      if (stages.loop.stage) next.loop = stages.loop;
      if (stages.slow.stage) next.slow = stages.slow;
    }

    // ── bloated_sys: 첫 prompt 행 1건에만 부여 ──
    if (r.type === 'prompt' && r.session_id && firstPromptIds.has(r.id)) {
      const meta = getSessionMeta(r.session_id);
      if (meta) {
        const result = detectBloatedSys(db, {
          systemByteSize: meta.system_byte_size,
          model: meta.model ?? r.model ?? null,
          anthropicBeta: meta.anthropic_beta,
          projectId: meta.project_name,
        });
        // stage가 null이어도 부가 표시(pct·tokens)는 유용하므로 항상 객체로 부여.
        next.bloated_sys = toBloatedSysField(result);
      }
    }

    // ── agent_spike: Agent/Skill/Task 부모 tool_call 행에 부여 ──
    if (r.type === 'tool_call' && r.tool_use_id) {
      const tn = r.tool_name ?? null;
      if (
        tn === 'Agent' ||
        tn === 'Skill' ||
        tn === 'Task' ||
        (tn && (tn.startsWith('Agent') || tn.startsWith('Skill') || tn.startsWith('Task')))
      ) {
        const meta = r.session_id ? getSessionMeta(r.session_id) : null;
        const result = detectAgentSpike(db, {
          tool_use_id: r.tool_use_id,
          tool_name: tn,
          tokens_total: r.tokens_total,
          model: r.model ?? meta?.model ?? null,
          anthropic_beta: meta?.anthropic_beta ?? null,
          project_id: meta?.project_name ?? null,
        });
        next.agent_spike = toAgentSpikeField(result);
      }
    }

    return next;
  });
}

/**
 * 입력 행에서 세션별 첫 prompt id 집합 추출.
 *
 * /api/requests는 보통 timestamp DESC 정렬이라 같은 세션의 prompt를 만나면
 * 가장 마지막에 나오는 prompt가 "첫 prompt"다. 단순히 세션별 가장 작은 timestamp의
 * prompt id를 모으는 방식으로 정확히 식별.
 */
function computeFirstPromptIdsBySession(rows: NormalizedRequest[]): Set<string> {
  const earliestBySession = new Map<string, NormalizedRequest>();
  for (const r of rows) {
    if (r.type !== 'prompt' || !r.session_id) continue;
    const prev = earliestBySession.get(r.session_id);
    if (!prev || r.timestamp < prev.timestamp) {
      earliestBySession.set(r.session_id, r);
    }
  }
  return new Set([...earliestBySession.values()].map((r) => r.id));
}

/**
 * 단일 행 enrich — SSE 브로드캐스트 직전에 한 행만 보강할 때 사용.
 *
 * 정책:
 *  - prompt 행: 세션의 system_byte_size 조회 → bloated_sys 부여 (해당 행이 첫 prompt인지는
 *    상위 호출자가 판단하기 어려우므로 SSE에서는 일단 부여 — 클라이언트가 첫 prompt 여부를
 *    state로 들고 있다면 표시 분기 가능).
 *  - tool_call(Agent/Skill/Task): agent_spike 부여.
 *
 * @param db — DB 인스턴스
 * @param row — 정규화된 행
 */
export function enrichRowWithAnomalies(
  db: Database,
  row: NormalizedRequest,
): NormalizedRequest {
  // spike/loop/slow는 페이지 컨텍스트(세션 평균 / 턴 루프 / 전체 P95) 의존이라
  // 단일 행 enrich 경로에서는 검출 불가 → null 유지. 클라이언트 새로고침/페이지 fetch 시 흡수됨.
  const next: NormalizedRequest = {
    ...row,
    bloated_sys: null,
    agent_spike: null,
    spike: null,
    loop: null,
    slow: null,
  };

  if (row.type === 'prompt' && row.session_id) {
    const meta = getSessionSystemContextMeta(db, row.session_id);
    if (meta) {
      const result = detectBloatedSys(db, {
        systemByteSize: meta.system_byte_size,
        model: meta.model ?? row.model ?? null,
        anthropicBeta: meta.anthropic_beta,
        projectId: meta.project_name,
      });
      next.bloated_sys = toBloatedSysField(result);
    }
  }

  if (row.type === 'tool_call' && row.tool_use_id) {
    const tn = row.tool_name ?? null;
    if (
      tn === 'Agent' ||
      tn === 'Skill' ||
      tn === 'Task' ||
      (tn && (tn.startsWith('Agent') || tn.startsWith('Skill') || tn.startsWith('Task')))
    ) {
      const meta = row.session_id ? getSessionSystemContextMeta(db, row.session_id) : null;
      const result = detectAgentSpike(db, {
        tool_use_id: row.tool_use_id,
        tool_name: tn,
        tokens_total: row.tokens_total,
        model: row.model ?? meta?.model ?? null,
        anthropic_beta: meta?.anthropic_beta ?? null,
        project_id: meta?.project_name ?? null,
      });
      next.agent_spike = toAgentSpikeField(result);
    }
  }

  return next;
}

// =============================================================================
// 세션 단위 요약 — 헤더 뱃지(`▤ sys 82%`)와 사이드바 dot(critical만) 노출용 (ADR-005)
// =============================================================================

/**
 * 세션 단위 bloated-sys 요약 — API 응답에 함께 노출하기 위한 미리 계산 결과.
 *
 * 트랙 B(designer)가 세션 헤더 / 사이드바 dot에 사용한다.
 * `stage === null`이면 anomaly 없음.
 */
export interface SessionAnomalySummary {
  bloated_sys: ReturnType<typeof toBloatedSysField> | null;
}

/**
 * 세션 1건의 bloated-sys 요약 계산.
 *
 * 사용처: GET /api/sessions/:id 응답에 같이 실어 트랙 B가 헤더 full 뱃지를 그릴 수 있게 한다.
 */
export function summarizeSessionAnomalies(
  db: Database,
  sessionId: string,
): SessionAnomalySummary {
  const meta = getSessionSystemContextMeta(db, sessionId);
  if (!meta) return { bloated_sys: null };
  const result = detectBloatedSys(db, {
    systemByteSize: meta.system_byte_size,
    model: meta.model,
    anthropicBeta: meta.anthropic_beta,
    projectId: meta.project_name,
  });
  return { bloated_sys: toBloatedSysField(result) };
}
