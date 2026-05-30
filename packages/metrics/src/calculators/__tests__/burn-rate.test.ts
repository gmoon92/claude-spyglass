/**
 * burn-rate.test.ts — computeBurnRate 특성화 테스트 (T01).
 *
 * @description
 *   현재 프로덕션 동작을 그대로 고정하는 characterization test.
 *   리팩토링/패키지 추출(T02) 전 안전망 확보가 목적이므로, 버그처럼 보여도
 *   동작을 바꾸지 않고 현재 출력을 기대값으로 못박는다.
 *
 *   데이터 소스: storage `getBurnRateBuckets` → requests 테이블에서
 *   type='prompt' AND tokens_confidence='high' 행을 1h 버킷으로 SUM(tokens_total)/COUNT.
 *   계산기는 (1) fillHourSlots 빈 슬롯 0채움 (2) 24h 전 동시각 비교 (3) delta_pct 산출.
 *
 *   결정성을 위해 Date.now()에 의존하지 않도록 window.from/window.to를 명시한다.
 *
 * @see packages/server/src/metrics/calculators/burn-rate.ts
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SpyglassDatabase, closeDatabase, createSession, createRequest } from '@spyglass/storage';
import { computeBurnRate } from '../burn-rate';
import type { TimeWindow } from '../../_shared';

const TEST_DB_PATH = `/tmp/spyglass-burn-rate-${Date.now()}.db`;
const HOUR = 3_600_000;
// 2026-05-16 04:00:00 UTC — 정확히 hour 경계 (T0 % HOUR === 0)
const T0 = 1778904000000;
const SESSION = 'burn-sess';

let db: SpyglassDatabase;

beforeEach(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  createSession(db.instance, { id: SESSION, project_name: 'burn', started_at: T0 - 48 * HOUR });
});

afterEach(() => {
  closeDatabase();
  for (const ext of ['', '-wal', '-shm']) {
    try { require('fs').unlinkSync(TEST_DB_PATH + ext); } catch {}
  }
});

/** type='prompt', tokens_confidence='high' 기본값으로 prompt 행 삽입 */
function insertPrompt(id: string, timestamp: number, tokens_total: number): void {
  createRequest(db.instance, {
    id,
    session_id: SESSION,
    timestamp,
    type: 'prompt',
    model: 'fx',
    tokens_total,
    // tokens_confidence는 createRequest 기본값 'high' → 필터 통과
  });
}

// =============================================================================
// 엣지 / 실패 케이스 먼저 (red 확인 후 현재 출력으로 고정)
// =============================================================================

describe('computeBurnRate — 엣지/경계', () => {
  it('데이터 0건 — 빈 슬롯만, current_total=0, delta_pct=null', () => {
    const window: TimeWindow = { from: T0, to: T0 + 2 * HOUR, label: 'custom' };
    const r = computeBurnRate(db.instance, window);

    // fillHourSlots: startSlot=floor(T0/HOUR)*HOUR=T0, endSlot=floor((T0+2H)/HOUR)*HOUR=T0+2H
    // → ts=T0, T0+H, T0+2H 3개 슬롯
    expect(r.buckets).toHaveLength(3);
    expect(r.buckets.map(b => b.hour_ts)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);
    for (const b of r.buckets) {
      expect(b.tokens).toBe(0);
      expect(b.requests).toBe(0);
    }
    expect(r.current_total).toBe(0);
    expect(r.yesterday_same_window).toBe(0);
    // 현재 동작 고정: current_total=0 이고 yesterday=0 → delta_pct는 null로 시작해 변경 없음
    expect(r.delta_pct).toBeNull();
  });

  it('오늘 데이터 있고 어제 0건 — delta_pct=null (어제 0 → 비교 의미 없음)', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertPrompt('p1', T0 + 1000, 500);
    const r = computeBurnRate(db.instance, window);

    expect(r.current_total).toBe(500);
    expect(r.yesterday_same_window).toBe(0);
    // 현재 동작 고정: yesterday=0 && current>0 → delta_pct=null (소스 burn-rate.ts:55-57)
    expect(r.delta_pct).toBeNull();
  });

  it('tokens_confidence가 high가 아닌 prompt는 집계 제외', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertPrompt('p-high', T0 + 1000, 300);
    // low confidence — 필터(tokens_confidence='high')에서 제외되어야 함
    createRequest(db.instance, {
      id: 'p-low', session_id: SESSION, timestamp: T0 + 2000, type: 'prompt',
      model: 'fx', tokens_total: 9999, tokens_confidence: 'low',
    });
    const r = computeBurnRate(db.instance, window);
    expect(r.current_total).toBe(300); // low 9999는 제외
    expect(r.buckets[0].requests).toBe(1);
  });

  it("type이 prompt가 아닌 행(response/tool_call)은 제외", () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertPrompt('p1', T0 + 1000, 200);
    createRequest(db.instance, {
      id: 'r1', session_id: SESSION, timestamp: T0 + 2000, type: 'response',
      model: 'fx', tokens_total: 5000,
    });
    createRequest(db.instance, {
      id: 't1', session_id: SESSION, timestamp: T0 + 3000, type: 'tool_call',
      model: 'fx', tokens_total: 7000,
    });
    const r = computeBurnRate(db.instance, window);
    expect(r.current_total).toBe(200); // prompt만
    expect(r.buckets[0].requests).toBe(1);
  });
});

