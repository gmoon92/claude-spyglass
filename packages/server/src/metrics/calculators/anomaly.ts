/**
 * Anomaly 시계열 계산기 — spike / loop / slow 검출 + 시간 버킷 카운트.
 *
 * @description
 *   srp-redesign Phase 3: server/metrics.ts(561줄) 분해 결과.
 *   변경 이유: "Anomaly 검출 알고리즘 변경 (spike 임계·loop streak·P95 정의)".
 *
 *   storage(getAnomalyTimeSeriesInputs) raw rows → 알고리즘 적용 → 시간 버킷 집계.
 *
 * 검출 규칙 (시계열):
 *   - spike: 세션별 prompt tokens_input 평균의 200% 초과
 *   - loop:  turn_id 내 동일 tool_name 연속 3회 이상
 *   - slow:  tool_call duration_ms가 전체 P95 초과
 *
 * 검출 규칙 (행 단위 — anomaly-bloated-sys ADR-001/002, 서버 단일 SSoT):
 *   - bloated-sys: proxy_requests.system_byte_size / 4 / getModelMaxTokens(model, beta) ≥ warn_pct/100
 *                  warn ≥ 15%, critical ≥ 25% (anomaly_thresholds 시드)
 *   - agent-spike: Agent/Skill/Task 부모의 자식 토큰 합(WITH RECURSIVE 깊이 3)이
 *                  (자식합 ≥ 윈도우 15%) AND (자식합 / 부모 ≥ 10×) AND 조건
 *
 *   ADR-003: 클라이언트 거울 동기화 폐기 — 본 함수의 결과를 SSE/응답 필드로 노출하면
 *   클라이언트는 표시만 한다. 거울 계산 금지.
 */

import type { Database } from 'bun:sqlite';
import { getMaxContextProxyForSession, type AnomalyInputRow } from '@spyglass/storage';
import { getModelMaxTokens } from '../../model-limits';
import {
  getAnomalyThresholds,
  type AnomalyThresholds,
} from '../../anomaly-thresholds';

export interface AnomalyTimeSeriesRow {
  timestamp: string;
  spike: number;
  loop: number;
  slow: number;
}

export function computeAnomalyTimeSeries(
  rows: AnomalyInputRow[],
  bucket: 'hour' | 'day'
): AnomalyTimeSeriesRow[] {
  // 1. 세션별 prompt 평균 (spike 기준)
  const sessionPromptInputs = new Map<string, number[]>();
  for (const r of rows) {
    if (r.type === 'prompt' && r.tokens_input > 0) {
      const arr = sessionPromptInputs.get(r.session_id) || [];
      arr.push(r.tokens_input);
      sessionPromptInputs.set(r.session_id, arr);
    }
  }
  const sessionAvg = new Map<string, number>();
  for (const [sid, arr] of sessionPromptInputs) {
    if (arr.length >= 2) {
      sessionAvg.set(sid, arr.reduce((s, x) => s + x, 0) / arr.length);
    }
  }

  // 2. 전체 P95 (slow 기준) — type='tool_call' duration_ms > 0
  const durations = rows
    .filter(r => r.type === 'tool_call' && r.duration_ms > 0)
    .map(r => r.duration_ms)
    .sort((a, b) => a - b);
  let p95 = 0;
  if (durations.length > 0) {
    const idx = Math.ceil(durations.length * 0.95) - 1;
    p95 = durations[Math.min(idx, durations.length - 1)];
  }

  // 3. loop: turn_id 그룹 → 연속 3회
  const loopFlagged = new Set<string>();
  const turnGroups = new Map<string, AnomalyInputRow[]>();
  for (const r of rows) {
    if (r.type === 'tool_call' && r.turn_id && r.tool_name) {
      const arr = turnGroups.get(r.turn_id) || [];
      arr.push(r);
      turnGroups.set(r.turn_id, arr);
    }
  }
  for (const [, calls] of turnGroups) {
    let streak = 1;
    for (let i = 1; i < calls.length; i++) {
      if (calls[i].tool_name === calls[i - 1].tool_name) {
        streak++;
        if (streak >= 3) {
          for (let j = i - streak + 1; j <= i; j++) {
            loopFlagged.add(calls[j].id);
          }
        }
      } else {
        streak = 1;
      }
    }
  }

  // 4. 버킷별 카운트
  const bucketSizeMs = bucket === 'day' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const buckets = new Map<number, { spike: number; loop: number; slow: number }>();

  for (const r of rows) {
    const bucketTs = Math.floor(r.timestamp / bucketSizeMs) * bucketSizeMs;
    const cell = buckets.get(bucketTs) || { spike: 0, loop: 0, slow: 0 };

    // spike
    if (r.type === 'prompt' && r.tokens_input > 0) {
      const avg = sessionAvg.get(r.session_id);
      if (avg !== undefined && r.tokens_input > avg * 2) cell.spike++;
    }
    // loop
    if (loopFlagged.has(r.id)) cell.loop++;
    // slow
    if (r.type === 'tool_call' && p95 > 0 && r.duration_ms > p95) cell.slow++;

    buckets.set(bucketTs, cell);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, v]) => ({
      timestamp: new Date(ts).toISOString(),
      spike: v.spike,
      loop: v.loop,
      slow: v.slow,
    }));
}

