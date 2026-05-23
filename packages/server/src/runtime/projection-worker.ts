/**
 * Projection materialization worker (storage-redesign-v3 Phase 5).
 *
 * 책임:
 *  - 일정 주기(setInterval)로 events_v3 tail 을 따라가며 projection 들에 멱등 upsert.
 *  - 각 projection 은 자기 watermark 만 advance — R3 단일 writer / projection.
 *  - 한 projection 실패가 다른 projection 또는 SSE 를 막지 않음 — R5 격리.
 *
 * 정책:
 *  - tick 간격: 기본 10s (SPYGLASS_PROJECTION_TICK_MS 환경변수로 조정).
 *  - 배치 크기: 기본 500 (SPYGLASS_PROJECTION_BATCH_SIZE).
 *  - SPYGLASS_DISABLE_V3_WORKER=1 환경변수로 즉시 비활성 (운영 안전망).
 *
 * 처리하는 projection:
 *  - request_view: events_v3.event_kind ∈ {hook_pre_tool, hook_post_tool, hook_prompt, hook_response} → row
 *  - turn_view: 같은 events 기반으로 turn 단위 집계 (현재 단순 implementation — Phase 5 minimal)
 *  - agent_chain_view: depth-1 부모-자식 edge (현재 minimal — depth-3 펼침은 차후 강화)
 *
 * 의도된 단순화 (현재 단계):
 *  - request_view 변환만 우선 완성. turn_view / agent_chain_view 는 minimal 동작
 *    (event 도착마다 row 추가) — 정확한 집계는 후속 단계에서 정교화.
 *  - 본 worker 는 "구조가 동작한다" 를 보장하는 단계. read API cutover 시점에 정확도 강화.
 *
 * @see .claude/docs/plans/storage-redesign-v3/redesign-plan.md Phase 5
 */

import type { Database } from 'bun:sqlite';
import type { SpyglassDatabase } from '@spyglass/storage';
import {
  getEventsAfter,
  getProjectionState,
  advanceWatermark,
  recordProjectionError,
  upsertRequestView,
  upsertTurnView,
  upsertAgentChainEdge,
  v3SchemaAvailable,
  type EventV3Row,
} from '@spyglass/storage';

const DEFAULT_TICK_MS = 10_000;
const DEFAULT_BATCH_SIZE = 500;

let timer: ReturnType<typeof setInterval> | null = null;

/** worker tick interval (ms). 환경변수 SPYGLASS_PROJECTION_TICK_MS 우선. */
function getTickMs(): number {
  const env = parseInt(process.env.SPYGLASS_PROJECTION_TICK_MS ?? '', 10);
  return Number.isFinite(env) && env >= 500 ? env : DEFAULT_TICK_MS;
}

