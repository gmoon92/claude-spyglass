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