// =============================================================================
// bloated-sys / agent-spike 검출 (anomaly-bloated-sys ADR-001 / ADR-002)
// =============================================================================
//
// 본 영역은 단일 행 또는 단일 Agent 부모에 대한 anomaly 결과를 산출한다.
// ADR-003: 결과는 SSE/API 응답의 `bloated_sys` / `agent_spike` 필드로 노출되고
//          클라이언트는 표시만 한다(거울 계산 금지).
//
// SSoT 쌍 (참고용 — 본 구현은 서버 단일):
//  - packages/web/assets/js/anomaly.js (계산 로직 폐기, 표시 헬퍼만 유지)
//  - packages/web/assets/js/api.js (서버 응답 필드를 행 메타로 그대로 통과)
//
// @see .claude/docs/plans/anomaly-bloated-sys/adr.md ADR-001/002/003

/** bloated-sys 단계 — 둘 다 미만이면 null. */
export type BloatedSysStage = 'warn' | 'critical' | null;

/**
 * bloated-sys 결과 — `null`이면 anomaly 없음 (정상 행).
 *
 * 클라이언트는 `stage` 만으로 뱃지 분기. `pct` / `system_tokens` / 임계는 UI 부가 표시·툴팁용.
 */
export interface BloatedSysResult {
  /** 'warn' | 'critical' | null */
  stage: BloatedSysStage;
  /** system 토큰 추정값 (byte_size / 4) */
  system_tokens: number;
  /** 모델 윈도우 대비 비율 (0~1) */
  pct: number;
  /** 적용된 warn 임계 (소수 — 0.15 등) */
  threshold_warn: number;
  /** 적용된 critical 임계 (소수 — 0.25 등) */
  threshold_critical: number;
}

/** byte → token 환산 계수 (대략 추정 — ADR-001 합의안). */
const BYTES_PER_TOKEN = 4;

/**
 * bloated-sys 검출 — 단일 행(proxy_requests 또는 등가 입력) 단위.
 *
 * 알고리즘 (ADR-001):
 *   1) systemTokens = systemByteSize / 4
 *   2) windowMax    = getModelMaxTokens(db, model, anthropicBeta)
 *   3) pct = systemTokens / windowMax
 *   4) thresholds = getAnomalyThresholds(db, projectId, model)
 *      - pct ≥ critical_pct/100 → 'critical'
 *      - pct ≥ warn_pct/100     → 'warn'
 *      - 그 외                  → null
 *
 * 첫 prompt heavy 케이스(단일 prompt 세션)도 동일 임계로 흡수 (ADR-001).
 *
 * @param db — DB 인스턴스 (시드/캐시 조회용)
 * @param input — proxy_requests의 한 행에서 추출한 필수 필드
 * @returns BloatedSysResult — stage가 null이면 anomaly 없음
 */
export function detectBloatedSys(
  db: Database,
  input: {
    systemByteSize: number | null | undefined;
    model: string | null | undefined;
    anthropicBeta?: string | null | undefined;
    projectId?: string | null | undefined;
  },
): BloatedSysResult {
  const thresholds = getAnomalyThresholds(db, input.projectId ?? null, input.model ?? null);
  const warnFrac = thresholds.warnPct / 100;
  const criticalFrac = thresholds.criticalPct / 100;

  const sysBytes = input.systemByteSize ?? 0;
  if (sysBytes <= 0) {
    // system 본문이 없으면 anomaly 판정 불가 → 정상 처리.
    return emptyBloatedSys(0, 0, warnFrac, criticalFrac);
  }

  const systemTokens = Math.floor(sysBytes / BYTES_PER_TOKEN);
  const windowMax = getModelMaxTokens(db, input.model ?? null, input.anthropicBeta ?? null);
  // 분모 0 방어 (정상 운영에서는 발생하지 않지만 model_limits 시드가 비정상일 때 안전망).
  const pct = windowMax > 0 ? systemTokens / windowMax : 0;

  let stage: BloatedSysStage = null;
  if (pct >= criticalFrac) stage = 'critical';
  else if (pct >= warnFrac) stage = 'warn';

  return {
    stage,
    system_tokens: systemTokens,
    pct,
    threshold_warn: warnFrac,
    threshold_critical: criticalFrac,
  };
}