/** 배치 크기. 환경변수 SPYGLASS_PROJECTION_BATCH_SIZE 우선. */
function getBatchSize(): number {
  const env = parseInt(process.env.SPYGLASS_PROJECTION_BATCH_SIZE ?? '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_BATCH_SIZE;
}

/**
 * events_v3 row → request_view row 변환.
 *
 * 현재는 minimal mapping. 후속 단계에서:
 *  - sub_type / trust_level pre-derive
 *  - model fallback (turn 내 prompt 의 model 로 채움)
 *  - flags_json (anomaly 플래그)
 */
function mapEventToRequestView(ev: EventV3Row): Parameters<typeof upsertRequestView>[1] | null {
  // system / session_start 등은 request_view 에 들어가지 않음
  if (
    ev.event_kind !== 'hook_pre_tool' &&
    ev.event_kind !== 'hook_post_tool' &&
    ev.event_kind !== 'hook_prompt' &&
    ev.event_kind !== 'hook_response'
  ) {
    return null;
  }

  const type =
    ev.event_kind === 'hook_prompt'
      ? 'prompt'
      : ev.event_kind === 'hook_response'
        ? 'response'
        : 'tool_call';

  const status =
    ev.event_kind === 'hook_pre_tool' ? 'running' : 'ok'; // error 판정은 후속 단계 강화 대상

  return {
    id: ev.event_id,
    session_id: ev.session_id,
    turn_id: ev.turn_id ?? null,
    timestamp: ev.timestamp,
    type,
    status,
    tool_name: ev.tool_name ?? null,
    tool_use_id: ev.tool_use_id ?? null,
    parent_tool_use_id: ev.parent_tool_use_id ?? null,
    model: ev.model ?? null,
    agent_id: ev.agent_id ?? null,
    agent_type: ev.agent_type ?? null,
    source_event_id: ev.id ?? 0,
  };
}

/**
 * 한 batch 의 events 를 request_view 로 변환 + upsert.
 *
 * @returns 처리된 row 수 (실제 upsert 한 수)
 */
function projectToRequestView(db: Database, events: EventV3Row[]): number {
  let processed = 0;
  for (const ev of events) {
    const row = mapEventToRequestView(ev);
    if (!row) continue;
    upsertRequestView(db, row);
    processed++;
  }
  return processed;
}

/**
 * events → turn_view (minimal).
 *
 * 정확한 집계는 후속 단계 — 현재는 turn_id 가 있는 events 만 turn_view 에 등록.
 * 같은 (session_id, turn_id) 에 대해 마지막 event 가 가장 최신 source_event_id 를 가짐.
 */
function projectToTurnView(db: Database, events: EventV3Row[]): number {
  let processed = 0;
  for (const ev of events) {
    if (!ev.turn_id) continue;
    upsertTurnView(db, {
      session_id: ev.session_id,
      turn_id: ev.turn_id,
      started_at: ev.timestamp, // minimal — 정확한 started_at 은 turn 내 첫 event 의 timestamp 로 후속 강화
      source_event_id: ev.id ?? 0,
    });
    processed++;
  }
  return processed;
}

/**
 * events → agent_chain_view (minimal — depth-1 edge 만).
 *
 * 정확한 depth-3 펼침은 후속 단계. 현재는 parent_tool_use_id 가 있는 event 마다
 * (root=parent, descendant=self, depth=1) edge 1개 등록.
 */
function projectToAgentChain(db: Database, events: EventV3Row[]): number {
  let processed = 0;
  for (const ev of events) {
    if (!ev.parent_tool_use_id || !ev.tool_use_id) continue;
    upsertAgentChainEdge(db, {
      root_tool_use_id: ev.parent_tool_use_id,
      descendant_tool_use_id: ev.tool_use_id,
      session_id: ev.session_id,
      depth: 1,
      source_event_id: ev.id ?? 0,
    });
    processed++;
  }
  return processed;
}

/**
 * 단일 projection tick — 한 projection 에 대한 1회 처리.
 *
 * 흐름:
 *  1. projection_state.last_event_id 조회
 *  2. getEventsAfter(last_event_id, batchSize)
 *  3. project fn 호출 (upsert)
 *  4. advanceWatermark 호출 (성공 시 last_error clear)
 *  5. 예외 시 recordProjectionError — watermark 는 진행 안 함, 다음 tick 재시도
 *
 * @returns 처리된 row 수
 */
function tickOne(
  db: Database,
  projectionName: string,
  batchSize: number,
  projectFn: (db: Database, events: EventV3Row[]) => number,
): number {
  try {
    const state = getProjectionState(db, projectionName);
    const watermark = state?.last_event_id ?? 0;
    const events = getEventsAfter(db, watermark, batchSize);
    if (events.length === 0) return 0;

    const processed = projectFn(db, events);
    const maxId = events[events.length - 1].id ?? watermark;
    advanceWatermark(db, projectionName, maxId, processed);
    return processed;
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    try {
      recordProjectionError(db, projectionName, msg);
    } catch (recordErr) {
      // 메타 기록 자체가 실패하면 콘솔 경고만 — projection 격리는 유지
      console.warn(`[projection-worker] failed to record error for ${projectionName}:`, recordErr);
    }
    console.warn(`[projection-worker] ${projectionName} failed: ${msg}`);
    return 0;
  }
}

/**
 * 한 tick 에서 모든 projection 을 독립적으로 진행 (R5 격리).
 *
 * 한 projection 의 실패가 다른 projection 의 advance 를 막지 않는다.
 * 본 함수는 외부에서 테스트 / 수동 호출도 가능 (export 됨).
 */
export function runProjectionTick(db: Database, batchSize = DEFAULT_BATCH_SIZE): {
  request_view: number;
  turn_view: number;
  agent_chain_view: number;
} {
  // 운영 안전망 — events_v3 테이블 부재 시 noop (다른 v3 schema 와의 충돌 회피).
  if (!v3SchemaAvailable(db)) {
    return { request_view: 0, turn_view: 0, agent_chain_view: 0 };
  }
  return {
    request_view: tickOne(db, 'request_view', batchSize, projectToRequestView),
    turn_view: tickOne(db, 'turn_view', batchSize, projectToTurnView),
    agent_chain_view: tickOne(db, 'agent_chain_view', batchSize, projectToAgentChain),
  };
}

/**
 * 백그라운드 worker 시작 — startServer 가 호출.
 *
 * SPYGLASS_DISABLE_V3_WORKER=1 환경변수로 즉시 비활성.
 */
export function startProjectionWorker(database: SpyglassDatabase): void {
  if (process.env.SPYGLASS_DISABLE_V3_WORKER === '1') {
    console.log('[projection-worker] disabled by SPYGLASS_DISABLE_V3_WORKER=1');
    return;
  }
  if (timer) {
    console.log('[projection-worker] already running');
    return;
  }
  // 운영 안전망 — events_v3 테이블 부재 시 worker 자체 시작 안 함.
  if (!v3SchemaAvailable(database.instance)) {
    console.log('[projection-worker] events_v3 table not found — skipping worker start (conflicting v3 schema)');
    return;
  }

  const tickMs = getTickMs();
  const batchSize = getBatchSize();
  console.log(`[projection-worker] started — tick=${tickMs}ms batch=${batchSize}`);

  timer = setInterval(() => {
    try {
      runProjectionTick(database.instance, batchSize);
    } catch (err) {
      // tickOne 안에서 각 projection 별로 격리되지만, 외부 호출 자체 실패도 흡수.
      console.warn('[projection-worker] tick failed:', err);
    }
  }, tickMs);
}

/** 종료 시 호출 — stopServer 가 정리. */
export function stopProjectionWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[projection-worker] stopped');
  }
}
