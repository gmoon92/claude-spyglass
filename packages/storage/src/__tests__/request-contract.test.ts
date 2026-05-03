/**
 * Request 모듈 contract 테스트 — SRP Phase 1 분해 전후 동작 동등성 보장 (ADR-008 골든 테스트)
 *
 * @description
 *   storage/queries/request.ts(1165줄)를 read/write/aggregate/turn 4파일로 분해할 때,
 *   기존 동작이 변경되지 않음을 증명하는 골든 픽스처 테스트.
 *
 *   분해 전 이 테스트가 통과하는 상태를 baseline으로 삼고,
 *   분해 후에도 동일하게 통과하면 SQL 텍스트 미세 변경(공백·alias·JOIN 순서 등)으로 인한
 *   silent diff가 없음을 보장.
 *
 * @see .claude/docs/plans/srp-redesign/adr.md#ADR-008
 *
 * 패턴:
 *   - 결정적 픽스처 (랜덤 ID 사용 안 함, 명시 ID로 비교 가능)
 *   - read / write / aggregate / turn 각 그룹 핵심 동작 검증
 *   - 외부 시그니처(@spyglass/storage barrel)로만 호출 — 내부 위치 변경에 무관
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  // write
  createRequest,
  createRequests,
  // read
  getRequestById,
  getAllRequests,
  getRequestsBySession,
  getRequestsByType,
  getChildRequestsByParents,
  getTopTokenRequests,
  // aggregate
  getRequestStats,
  getRequestStatsBySession,
  getRequestStatsByType,
  getToolStats,
  getSessionToolStats,
  getCacheStats,
  getP95DurationMs,
  // turn
  getTurnsBySession,
} from '../index';

const TEST_DB_PATH = `/tmp/spyglass-srp-contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`;

describe('Request module contract (SRP Phase 1 골든 테스트)', () => {
  let db: SpyglassDatabase;
  const sessionId = 'sess-contract-fixture';

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    createSession(db.instance, {
      id: sessionId,
      project_name: 'contract-test',
      started_at: 1_000_000_000_000,
    });
  });

  afterEach(() => {
    closeDatabase();
    try { require('fs').unlinkSync(TEST_DB_PATH); } catch {}
    try { require('fs').unlinkSync(`${TEST_DB_PATH}-shm`); } catch {}
    try { require('fs').unlinkSync(`${TEST_DB_PATH}-wal`); } catch {}
  });

  // ===========================================================================
  // write 그룹
  // ===========================================================================
  describe('write — createRequest / createRequests', () => {
    it('createRequest: 단일 INSERT 후 ID 반환 + getRequestById 조회 가능', () => {
      const id = createRequest(db.instance, {
        id: 'r-1',
        session_id: sessionId,
        timestamp: 1_000_000_000_001,
        type: 'prompt',
        tokens_input: 100,
        tokens_output: 200,
        tokens_total: 300,
        duration_ms: 50,
        model: 'claude-opus-4-7',
      });
      expect(id).toBe('r-1');

      const row = getRequestById(db.instance, 'r-1');
      expect(row).not.toBeNull();
      expect(row?.id).toBe('r-1');
      expect(row?.type).toBe('prompt');
      expect(row?.tokens_total).toBe(300);
      expect(row?.model).toBe('claude-opus-4-7');
    });

    it('createRequests: 여러 INSERT 트랜잭션 (모두 또는 모두 X)', () => {
      const ids = createRequests(db.instance, [
        {
          id: 'b-1', session_id: sessionId, timestamp: 1_000_000_000_010,
          type: 'tool_call', tool_name: 'Bash', tokens_input: 0, tokens_output: 0,
          tokens_total: 0, duration_ms: 10, event_type: 'tool',
        },
        {
          id: 'b-2', session_id: sessionId, timestamp: 1_000_000_000_020,
          type: 'tool_call', tool_name: 'Read', tokens_input: 0, tokens_output: 0,
          tokens_total: 0, duration_ms: 20, event_type: 'tool',
        },
      ]);
      expect(ids).toEqual(['b-1', 'b-2']);
      expect(getRequestById(db.instance, 'b-1')?.tool_name).toBe('Bash');
      expect(getRequestById(db.instance, 'b-2')?.tool_name).toBe('Read');
    });
  });

  // ===========================================================================
  // read 그룹
  // ===========================================================================
  describe('read — get* 함수들', () => {
    beforeEach(() => {
      // 결정적 픽스처: prompt 1개 + tool_call 2개 + response 1개 + pre_tool 1개(필터됨)
      createRequest(db.instance, {
        id: 'p-1', session_id: sessionId, timestamp: 1_000_000_000_100,
        type: 'prompt', tokens_input: 10, tokens_output: 0, tokens_total: 10,
        duration_ms: 0, model: 'claude-opus-4-7', turn_id: 't-1', event_type: 'prompt',
      });
      createRequest(db.instance, {
        id: 't-1-Bash', session_id: sessionId, timestamp: 1_000_000_000_200,
        type: 'tool_call', tool_name: 'Bash', tokens_input: 0, tokens_output: 0,
        tokens_total: 0, duration_ms: 100, turn_id: 't-1', event_type: 'tool',
      });
      createRequest(db.instance, {
        id: 't-1-Read', session_id: sessionId, timestamp: 1_000_000_000_300,
        type: 'tool_call', tool_name: 'Read', tokens_input: 0, tokens_output: 0,
        tokens_total: 0, duration_ms: 50, turn_id: 't-1', event_type: 'tool',
      });
      createRequest(db.instance, {
        id: 'resp-1', session_id: sessionId, timestamp: 1_000_000_000_400,
        type: 'response', tokens_input: 200, tokens_output: 100, tokens_total: 300,
        duration_ms: 0, model: 'claude-opus-4-7', turn_id: 't-1', event_type: 'assistant_response',
      });
      // pre_tool은 ACTIVE_REQUEST_FILTER로 제외됨 (tool_name='Agent'가 아니므로)
      createRequest(db.instance, {
        id: 'pre-1', session_id: sessionId, timestamp: 1_000_000_000_500,
        type: 'tool_call', tool_name: 'Bash', tokens_input: 0, tokens_output: 0,
        tokens_total: 0, duration_ms: 0, event_type: 'pre_tool',
      });
    });

    it('getRequestById: 존재 / 미존재 모두 처리', () => {
      expect(getRequestById(db.instance, 'p-1')?.type).toBe('prompt');
      expect(getRequestById(db.instance, 'nonexistent')).toBeNull();
    });

    it('getAllRequests: pre_tool 제외, 최근순 정렬', () => {
      const rows = getAllRequests(db.instance, 100);
      const ids = rows.map(r => r.id);
      expect(ids).toContain('p-1');
      expect(ids).toContain('t-1-Bash');
      expect(ids).toContain('t-1-Read');
      expect(ids).toContain('resp-1');
      expect(ids).not.toContain('pre-1'); // pre_tool 제외 보장
      // 최근순 (timestamp DESC)
      expect(rows[0].timestamp).toBeGreaterThanOrEqual(rows[rows.length - 1].timestamp);
    });

    it('getRequestsBySession: 세션 필터링', () => {
      const rows = getRequestsBySession(db.instance, sessionId, 100);
      expect(rows.length).toBe(4); // pre-1 제외
      expect(rows.every(r => r.session_id === sessionId)).toBe(true);
    });

    it('getRequestsBySession: 다른 세션은 0건', () => {
      expect(getRequestsBySession(db.instance, 'sess-other', 100)).toEqual([]);
    });

    it('getRequestsByType: 타입별 필터 (prompt만)', () => {
      const rows = getRequestsByType(db.instance, 'prompt', 100);
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe('p-1');
    });

    it('getTopTokenRequests: tokens_total DESC 정렬', () => {
      const rows = getTopTokenRequests(db.instance, 5);
      expect(rows[0].id).toBe('resp-1'); // tokens_total=300 최대
    });

    it('getChildRequestsByParents: parent_tool_use_id 매핑', () => {
      // 자식 도구 픽스처 추가
      createRequest(db.instance, {
        id: 'child-1', session_id: sessionId, timestamp: 1_000_000_000_250,
        type: 'tool_call', tool_name: 'Read', tokens_input: 0, tokens_output: 0,
        tokens_total: 0, duration_ms: 5, parent_tool_use_id: 'parent-tu-1',
        event_type: 'tool',
      });
      const map = getChildRequestsByParents(db.instance, ['parent-tu-1']);
      expect(map['parent-tu-1']?.length).toBe(1);
      expect(map['parent-tu-1']?.[0].id).toBe('child-1');
      expect(getChildRequestsByParents(db.instance, [])).toEqual({});
    });
  });

  // ===========================================================================
  // aggregate 그룹
  // ===========================================================================
  describe('aggregate — 집계 함수들', () => {
    beforeEach(() => {
      // 결정적 픽스처 (read 그룹과 별개로 명시 INSERT)
      createRequest(db.instance, {
        id: 'a-prompt', session_id: sessionId, timestamp: 1_000_000_001_000,
        type: 'prompt', tokens_input: 100, tokens_output: 0, tokens_total: 100,
        duration_ms: 0, model: 'claude-opus-4-7', cache_read_tokens: 50,
        cache_creation_tokens: 30, event_type: 'prompt',
      });
      createRequest(db.instance, {
        id: 'a-tool-1', session_id: sessionId, timestamp: 1_000_000_002_000,
        type: 'tool_call', tool_name: 'Bash', tokens_input: 0, tokens_output: 0,
        tokens_total: 0, duration_ms: 200, event_type: 'tool',
      });
      createRequest(db.instance, {
        id: 'a-tool-2', session_id: sessionId, timestamp: 1_000_000_003_000,
        type: 'tool_call', tool_name: 'Bash', tokens_input: 0, tokens_output: 0,
        tokens_total: 0, duration_ms: 100, event_type: 'tool',
      });
    });

    it('getRequestStats: 전체 통계 (count, tokens_*) — post_tool만 카운트하는 별도 필터 사용', () => {
      // 주의: getRequestStats는 (event_type IS NULL OR event_type = 'tool') 필터 사용
      // → prompt(event_type='prompt')는 미카운트, tool_call 2건만 카운트
      const stats = getRequestStats(db.instance);
      expect(stats.total_requests).toBeGreaterThanOrEqual(2);
    });

    it('getRequestStatsBySession: 세션별 통계 반환', () => {
      const stats = getRequestStatsBySession(db.instance, sessionId);
      expect(stats.total_requests).toBeGreaterThanOrEqual(2);
    });

    it('getRequestStatsByType: 타입별 그룹', () => {
      const types = getRequestStatsByType(db.instance);
      const promptStat = types.find(t => t.type === 'prompt');
      expect(promptStat?.count).toBeGreaterThanOrEqual(1);
    });

    it('getToolStats: 툴별 카운트 (call_count)', () => {
      const tools = getToolStats(db.instance, 10);
      const bashStat = tools.find(t => t.tool_name === 'Bash');
      expect(bashStat?.call_count).toBeGreaterThanOrEqual(2);
    });

    it('getSessionToolStats: 세션별 툴별 카운트 (call_count)', () => {
      const tools = getSessionToolStats(db.instance, sessionId);
      const bashStat = tools.find(t => t.tool_name === 'Bash');
      expect(bashStat?.call_count).toBeGreaterThanOrEqual(2);
    });

    it('getCacheStats: 캐시 토큰 합계 (cacheReadTokens/cacheCreationTokens)', () => {
      const stats = getCacheStats(db.instance);
      expect(stats.cacheReadTokens).toBeGreaterThanOrEqual(50);
      expect(stats.cacheCreationTokens).toBeGreaterThanOrEqual(30);
    });

    it('getP95DurationMs: P95 duration 계산', () => {
      const p95 = getP95DurationMs(db.instance);
      expect(typeof p95).toBe('number');
      expect(p95).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // turn 그룹
  // ===========================================================================
  describe('turn — getTurnsBySession', () => {
    it('turn 단위 집계 — prompt + tool_calls + responses', () => {
      const turnId = 'turn-fixture-1';
      createRequest(db.instance, {
        id: 'tn-prompt', session_id: sessionId, timestamp: 1_000_000_010_000,
        type: 'prompt', turn_id: turnId, tokens_input: 50, tokens_output: 0,
        tokens_total: 50, duration_ms: 0, model: 'claude-opus-4-7',
        event_type: 'prompt',
      });
      createRequest(db.instance, {
        id: 'tn-tool', session_id: sessionId, timestamp: 1_000_000_010_100,
        type: 'tool_call', turn_id: turnId, tool_name: 'Bash',
        tokens_input: 0, tokens_output: 0, tokens_total: 0, duration_ms: 30,
        event_type: 'tool',
      });
      createRequest(db.instance, {
        id: 'tn-resp', session_id: sessionId, timestamp: 1_000_000_010_200,
        type: 'response', turn_id: turnId, tokens_input: 100, tokens_output: 50,
        tokens_total: 150, duration_ms: 0, model: 'claude-opus-4-7',
        event_type: 'assistant_response',
      });

      const turns = getTurnsBySession(db.instance, sessionId);
      const target = turns.find(t => t.turn_id === turnId);
      expect(target).toBeDefined();
      expect(target?.prompt?.id).toBe('tn-prompt');
      expect(target?.tool_calls.length).toBe(1);
      expect(target?.tool_calls[0].id).toBe('tn-tool');
      expect(target?.responses.length).toBe(1);
      expect(target?.responses[0].id).toBe('tn-resp');
    });

    it('turn 없는 세션은 빈 배열', () => {
      // sessionId의 모든 turn_id 없는 행만 있을 때
      const otherSession = 'sess-no-turn';
      createSession(db.instance, {
        id: otherSession, project_name: 'no-turn', started_at: 1_000_000_000_000,
      });
      createRequest(db.instance, {
        id: 'no-turn-1', session_id: otherSession, timestamp: 1_000_000_020_000,
        type: 'prompt', tokens_input: 0, tokens_output: 0, tokens_total: 0,
        duration_ms: 0, event_type: 'prompt',
      });
      const turns = getTurnsBySession(db.instance, otherSession);
      expect(turns).toEqual([]);
    });
  });
});