function emptyBloatedSys(
  systemTokens: number,
  pct: number,
  warnFrac: number,
  criticalFrac: number,
): BloatedSysResult {
  return {
    stage: null,
    system_tokens: systemTokens,
    pct,
    threshold_warn: warnFrac,
    threshold_critical: criticalFrac,
  };
}

// =============================================================================
// agent-spike (ADR-002)
// =============================================================================

/** agent-spike 단계 — 조건 미충족이면 null. */
export type AgentSpikeStage = 'spike' | null;

/**
 * agent-spike 결과 — `null`이면 anomaly 없음.
 *
 * 부모 Target 셀에 `↑×N` 표지(N = `multiplier`)를 노출하는 트리거. UI는 N≥3일 때만 ↑×N 표기.
 */
export interface AgentSpikeResult {
  stage: AgentSpikeStage;
  /** 자식합 / 부모 (배수 N) */
  multiplier: number;
  /** WITH RECURSIVE 깊이 3까지 자식 토큰 합 */
  child_token_sum: number;
  /** 직계 + 손자 + 증손자 자식 개수 (참고) */
  child_count: number;
  /** 부모 tokens_total */
  parent_token: number;
  /** 모델 윈도우 대비 자식합 비율 (0~1) — AND 조건 검증용 */
  pct_of_window: number;
  /** 적용된 warn 임계 (소수 — 0.15) */
  threshold_warn: number;
  /** 자식합/부모 배수 임계 (고정 10.0) */
  threshold_multiplier: number;
}

/**
 * agent-spike의 두 번째 AND 조건(자식합/부모 배수) 임계 — ADR-002 합의안.
 *
 * "10×" 는 코드 상수로 둔다 — anomaly_thresholds 테이블이 percentage 한 쌍만 다루므로
 * 모델/프로젝트별 차등이 현재 요구되지 않음. 향후 확장 시 별도 컬럼 추가 가능.
 */
const AGENT_SPIKE_MULTIPLIER_THRESHOLD = 10;

interface AgentSpikeChildRow {
  child_count: number;
  child_token_sum: number;
}

/**
 * agent-spike 검출 — Agent/Skill/Task 부모의 자식 토큰 폭증 (ADR-002).
 *
 * 알고리즘:
 *   1) WITH RECURSIVE 로 parent_tool_use_id 트리를 깊이 3까지 펼침 (Agent → Skill → Tool).
 *   2) 자식들의 tokens_total 합산 + 자식 행 개수 카운트.
 *   3) windowMax = getModelMaxTokens(db, model, beta) (분모 ADR-001과 동일).
 *   4) pctOfWindow = child_token_sum / windowMax
 *   5) multiplier  = child_token_sum / parent.tokens_total  (parent=0이면 0)
 *   6) AND 조건: pctOfWindow ≥ warn_pct/100 AND multiplier ≥ 10
 *
 * 부모 식별: tool_name이 'Agent' / 'Skill' / 'Task' 로 시작하면 후보.
 *  - 부모는 `tool_use_id` 필수 — 없으면 자식 매칭 불가라 skip.
 *  - `payload`나 `event_type`은 신경 쓰지 않음 (v8 이후 정상 tool 행만 들어옴).
 *
 * 호출자: T-05 routes/* 에서 응답 직전 각 부모 행에 대해 호출.
 *
 * @param db — DB 인스턴스
 * @param parent — 후보 부모 행 (Agent/Skill/Task tool_call)
 * @returns AgentSpikeResult — stage가 null이면 anomaly 없음
 */