// =============================================================================
// 성공 케이스 다양화
// =============================================================================

describe('computeBurnRate — 집계/버킷', () => {
  it('같은 버킷 내 여러 prompt 합산', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertPrompt('p1', T0 + 1000, 100);
    insertPrompt('p2', T0 + 2000, 250);
    insertPrompt('p3', T0 + 3000, 50);
    const r = computeBurnRate(db.instance, window);

    expect(r.buckets).toHaveLength(2); // T0, T0+H
    expect(r.buckets[0]).toEqual({ hour_ts: T0, tokens: 400, requests: 3 });
    expect(r.buckets[1]).toEqual({ hour_ts: T0 + HOUR, tokens: 0, requests: 0 });
    expect(r.current_total).toBe(400);
  });

  it('여러 버킷 분산 + 중간 빈 버킷 0채움', () => {
    const window: TimeWindow = { from: T0, to: T0 + 3 * HOUR, label: 'custom' };
    insertPrompt('p0', T0 + 100, 100);          // bucket T0
    // T0+H 버킷은 비움
    insertPrompt('p2', T0 + 2 * HOUR + 100, 300); // bucket T0+2H
    // p3는 정확히 경계 toMs=T0+3H. 현재 동작 고정: 필터 timestamp<=toMs 이므로 포함됨.
    insertPrompt('p3', T0 + 3 * HOUR, 400);       // bucket T0+3H (경계 포함)
    const r = computeBurnRate(db.instance, window);

    expect(r.buckets.map(b => b.tokens)).toEqual([100, 0, 300, 400]);
    expect(r.buckets.map(b => b.requests)).toEqual([1, 0, 1, 1]);
    expect(r.current_total).toBe(800);
  });

  it('어제 동시각 비교 + delta_pct 산출 (증가)', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    // 어제(정확히 24h 전) 윈도우: T0-24H .. T0+H-24H
    insertPrompt('y1', T0 - 24 * HOUR + 1000, 1000); // yesterday 합 1000
    // 오늘: 1500
    insertPrompt('t1', T0 + 1000, 1500);
    const r = computeBurnRate(db.instance, window);

    expect(r.current_total).toBe(1500);
    expect(r.yesterday_same_window).toBe(1000);
    // (1500-1000)/1000 = 0.5 → 50.0%, round(0.5*1000)/10 = 50
    expect(r.delta_pct).toBe(50);
  });

  it('어제 대비 감소 → 음수 delta_pct', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertPrompt('y1', T0 - 24 * HOUR + 1000, 1000);
    insertPrompt('t1', T0 + 1000, 250);
    const r = computeBurnRate(db.instance, window);

    expect(r.yesterday_same_window).toBe(1000);
    expect(r.current_total).toBe(250);
    // (250-1000)/1000 = -0.75 → -75.0
    expect(r.delta_pct).toBe(-75);
  });

  it('오늘=어제 동일 → delta_pct=0', () => {
    const window: TimeWindow = { from: T0, to: T0 + HOUR, label: 'custom' };
    insertPrompt('y1', T0 - 24 * HOUR + 1000, 800);
    insertPrompt('t1', T0 + 1000, 800);
    const r = computeBurnRate(db.instance, window);
    expect(r.delta_pct).toBe(0);
  });

  it('window.from/to 미지정 — Date.now() 기반 24h 윈도우 형태만 검증', () => {
    // from/to 모두 undefined → toMs=now, fromMs=now-24h
    const r = computeBurnRate(db.instance, { label: 'all' });
    // 24h 윈도우 + 양끝 슬롯 포함 → 일반적으로 24~25개 슬롯. 정확 개수는 now 정렬에 의존하므로 범위로 고정.
    expect(r.buckets.length).toBeGreaterThanOrEqual(24);
    expect(r.buckets.length).toBeLessThanOrEqual(25);
    // 데이터 없음 → 전부 0
    expect(r.current_total).toBe(0);
    expect(r.delta_pct).toBeNull();
  });
});
