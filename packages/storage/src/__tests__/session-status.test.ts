/**
 * 도메인 일관성 테스트 — visible/LIVE 정의 SSoT 보장.
 *
 * 목적: 라우트별/화면별로 다른 함수에서 같은 의미의 카운트를 derive해도 모두 동일 값이
 * 나오는지 단언. 이게 깨지면 SRP 위반(정의 분산) 회귀 발생을 컴파일 직전에 포착.
 *
 * 검증 대상 path:
 *   1) countLiveSessions (도메인)
 *   2) listLiveSessions (도메인) → length
 *   3) getActiveSessions (queries thin wrapper) → length
 *   4) getSessionStats(...).active_sessions
 *   5) sum(getProjectStats[].active_count)
 *
 *   visible:
 *   6) countVisibleSessions (도메인)
 *   7) listVisibleSessions (도메인) → length
 *   8) getAllSessions (queries thin wrapper) → length
 *   9) getSessionStats(...).total_sessions
 *  10) sum(getProjectStats[].session_count)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SpyglassDatabase, closeDatabase } from '../index';
import {
  countLiveSessions,
  countVisibleSessions,
  listLiveSessions,
  listVisibleSessions,
  LIVE_STALE_THRESHOLD_MS,
} from '../index';
import {
  getActiveSessions,
  getAllSessions,
  getSessionStats,
  getProjectStats,
  createSession,
  createRequest,
} from '../index';

const TEST_DB_PATH = `/tmp/spyglass-status-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

describe('Session Status — definition SSoT consistency', () => {
  let db: SpyglassDatabase;
  // 고정 now: 2026-05-05 12:00 KST 기준 같은 값으로 모든 테스트.
  // (LIVE 술어가 시간에 의존하므로 테스트 안정성 위해 픽스처와 같은 시계 사용)
  const NOW = 1_780_000_000_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });

    // 4가지 시나리오 세션을 심는다:
    //  S1 LIVE        : ended NULL + 직전 5분 이내 visible request
    //  S2 stale       : ended NULL + 활동이 1시간 전 (cutoff 미만)
    //  S3 ended       : ended_at 세팅 + visible request 있음
    //  S4 ghost(빈)   : visible request 0건 (pre_tool만)
    createSession(db.instance, { id: 'S1', project_name: 'P1', started_at: NOW - 60_000, total_tokens: 100 });
    createRequest(db.instance, {
      id: 'r1', session_id: 'S1', timestamp: NOW - 30_000, type: 'prompt',
      tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 0,
      payload: '', source: 'test',
    });

    createSession(db.instance, { id: 'S2', project_name: 'P1', started_at: NOW - 3_600_000, total_tokens: 200 });
    createRequest(db.instance, {
      id: 'r2', session_id: 'S2', timestamp: NOW - 3_600_000, type: 'prompt',
      tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 0,
      payload: '', source: 'test',
    });

    createSession(db.instance, { id: 'S3', project_name: 'P2', started_at: NOW - 7_200_000, total_tokens: 300 });
    (db.instance as unknown as { run: (sql: string, ...p: unknown[]) => void })
      .run('UPDATE sessions SET ended_at = ? WHERE id = ?', NOW - 1_800_000, 'S3');
    createRequest(db.instance, {
      id: 'r3', session_id: 'S3', timestamp: NOW - 5_400_000, type: 'prompt',
      tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 0,
      payload: '', source: 'test',
    });

    createSession(db.instance, { id: 'S4', project_name: 'P2', started_at: NOW - 10_000_000, total_tokens: 0 });
    // pre_tool only → visible 정의에서 제외됨
    createRequest(db.instance, {
      id: 'r4', session_id: 'S4', timestamp: NOW - 10_000_000, type: 'tool_call',
      tool_name: 'Read', event_type: 'pre_tool',
      tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 0,
      payload: '', source: 'test',
    });
  });

  afterEach(() => {
    closeDatabase();
    try { require('fs').unlinkSync(TEST_DB_PATH); } catch {}
    try { require('fs').unlinkSync(`${TEST_DB_PATH}-shm`); } catch {}
    try { require('fs').unlinkSync(`${TEST_DB_PATH}-wal`); } catch {}
  });

  it('LIVE 정의: 5개 path가 동일 카운트', () => {
    const expected = 1; // 픽스처상 S1만 LIVE

    const a = countLiveSessions(db.instance, NOW);
    const b = listLiveSessions(db.instance, NOW).length;
    const c = getActiveSessions(db.instance, NOW).length;
    const d = getSessionStats(db.instance, NOW).active_sessions;
    const e = getProjectStats(db.instance, 99, NOW)
      .reduce((sum, p) => sum + (p.active_count ?? 0), 0);

    expect(a).toBe(expected);
    expect(b).toBe(expected);
    expect(c).toBe(expected);
    expect(d).toBe(expected);
    expect(e).toBe(expected);
  });

  it('visible 정의: 5개 path가 동일 카운트', () => {
    const expected = 3; // S1, S2, S3 (S4는 pre_tool만이라 visible 아님)

    const a = countVisibleSessions(db.instance);
    const b = listVisibleSessions(db.instance, 999, {}, NOW).length;
    const c = getAllSessions(db.instance, 999, undefined, undefined, NOW).length;
    const d = getSessionStats(db.instance, NOW).total_sessions;
    const e = getProjectStats(db.instance, 99, NOW)
      .reduce((sum, p) => sum + p.session_count, 0);

    expect(a).toBe(expected);
    expect(b).toBe(expected);
    expect(c).toBe(expected);
    expect(d).toBe(expected);
    expect(e).toBe(expected);
  });

  it('live_state 응답 컬럼: 사이드바 분기 결과와 일치', () => {
    const list = listVisibleSessions(db.instance, 999, {}, NOW);
    const byId = new Map(list.map((s: { id: string; live_state?: string }) => [s.id, s.live_state]));
    expect(byId.get('S1')).toBe('live');
    expect(byId.get('S2')).toBe('stale');
    expect(byId.get('S3')).toBe('ended');
  });

  it('STALE_THRESHOLD 경계: cutoff 직전/직후 분류 안정성', () => {
    // S1 활동이 NOW-30s ⇒ cutoff(NOW-30min) >= 보다 큼 ⇒ live
    // S2 활동이 NOW-1h  ⇒ cutoff 미만           ⇒ stale
    expect(LIVE_STALE_THRESHOLD_MS).toBe(30 * 60 * 1000);
  });

  it('프로젝트 필터: visible/LIVE가 프로젝트별로 동일 정의 적용', () => {
    const p1Live = countLiveSessions(db.instance, NOW, { projectName: 'P1' });
    const p1Visible = countVisibleSessions(db.instance, { projectName: 'P1' });
    expect(p1Live).toBe(1);     // S1
    expect(p1Visible).toBe(2);  // S1, S2

    const p2Live = countLiveSessions(db.instance, NOW, { projectName: 'P2' });
    const p2Visible = countVisibleSessions(db.instance, { projectName: 'P2' });
    expect(p2Live).toBe(0);     // S3 ended, S4 빈
    expect(p2Visible).toBe(1);  // S3
  });
});

// ============================================================================
// 날짜 범위 = 활동(요청 timestamp) 기준 회귀 가드 (range-activity-bug)
//   버그: 범위 필터가 s.started_at 기준이라, 어제 시작해 오늘 활동 중인 세션이
//   '오늘' 범위에서 누락 → 요청 목록엔 보이는데 프로젝트/세션 집계만 0이 됐다.
//   수정: compileFilter 가 "범위 내 요청(r.timestamp) 존재" 로 판정(요청 통계와 일관).
// ============================================================================
describe('Session Status — 날짜 범위는 활동(요청) 기준', () => {
  const RANGE_DB = `/tmp/spyglass-status-range-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  let db: SpyglassDatabase;
  const NOW = 1_780_000_000_000;
  const DAY = 86_400_000;
  const rangeFrom = NOW - 60 * 60_000; // 범위 하한(최근 1시간 = 단순화한 '오늘')
  const zeros = { tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 0, payload: '', source: 'test' };

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: RANGE_DB, autoInit: true });
    // A: 어제(2일 전) 시작했지만 범위 내(10분 전) 활동 → 포함되어야 (버그 재현 대상).
    createSession(db.instance, { id: 'A', project_name: 'PA', started_at: NOW - 2 * DAY, total_tokens: 10 });
    createRequest(db.instance, { id: 'ra', session_id: 'A', timestamp: NOW - 10 * 60_000, type: 'prompt', ...zeros });
    // B: 오늘(30분 전) 시작 + 범위 내 활동 → 포함.
    createSession(db.instance, { id: 'B', project_name: 'PB', started_at: NOW - 30 * 60_000, total_tokens: 20 });
    createRequest(db.instance, { id: 'rb', session_id: 'B', timestamp: NOW - 5 * 60_000, type: 'prompt', ...zeros });
    // C: 5일 전 시작 + 범위 밖(5일 전) 활동 → 제외.
    createSession(db.instance, { id: 'C', project_name: 'PC', started_at: NOW - 5 * DAY, total_tokens: 30 });
    createRequest(db.instance, { id: 'rc', session_id: 'C', timestamp: NOW - 5 * DAY, type: 'prompt', ...zeros });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-shm', '-wal']) {
      try { require('fs').unlinkSync(`${RANGE_DB}${ext}`); } catch { /* ignore */ }
    }
  });

  it('어제 시작했지만 범위 내 활동한 세션이 집계에 포함된다 (started_at 누락 버그 방지)', () => {
    const stats = getSessionStats(db.instance, NOW, rangeFrom, NOW);
    expect(stats.total_sessions).toBe(2); // A(어제 시작·범위 내 활동) + B, C 제외
  });

  it('프로젝트 집계도 범위 내 활동 프로젝트만 노출', () => {
    const names = getProjectStats(db.instance, 99, NOW, rangeFrom, NOW)
      .map((p) => p.project_name)
      .sort();
    expect(names).toEqual(['PA', 'PB']); // PC 제외
  });

  it('countVisibleSessions 도 활동 기준 (범위 밖 C 제외)', () => {
    expect(countVisibleSessions(db.instance, { fromTs: rangeFrom, toTs: NOW })).toBe(2);
  });

  it('범위 미지정 시 전체 — 기존 동작 불변 (회귀 가드)', () => {
    expect(getSessionStats(db.instance, NOW).total_sessions).toBe(3); // A+B+C
  });
});