export function detectAgentSpike(
  db: Database,
  parent: {
    tool_use_id: string | null | undefined;
    tool_name: string | null | undefined;
    tokens_total: number | null | undefined;
    model?: string | null | undefined;
    anthropic_beta?: string | null | undefined;
    project_id?: string | null | undefined;
  },
): AgentSpikeResult {
  const thresholds = getAnomalyThresholds(
    db,
    parent.project_id ?? null,
    parent.model ?? null,
  );
  const warnFrac = thresholds.warnPct / 100;
  const parentToken = parent.tokens_total ?? 0;
  const baseEmpty = (): AgentSpikeResult => ({
    stage: null,
    multiplier: 0,
    child_token_sum: 0,
    child_count: 0,
    parent_token: parentToken,
    pct_of_window: 0,
    threshold_warn: warnFrac,
    threshold_multiplier: AGENT_SPIKE_MULTIPLIER_THRESHOLD,
  });

  // 부모 식별 — tool_use_id가 없으면 자식 매칭 불가.
  if (!parent.tool_use_id) return baseEmpty();
  if (!isAgentSpikeParentCandidate(parent.tool_name ?? null)) return baseEmpty();

  // WITH RECURSIVE — parent_tool_use_id 체인을 깊이 3까지 펼침.
  // 시작점: parent.tool_use_id 와 동일한 parent_tool_use_id를 가진 직계 자식.
  // 재귀: 자식의 tool_use_id를 부모로 다시 자식 조회. depth ≤ 3 제한.
  let agg: AgentSpikeChildRow;
  try {
    agg = db
      .query<AgentSpikeChildRow, [string]>(
        `WITH RECURSIVE tree(tool_use_id, tokens_total, depth) AS (
           SELECT tool_use_id, tokens_total, 1
             FROM requests
            WHERE parent_tool_use_id = ?
              AND (event_type IS NULL OR event_type = 'tool')
           UNION ALL
           SELECT r.tool_use_id, r.tokens_total, tree.depth + 1
             FROM requests r
             JOIN tree ON r.parent_tool_use_id = tree.tool_use_id
            WHERE tree.depth < 3
              AND (r.event_type IS NULL OR r.event_type = 'tool')
         )
         SELECT
           COUNT(*)               AS child_count,
           COALESCE(SUM(tokens_total), 0) AS child_token_sum
         FROM tree`,
      )
      .get(parent.tool_use_id) as AgentSpikeChildRow | undefined ?? { child_count: 0, child_token_sum: 0 };
  } catch {
    // 인덱스/스키마 비정상 → 안전망 0으로 처리.
    return baseEmpty();
  }

  const childSum = agg.child_token_sum ?? 0;
  const childCount = agg.child_count ?? 0;

  const windowMax = getModelMaxTokens(db, parent.model ?? null, parent.anthropic_beta ?? null);
  const pctOfWindow = windowMax > 0 ? childSum / windowMax : 0;
  const multiplier = parentToken > 0 ? childSum / parentToken : 0;

  // AND 조건 — 두 조건 모두 통과해야 anomaly로 인정 (ADR-002).
  const conditionWindow = pctOfWindow >= warnFrac;
  const conditionMultiplier = multiplier >= AGENT_SPIKE_MULTIPLIER_THRESHOLD;
  const stage: AgentSpikeStage = conditionWindow && conditionMultiplier ? 'spike' : null;

  return {
    stage,
    multiplier,
    child_token_sum: childSum,
    child_count: childCount,
    parent_token: parentToken,
    pct_of_window: pctOfWindow,
    threshold_warn: warnFrac,
    threshold_multiplier: AGENT_SPIKE_MULTIPLIER_THRESHOLD,
  };
}

/**
 * agent-spike 배치 검출 (read-perf sprint 1) — 페이지의 모든 부모 후보를 단일 쿼리로 처리.
 *
 * 배경:
 *   기존 detectAgentSpike 는 부모 한 명에 대해 WITH RECURSIVE 깊이 3 호출.
 *   /api/requests 페이지 안에 Agent/Skill/Task 행이 N개면 N회 재귀 쿼리 — N+1 패턴.
 *
 * 알고리즘:
 *   단일 WITH RECURSIVE 가 모든 root_id 의 자손을 한 번에 펼친다.
 *   `parent_tool_use_id IN (?, ?, ...)` 으로 시작점 한정.
 *   결과 GROUP BY root_id 로 부모별 (child_count, child_token_sum) 회수.
 *
 * 후속 단계 (application):
 *   - 각 부모별 model / anthropic_beta / project_id 로 threshold 계산 (메모이즈 가능)
 *   - 자식 합산은 본 batch 결과 사용 → 재귀 쿼리 0번
 *
 * @param db
 * @param rootIds — 부모 tool_use_id 목록 (중복 제거 권장)
 * @returns Map<root_id, {child_count, child_token_sum}>
 */
