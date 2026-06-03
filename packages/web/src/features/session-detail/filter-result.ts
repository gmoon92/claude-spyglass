/**
 * features/session-detail/filter-result.ts — detail 필터 파생 selector (P3-05)
 *
 * 원본: assets/js/session-detail/flat-view.js#applyDetailFilter 의 **순수 집계·필터 코어**
 *   (flat-view.js:52-120) 를 1:1 이식. DOM 라벨 갱신(:80-83)·DETAIL_FILTER_CHANGED
 *   발행(:123)·차트 갱신(:163-194) 같은 부수효과는 본 모듈에서 제외한다
 *   (P3-04 §2.1: 집계 → store selector, 차트 분기 → P3-01 Chart.tsx 소유).
 *
 * SSoT 재사용(재구현 금지):
 *  - subTypeOf / SUB_TYPES        : request-types.js (agent/skill/mcp/task 분류 SSoT)
 *  - getAnomalyFlagsForRow        : anomaly.js (서버 채움 필드 → flag Set 매핑 SSoT, ADR-003)
 *
 * @module features/session-detail/filter-result
 */
import { subTypeOf, SUB_TYPES } from '../dashboard/request-types';
import { getAnomalyFlagsForRow } from '../../lib/anomaly';

interface RequestLike {
  id?: string | null;
  type?: string | null;
  turn_id?: string | null;
  [k: string]: unknown;
}

interface TurnLike {
  tool_calls?: unknown[];
  prompt?: unknown;
  [k: string]: unknown;
}

export interface DetailFilterInput {
  requests: RequestLike[];
  turns: TurnLike[];
  /** 활성 필터 키: 'all' | 'prompt' | 'tool_call' | 'system' | SUB_TYPES(agent/skill/mcp/task). */
  filter: string;
  /** 활성 턴 id — 있으면 카운트를 그 턴 범위로 좁힌다(원본 "활성 턴 좁힘" 정책). null 폴백 = 전체. */
  activeTurnId?: string | null;
  /** system 카운트 = proxy distinct system_hash 수(원본 getSystemHashCount, flat-view.js:65). */
  systemHashCount?: number;
}

export interface DetailFilterResult {
  /** 필터 chip 카운트 맵(원본 countMap). */
  countMap: Record<string, number>;
  /** chip 라벨 맵(원본 labelMap) — 라벨 문자열 SSoT(DOM 주입은 호출처 책임). */
  labelMap: Record<string, string>;
  flatFiltered: RequestLike[];
  flatAnomalyMap: Map<string, Set<string>>;
  turnFiltered: TurnLike[];
  turnAnomalyMap: Map<string, Set<string>>;
}

/**
 * 현재 detailFilter 기준 요청/턴 1차 데이터를 필터링·집계한다(원본 applyDetailFilter 코어).
 *
 * 원본 동작 1:1:
 *  - 카운트 범위: activeTurnId 가 있고 그 턴 요청이 1건 이상이면 그 범위, 아니면 전체 폴백
 *    (flat-view.js:62-64).
 *  - system 카운트는 requests.type 집계가 아니라 systemHashCount 를 사용(flat-view.js:65,67).
 *  - flatFiltered: all → 전체 / SUB_TYPES → subTypeOf 일치 / 그 외 → type 일치 (flat-view.js:86-88).
 *  - turnFiltered: all → 전체 / tool_call·SUB_TYPES → tool_calls>0 / prompt → !!prompt / 그 외 → []
 *    (flat-view.js:98-102).
 *  - anomalyMap: 행별 getAnomalyFlagsForRow(size>0) 매핑 후 turn_id 로 OR 집계 (flat-view.js:92-114).
 */
export function computeDetailFilterResult(input: DetailFilterInput): DetailFilterResult {
  const { requests, turns, filter } = input;
  const activeTurnId = input.activeTurnId || null;
  const systemHashCount = input.systemHashCount ?? 0;

  // ── 카운트 집계 — "활성 턴 좁힘" 정책(activeTurnId 매칭 0건이면 전체 폴백). ──
  const activeScope = activeTurnId ? requests.filter((r) => r.turn_id === activeTurnId) : [];
  const countSource = activeScope.length ? activeScope : requests;
  const countMap: Record<string, number> = {
    all: countSource.length,
    prompt: 0,
    tool_call: 0,
    system: systemHashCount,
    agent: 0,
    skill: 0,
    mcp: 0,
  };
  countSource.forEach((r) => {
    const t = r.type ?? '';
    if (t in countMap && t !== 'system') countMap[t]++;
    const sub = subTypeOf(r);
    if (sub) countMap[sub]++;
  });

  const labelMap: Record<string, string> = {
    all: `All (${countMap.all})`,
    prompt: `prompt (${countMap.prompt})`,
    tool_call: `tool_call (${countMap.tool_call})`,
    system: `system (${countMap.system})`,
    agent: `Agent (${countMap.agent})`,
    skill: `Skill (${countMap.skill})`,
    mcp: `MCP (${countMap.mcp})`,
  };

  // ── 평면 필터링 ──
  const flatFiltered =
    filter === 'all'
      ? requests
      : (SUB_TYPES as readonly string[]).includes(filter)
        ? requests.filter((r) => subTypeOf(r) === filter)
        : requests.filter((r) => r.type === filter);

  // ── 행별 anomaly 매핑(서버 채움 필드 → Set, ADR-003) ──
  const flatAnomalyMap = new Map<string, Set<string>>();
  for (const r of requests) {
    const flags = getAnomalyFlagsForRow(r);
    if (flags.size > 0 && r.id != null) flatAnomalyMap.set(String(r.id), flags);
  }

  // ── 턴 필터링 ──
  const turnFiltered =
    filter === 'all'
      ? turns
      : filter === 'tool_call'
        ? turns.filter((t) => (t.tool_calls?.length ?? 0) > 0)
        : filter === 'prompt'
          ? turns.filter((t) => !!t.prompt)
          : (SUB_TYPES as readonly string[]).includes(filter)
            ? turns.filter((t) => (t.tool_calls?.length ?? 0) > 0)
            : [];

  // ── 턴 단위 anomaly 집계(turn_id 로 OR) ──
  const reqById = new Map<string, RequestLike>(requests.map((r) => [String(r.id), r]));
  const turnAnomalyMap = new Map<string, Set<string>>();
  for (const [reqId, flags] of flatAnomalyMap) {
    const req = reqById.get(reqId);
    const turnId = req?.turn_id;
    if (turnId) {
      const existing = turnAnomalyMap.get(turnId) ?? new Set<string>();
      for (const f of flags) existing.add(f);
      turnAnomalyMap.set(turnId, existing);
    }
  }

  return { countMap, labelMap, flatFiltered, flatAnomalyMap, turnFiltered, turnAnomalyMap };
}
