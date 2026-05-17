/**
 * stats_hourly 자동 집계 트리거 (028) 단위 테스트.
 *
 * 검증 범위:
 *  - AFTER INSERT 트리거: createRequest / createRequests 경로
 *  - INSERT 트리거 skip: event_type='pre_tool' 행
 *  - AFTER UPDATE 트리거: pre→tool 첫 전환 (mergePostToolIntoPreTool 시뮬레이션)
 *  - UPDATE 트리거 미발동: tool→tool 재정정 (cli/fix.ts 등)
 *  - 버킷 산식: (timestamp/1000/3600)*3600
 *  - 차원 분리: 다른 model/type → 별개 행
 *  - 누적: 같은 bucket 동일 model/type → request_count 누적
 *  - ADR-003 1차 가정 검증: 코드베이스에 model/timestamp 컬럼 UPDATE가 없음
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createRequest,
  createRequests,
} from '../index';

const TEST_DB_PATH = `/tmp/spyglass-stats-trigger-${Date.now()}.db`;

// 2026-05-16 04:00:00.000 UTC. (1778904000000 / 1000 / 3600) * 3600 = 1778904000.
const FIXED_MS = 1778904000000;
const BUCKET = 1778904000;

interface StatsRow {
  hour_ts: number;
  model: string;
  type: string;
  request_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  duration_ms_sum: number;
  duration_ms_count: number;
}

function selectStats(db: SpyglassDatabase, model: string): StatsRow[] {
  return db.instance
    .query(
      `SELECT hour_ts, model, type, request_count,
              tokens_input, tokens_output, tokens_total,
              cache_creation_tokens, cache_read_tokens,
              duration_ms_sum, duration_ms_count
         FROM stats_hourly
        WHERE model = ?
        ORDER BY hour_ts ASC, type ASC`
    )
    .all(model) as StatsRow[];
}

describe('stats_hourly trigger', () => {
  let db: SpyglassDatabase;
  let sessionId: string;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'stats-trigger-test',
      started_at: FIXED_MS,
    });
  });

  afterEach(() => {
    closeDatabase();
    try {
      require('fs').unlinkSync(TEST_DB_PATH);
    } catch {}
    try {
      require('fs').unlinkSync(`${TEST_DB_PATH}-wal`);
    } catch {}
    try {
      require('fs').unlinkSync(`${TEST_DB_PATH}-shm`);
    } catch {}
  });

  it('AFTER INSERT: response 1건 → stats_hourly 1행 누적', () => {
    createRequest(db.instance, {
      id: 'r1',
      session_id: sessionId,
      timestamp: FIXED_MS,
      type: 'response',
      model: 'stat-m1',
      tokens_input: 100,
      tokens_output: 200,
      tokens_total: 300,
      cache_creation_tokens: 50,
      cache_read_tokens: 25,
      duration_ms: 500,
    });

    const rows = selectStats(db, 'stat-m1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hour_ts: BUCKET,
      model: 'stat-m1',
      type: 'response',
      request_count: 1,
      tokens_input: 100,
      tokens_output: 200,
      tokens_total: 300,
      cache_creation_tokens: 50,
      cache_read_tokens: 25,
      duration_ms_sum: 500,
      duration_ms_count: 1,
    });
  });

  it('AFTER INSERT skip: event_type=pre_tool은 stats 미반영', () => {
    createRequest(db.instance, {
      id: 'r-pre',
      session_id: sessionId,
      timestamp: FIXED_MS,
      type: 'tool_call',
      event_type: 'pre_tool',
      model: 'stat-pre',
      tokens_input: 0,
    });

    expect(selectStats(db, 'stat-pre')).toHaveLength(0);
  });

  it('AFTER UPDATE: pre→tool 첫 전환 시 stats 행 추가', () => {
    // 1) pre_tool INSERT — 트리거 skip
    createRequest(db.instance, {
      id: 'r-merge',
      session_id: sessionId,
      timestamp: FIXED_MS,
      type: 'tool_call',
      event_type: 'pre_tool',
      model: 'stat-merge',
    });
    expect(selectStats(db, 'stat-merge')).toHaveLength(0);

    // 2) pre_tool → tool UPDATE (mergePostToolIntoPreTool 시뮬레이션)
    db.instance
      .prepare(
        `UPDATE requests
            SET event_type = 'tool',
                tokens_input = ?,
                tokens_output = ?,
                tokens_total = ?,
                cache_creation_tokens = ?,
                cache_read_tokens = ?,
                duration_ms = ?
          WHERE id = ?`
      )
      .run(10, 20, 30, 5, 3, 1000, 'r-merge');

    const rows = selectStats(db, 'stat-merge');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hour_ts: BUCKET,
      model: 'stat-merge',
      type: 'tool_call',
      request_count: 1, // pre_tool이 INSERT 시 skip됐으므로 여기서 첫 카운트
      tokens_input: 10,
      tokens_output: 20,
      tokens_total: 30,
      cache_creation_tokens: 5,
      cache_read_tokens: 3,
      duration_ms_sum: 1000,
      duration_ms_count: 1,
    });
  });

  it('AFTER UPDATE 미발동: tool→tool 재정정은 트리거 무영향', () => {
    // 1) 일반 tool INSERT — 트리거 정상 발동
    createRequest(db.instance, {
      id: 'r-tool',
      session_id: sessionId,
      timestamp: FIXED_MS,
      type: 'tool_call',
      event_type: 'tool',
      model: 'stat-recnt',
      tokens_input: 50,
    });
    let rows = selectStats(db, 'stat-recnt');
    expect(rows[0].request_count).toBe(1);
    expect(rows[0].tokens_input).toBe(50);

    // 2) tool → tool 재정정 (cli/fix.ts 등) — WHEN 조건 미충족, 트리거 발동 안 함
    db.instance.prepare(`UPDATE requests SET tokens_input = ? WHERE id = ?`).run(999, 'r-tool');

    rows = selectStats(db, 'stat-recnt');
    expect(rows).toHaveLength(1);
    expect(rows[0].request_count).toBe(1); // 이중 카운트 차단
    expect(rows[0].tokens_input).toBe(50); // 재정정 값 미반영 (rebuild-stats 책임)
  });

  it('createRequests 배치: 각 행 트리거 발동', () => {
    createRequests(db.instance, [
      {
        id: 'b1',
        session_id: sessionId,
        timestamp: FIXED_MS,
        type: 'prompt',
        model: 'stat-batch',
        tokens_input: 10,
      },
      {
        id: 'b2',
        session_id: sessionId,
        timestamp: FIXED_MS,
        type: 'prompt',
        model: 'stat-batch',
        tokens_input: 20,
      },
      {
        id: 'b3',
        session_id: sessionId,
        timestamp: FIXED_MS,
        type: 'prompt',
        model: 'stat-batch',
        tokens_input: 30,
      },
    ]);

    const rows = selectStats(db, 'stat-batch');
    expect(rows).toHaveLength(1);
    expect(rows[0].request_count).toBe(3);
    expect(rows[0].tokens_input).toBe(60);
  });

  it('버킷 산식: 같은 hour 내 INSERT는 동일 행에 누적', () => {
    createRequest(db.instance, {
      id: 'h1-a',
      session_id: sessionId,
      timestamp: FIXED_MS, // bucket = 1778904000
      type: 'prompt',
      model: 'stat-h',
      tokens_input: 100,
    });
    createRequest(db.instance, {
      id: 'h1-b',
      session_id: sessionId,
      timestamp: FIXED_MS + 59 * 60 * 1000, // 59분 후, 같은 hour
      type: 'prompt',
      model: 'stat-h',
      tokens_input: 200,
    });

    const rows = selectStats(db, 'stat-h');
    expect(rows).toHaveLength(1);
    expect(rows[0].hour_ts).toBe(BUCKET);
    expect(rows[0].request_count).toBe(2);
    expect(rows[0].tokens_input).toBe(300);
  });

  it('버킷 산식: 다른 hour는 별개 행', () => {
    createRequest(db.instance, {
      id: 'h2-a',
      session_id: sessionId,
      timestamp: FIXED_MS,
      type: 'prompt',
      model: 'stat-h2',
      tokens_input: 10,
    });
    createRequest(db.instance, {
      id: 'h2-b',
      session_id: sessionId,
      timestamp: FIXED_MS + 60 * 60 * 1000, // 정확히 +1h, 다음 bucket
      type: 'prompt',
      model: 'stat-h2',
      tokens_input: 20,
    });

    const rows = selectStats(db, 'stat-h2');
    expect(rows).toHaveLength(2);
    expect(rows[0].hour_ts).toBe(BUCKET);
    expect(rows[1].hour_ts).toBe(BUCKET + 3600);
    expect(rows[0].request_count).toBe(1);
    expect(rows[1].request_count).toBe(1);
  });

  it('차원 분리: 같은 hour라도 다른 model/type은 별개 행', () => {
    createRequest(db.instance, {
      id: 'd1',
      session_id: sessionId,
      timestamp: FIXED_MS,
      type: 'prompt',
      model: 'stat-d',
      tokens_input: 1,
    });
    createRequest(db.instance, {
      id: 'd2',
      session_id: sessionId,
      timestamp: FIXED_MS,
      type: 'response',
      model: 'stat-d',
      tokens_input: 2,
    });

    const rows = selectStats(db, 'stat-d');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type).sort()).toEqual(['prompt', 'response']);
  });

  it('NULL model은 빈 문자열로 정규화', () => {
    createRequest(db.instance, {
      id: 'n1',
      session_id: sessionId,
      timestamp: FIXED_MS,
      type: 'prompt',
      // model 미지정 → DB NULL
      tokens_input: 5,
    });

    const rows = selectStats(db, '');
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe('');
  });

  it('ADR-003 1차 가정: 코드베이스에 requests.model 또는 timestamp 컬럼 UPDATE가 없음', () => {
    // 트리거는 timestamp/model 변경 시 bucket 이동을 처리하지 않는다.
    // 이 가정이 깨지면 stats 행이 이중 집계 또는 누락된다.
    // 정적 검증: SET model = / SET timestamp = 패턴이 UPDATE requests 컨텍스트에서 발견되면 실패.
    const packagesDir = join(__dirname, '..', '..', '..', '..');
    const offenders: string[] = [];

    function scan(dir: string) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          scan(full);
          continue;
        }
        if (!entry.endsWith('.ts') && !entry.endsWith('.sql')) continue;
        // 본 테스트 파일과 마이그레이션 파일은 검사 대상 외
        if (full.includes('stats-trigger.test.ts')) continue;
        if (full.includes('migrations/')) continue;

        const content = readFileSync(full, 'utf8');
        // requests 테이블에 대한 model/timestamp 컬럼 UPDATE를 찾는다.
        // 단순 SET model = / SET timestamp = 패턴 + 같은 statement에 'requests' 등장.
        const re = /UPDATE\s+requests[\s\S]{0,200}?SET[\s\S]{0,200}?\b(model|timestamp)\s*=/gi;
        if (re.test(content)) {
          offenders.push(full);
        }
      }
    }

    scan(join(packagesDir, 'storage'));
    scan(join(packagesDir, 'server'));

    expect(offenders).toEqual([]);
  });
});