export function detectAgentSpikeBatch(
  db: Database,
  rootIds: string[],
): Map<string, AgentSpikeChildRow> {
  const out = new Map<string, AgentSpikeChildRow>();
  if (rootIds.length === 0) return out;
  // 중복 제거
  const unique = Array.from(new Set(rootIds));
  const placeholders = unique.map(() => '?').join(',');

  let rows: Array<{ root_id: string; child_count: number; child_token_sum: number }>;
  try {
    rows = db
      .query(
        `WITH RECURSIVE tree(root_id, tool_use_id, tokens_total, depth) AS (
           SELECT parent_tool_use_id AS root_id, tool_use_id, tokens_total, 1
             FROM requests
            WHERE parent_tool_use_id IN (${placeholders})
              AND (event_type IS NULL OR event_type = 'tool')
           UNION ALL
           SELECT tree.root_id, r.tool_use_id, r.tokens_total, tree.depth + 1
             FROM requests r
             JOIN tree ON r.parent_tool_use_id = tree.tool_use_id
            WHERE tree.depth < 3
              AND (r.event_type IS NULL OR r.event_type = 'tool')
         )
         SELECT root_id,
                COUNT(*)                       AS child_count,
                COALESCE(SUM(tokens_total), 0) AS child_token_sum
           FROM tree
          GROUP BY root_id`,
      )
      .all(...unique) as Array<{ root_id: string; child_count: number; child_token_sum: number }>;
  } catch {
    // 인덱스/스키마 비정상 → 빈 결과 (호출자가 baseEmpty 처리 동일).
    return out;
  }

  for (const row of rows) {
    out.set(row.root_id, {
      child_count: row.child_count ?? 0,
      child_token_sum: row.child_token_sum ?? 0,
    });
  }
  return out;
}

/**
 * 배치 fetch 한 자식 합산을 활용해 agent_spike 결과 구성 — detectAgentSpike 와 동일 출력.
 *
 * detectAgentSpike 가 DB 조회까지 한 번에 하는 반면, 본 함수는 미리 페이지 단위 fetch 한
 * 자식 합산을 입력으로 받아 threshold 계산만 수행한다.
 */
export function buildAgentSpikeFromBatch(
  db: Database,
  parent: {
    tool_use_id: string | null | undefined;
    tool_name: string | null | undefined;
    tokens_total: number | null | undefined;
    model?: string | null | undefined;
    anthropic_beta?: string | null | undefined;
    project_id?: string | null | undefined;
  },
  child: AgentSpikeChildRow | undefined,
): AgentSpikeResult {
  const thresholds = getAnomalyThresholds(
    db,
    parent.project_id ?? null,
    parent.model ?? null,
  );
  const warnFrac = thresholds.warnPct / 100;
  const parentToken = parent.tokens_total ?? 0;
  const baseEmpty = (): AgentSpikeResult => ({
    stage: null,
    multiplier: 0,
    child_token_sum: 0,
    child_count: 0,
    parent_token: parentToken,
    pct_of_window: 0,
    threshold_warn: warnFrac,
    threshold_multiplier: AGENT_SPIKE_MULTIPLIER_THRESHOLD,
  });

  if (!parent.tool_use_id) return baseEmpty();
  if (!isAgentSpikeParentCandidate(parent.tool_name ?? null)) return baseEmpty();

  const childSum = child?.child_token_sum ?? 0;
  const childCount = child?.child_count ?? 0;

  const windowMax = getModelMaxTokens(db, parent.model ?? null, parent.anthropic_beta ?? null);
  const pctOfWindow = windowMax > 0 ? childSum / windowMax : 0;
  const multiplier = parentToken > 0 ? childSum / parentToken : 0;

  const conditionWindow = pctOfWindow >= warnFrac;
  const conditionMultiplier = multiplier >= AGENT_SPIKE_MULTIPLIER_THRESHOLD;
  const stage: AgentSpikeStage = conditionWindow && conditionMultiplier ? 'spike' : null;

  return {
    stage,
    multiplier,
    child_token_sum: childSum,
    child_count: childCount,
    parent_token: parentToken,
    pct_of_window: pctOfWindow,
    threshold_warn: warnFrac,
    threshold_multiplier: AGENT_SPIKE_MULTIPLIER_THRESHOLD,
  };
}

/**
 * agent-spike 부모 후보 판별 — tool_name이 Agent/Skill/Task 계열인지.
 * `LIKE 'Agent%'` 등에 대응되는 JS 측 판정.
 */
export function isAgentSpikeParentCandidate(toolName: string | null): boolean {
  if (!toolName) return false;
  return (
    toolName === 'Agent' ||
    toolName === 'Skill' ||
    toolName === 'Task' ||
    toolName.startsWith('Agent') ||
    toolName.startsWith('Skill') ||
    toolName.startsWith('Task')
  );
}

// =============================================================================
// 노출 — 응답 필드 직렬화 (T-05에서 사용)
// =============================================================================

/**
 * API/SSE 응답에 직렬화할 `bloated_sys` 필드 모양.
 *
 * 클라이언트는 이 객체를 그대로 받아 뱃지/dot에 매핑한다 (ADR-003).
 * `stage`가 null이면 응답에서 필드 자체를 null로 둘 수 있다 — 정책은 호출자가 결정.
 */
export interface BloatedSysField {
  stage: BloatedSysStage;
  system_tokens: number;
  pct: number;
  threshold_warn: number;
  threshold_critical: number;
}

export function toBloatedSysField(r: BloatedSysResult): BloatedSysField {
  return {
    stage: r.stage,
    system_tokens: r.system_tokens,
    pct: r.pct,
    threshold_warn: r.threshold_warn,
    threshold_critical: r.threshold_critical,
  };
}

/**
 * API/SSE 응답에 직렬화할 `agent_spike` 필드 모양.
 */
export interface AgentSpikeField {
  stage: AgentSpikeStage;
  multiplier: number;
  child_token_sum: number;
  child_count: number;
  parent_token: number;
  pct_of_window: number;
  threshold_warn: number;
  threshold_multiplier: number;
}

export function toAgentSpikeField(r: AgentSpikeResult): AgentSpikeField {
  return {
    stage: r.stage,
    multiplier: r.multiplier,
    child_token_sum: r.child_token_sum,
    child_count: r.child_count,
    parent_token: r.parent_token,
    pct_of_window: r.pct_of_window,
    threshold_warn: r.threshold_warn,
    threshold_multiplier: r.threshold_multiplier,
  };
}

// =============================================================================
// context-saturation (세션 단위, 동적 windowMax 활용)
// =============================================================================

/**
 * context-saturation 임계값 — 코드 default.
 *
 * 근거:
 *  - claude-code autocompact 트리거가 약 75% 사용률 — 그 직전 70%를 warn으로 잡아 선제 경고.
 *  - 85% critical은 autocompact 임박 + Lost-in-middle 위험 구간.
 *  - 동적 windowMax를 분모로 사용하므로 모델별 임계 토큰 수는 자동으로 다름.
 *    (Opus 4.7 1M → 700K warn / 850K critical, Kimi K2.6 139K → 97K warn / 118K critical)
 *
 * 1차에선 코드 default 만 사용. 운영자 조정 필요 시 anomaly_thresholds 스키마 확장(2차)으로.
 */
const CTX_SAT_WARN_PCT = 70;
const CTX_SAT_CRITICAL_PCT = 85;

// 테스트가 임계 상수에 접근할 수 있도록 노출.
export const __test = {
  AGENT_SPIKE_MULTIPLIER_THRESHOLD,
  BYTES_PER_TOKEN,
  CTX_SAT_WARN_PCT,
  CTX_SAT_CRITICAL_PCT,
  isAgentSpikeParentCandidate,
};

// 외부 의존(테스트용) — AnomalyThresholds 재export.
export type { AnomalyThresholds };

export type ContextSaturationStage = 'warn' | 'critical' | null;

/** context-saturation 결과 — stage가 null이면 anomaly 없음(normal/no-data 포함). */
export interface ContextSaturationResult {
  stage: ContextSaturationStage;
  /** 세션에서 관측된 가장 큰 prompt context 토큰(tokens_input + cache_read + cache_creation). */
  context_tokens: number;
  /** 그 prompt가 사용한 model + beta 기준 동적 한도. */
  window_max: number;
  /** context_tokens / window_max (0~1 fraction). window_max == 0이면 0. */
  pct: number;
  /** 임계값 (0~1 fraction). 클라이언트가 게이지 색·툴팁 표기에 사용. */
  threshold_warn: number;
  threshold_critical: number;
}

/** API 응답 직렬화용 — 추가 필드 없으면 ContextSaturationResult와 동일 shape. */
export type ContextSaturationField = ContextSaturationResult;

/**
 * 세션 1건의 context-saturation 검출.
 *
 * 알고리즘:
 *   1) getMaxContextProxyForSession — 그 세션에서 가장 큰 context(input+caches) proxy 행.
 *   2) windowMax = getModelMaxTokens(db, row.model, row.anthropic_beta) — 동적 한도.
 *   3) contextTokens = tokens_input + cache_read + cache_creation.
 *   4) pct = contextTokens / windowMax (windowMax 0 가드).
 *   5) pct ≥ 0.85 → critical, ≥ 0.70 → warn, 그 외 → null.
 *
 * 세션에 prompt가 없으면(또는 proxy 행이 없으면) no-data로 normal 처리.
 *
 * @param db DB 인스턴스
 * @param sessionId 검사할 session id
 */
export function detectContextSaturation(
  db: Database,
  sessionId: string,
): ContextSaturationResult {
  const warnFrac = CTX_SAT_WARN_PCT / 100;
  const criticalFrac = CTX_SAT_CRITICAL_PCT / 100;

  const row = getMaxContextProxyForSession(db, sessionId);
  if (!row) return emptyContextSaturation(warnFrac, criticalFrac);

  const contextTokens =
    (row.tokens_input ?? 0)
    + (row.cache_read_tokens ?? 0)
    + (row.cache_creation_tokens ?? 0);
  const windowMax = getModelMaxTokens(db, row.model, row.anthropic_beta);
  const pct = windowMax > 0 ? contextTokens / windowMax : 0;

  let stage: ContextSaturationStage = null;
  if (pct >= criticalFrac) stage = 'critical';
  else if (pct >= warnFrac) stage = 'warn';

  return {
    stage,
    context_tokens: contextTokens,
    window_max: windowMax,
    pct,
    threshold_warn: warnFrac,
    threshold_critical: criticalFrac,
  };
}

function emptyContextSaturation(warnFrac: number, criticalFrac: number): ContextSaturationResult {
  return {
    stage: null,
    context_tokens: 0,
    window_max: 0,
    pct: 0,
    threshold_warn: warnFrac,
    threshold_critical: criticalFrac,
  };
}

/** API/SSE 응답에 직렬화할 `context_saturation` 필드. shape이 동일하므로 통과 직렬화. */
export function toContextSaturationField(r: ContextSaturationResult): ContextSaturationField {
  return {
    stage: r.stage,
    context_tokens: r.context_tokens,
    window_max: r.window_max,
    pct: r.pct,
    threshold_warn: r.threshold_warn,
    threshold_critical: r.threshold_critical,
  };
}

// =============================================================================
// 행 단위 spike / loop / slow (v2.0.1 회귀 복원)
// =============================================================================
//
// 배경:
//   v2.0.0 ADR-003에서 클라이언트 detectAnomalies가 폐기되었으나 서버 enricher가
//   bloated_sys / agent_spike 2종만 부여하면서 spike / loop / slow 3종이 행 단위
//   부착 경로에서 누락됨. v2.0.1 핫픽스에서 본 함수가 그 책임을 흡수한다.
//
// 알고리즘은 computeAnomalyTimeSeries와 동일 (세션별 prompt 평균 2배 / turn 내 동일 tool 3연속 / 전체 P95).
// 다만 시계열 카운트가 아니라 "각 행이 stage 보유 여부"를 반환한다.
//
// 입력 행은 enricher가 정규화한 NormalizedRequest 한 페이지 — 같은 페이지 안에서만
// 검출이 의미 있다(세션 평균/턴 루프 모두 페이지 컨텍스트 의존). SSE 단일 행 enrich에서는
// 호출하지 않는다(이웃 없음).

/**
 * spike/loop/slow stage 결과 — 각 anomaly별 stage 또는 null + 부가 정보.
 */
export interface RowAnomalyStages {
  spike: { stage: 'spike' | null };
  loop: { stage: 'loop' | null };
  slow: { stage: 'slow' | null; p95_ms?: number };
}

/**
 * 행 anomaly 입력 — NormalizedRequest 부분 집합(필요 필드만).
 *
 * 외부 동일 이름 `AnomalyInputRow`(storage)와 시그니처가 다르므로(여기서는 row.id 기준 매핑)
 * 본 인터페이스는 enricher 전용으로 둔다.
 */
export interface RowAnomalyInput {
  id: string;
  session_id: string | null | undefined;
  turn_id?: string | null;
  type: string;
  tool_name?: string | null;
  timestamp: number;
  tokens_input: number;
  duration_ms: number;
}

/**
 * 페이지 단위 spike/loop/slow 검출 — 행 묶음을 받아 id → stage 매핑을 반환.
 *
 * 알고리즘 (computeAnomalyTimeSeries 동일):
 *   - spike: 세션별 prompt tokens_input 평균(샘플 ≥ 2건) × 2 초과 → stage='spike'
 *   - loop:  turn_id 안에서 동일 tool_name이 연속 3회 이상이면 그 세 행 모두 stage='loop'
 *   - slow:  전체 tool_call duration_ms 중 P95(인덱스 ceil(n*0.95)-1) 초과 → stage='slow'
 *
 * pure function. 외부 상태 변경 없음. 입력 길이에 선형(loop만 turn별 정렬 stable, 입력 순서 그대로).
 *
 * @param rows — 한 응답에 들어갈 정규화 행 묶음 (timestamp DESC가 일반적이지만 정렬 비의존)
 * @returns id → RowAnomalyStages 맵. 값이 모두 null인 행은 map에 없음(부피 최소화).
 */
export function computeRowAnomalies(
  rows: RowAnomalyInput[],
): Map<string, RowAnomalyStages> {
  const result = new Map<string, RowAnomalyStages>();
  if (rows.length === 0) return result;

  // 1) 세션별 prompt tokens_input 평균 — 샘플 2건 이상일 때만 spike 후보 (단일 prompt면 평균=자기자신).
  const sessionPromptInputs = new Map<string, number[]>();
  for (const r of rows) {
    if (r.type === 'prompt' && r.session_id && r.tokens_input > 0) {
      const arr = sessionPromptInputs.get(r.session_id) ?? [];
      arr.push(r.tokens_input);
      sessionPromptInputs.set(r.session_id, arr);
    }
  }
  const sessionAvg = new Map<string, number>();
  for (const [sid, arr] of sessionPromptInputs) {
    if (arr.length >= 2) {
      sessionAvg.set(sid, arr.reduce((s, x) => s + x, 0) / arr.length);
    }
  }

  // 2) 전체 P95 — tool_call duration_ms > 0만.
  const durations: number[] = [];
  for (const r of rows) {
    if (r.type === 'tool_call' && r.duration_ms > 0) durations.push(r.duration_ms);
  }
  durations.sort((a, b) => a - b);
  let p95 = 0;
  if (durations.length > 0) {
    const idx = Math.ceil(durations.length * 0.95) - 1;
    p95 = durations[Math.min(Math.max(idx, 0), durations.length - 1)];
  }

  // 3) loop — turn_id 그룹 안에서 동일 tool_name 3연속.
  //    computeAnomalyTimeSeries와 동일하게 입력 순서 그대로 사용(rows가 timestamp DESC면
  //    "연속"이 시간 역순 기준 — 동일 turn 안에서는 순서가 일관되면 결과 동일).
  //    안전을 위해 turn 내부에서 timestamp ASC 정렬한다.
  const loopFlagged = new Set<string>();
  const turnGroups = new Map<string, RowAnomalyInput[]>();
  for (const r of rows) {
    if (r.type === 'tool_call' && r.turn_id && r.tool_name) {
      const arr = turnGroups.get(r.turn_id) ?? [];
      arr.push(r);
      turnGroups.set(r.turn_id, arr);
    }
  }
  for (const [, calls] of turnGroups) {
    calls.sort((a, b) => a.timestamp - b.timestamp);
    let streak = 1;
    for (let i = 1; i < calls.length; i++) {
      if (calls[i].tool_name === calls[i - 1].tool_name) {
        streak++;
        if (streak >= 3) {
          for (let j = i - streak + 1; j <= i; j++) {
            loopFlagged.add(calls[j].id);
          }
        }
      } else {
        streak = 1;
      }
    }
  }

  // 4) 각 행에 stage 매핑 — anomaly 0건이면 map에 넣지 않음.
  for (const r of rows) {
    let spikeStage: 'spike' | null = null;
    let loopStage: 'loop' | null = null;
    let slowStage: 'slow' | null = null;

    if (r.type === 'prompt' && r.session_id && r.tokens_input > 0) {
      const avg = sessionAvg.get(r.session_id);
      if (avg !== undefined && r.tokens_input > avg * 2) spikeStage = 'spike';
    }
    if (loopFlagged.has(r.id)) loopStage = 'loop';
    if (r.type === 'tool_call' && p95 > 0 && r.duration_ms > p95) slowStage = 'slow';

    if (spikeStage || loopStage || slowStage) {
      result.set(r.id, {
        spike: { stage: spikeStage },
        loop: { stage: loopStage },
        slow: { stage: slowStage, p95_ms: p95 || undefined },
      });
    }
  }

  return result;
}
