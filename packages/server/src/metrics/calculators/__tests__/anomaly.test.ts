/**
 * anomaly.test.ts — bloated-sys / agent-spike 검출 단위 테스트
 *
 * @description
 *   anomaly-bloated-sys ADR-001 / ADR-002 / ADR-004 검증.
 *   in-memory SQLite로 격리 — model_limits / anomaly_thresholds 시드를 직접 삽입.
 *
 *   covered:
 *   - bloated-sys: warn/critical/normal 분기, getModelMaxTokens 분모 변경, 임계 오버라이드
 *   - agent-spike: AND 조건 (자식합 ≥ 15% AND 자식합/부모 ≥ 10×) 양 방향, WITH RECURSIVE 깊이 3
 *   - anomaly_thresholds: 우선순위 (project+model > project > model > 전역), 캐시 invalidate
 *
 * @see packages/server/src/metrics/calculators/anomaly.ts
 * @see .claude/docs/plans/anomaly-bloated-sys/adr.md ADR-001/002/004
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { detectBloatedSys, detectAgentSpike, __test } from '../anomaly';
import {
  DEFAULT_ANOMALY_THRESHOLDS,
  getAnomalyThresholds,
  invalidateAnomalyThresholdsCache,
} from '../../../anomaly-thresholds';
import { invalidateModelLimitsCache } from '../../../model-limits';

// =============================================================================
// fixture
// =============================================================================

function createTestDb(): Database {
  const db = new Database(':memory:');

  // model_limits — getModelMaxTokens 분모 시드.
  db.run(`
    CREATE TABLE model_limits (
      pattern    TEXT PRIMARY KEY,
      max_tokens INTEGER NOT NULL,
      notes      TEXT
    );
  `);
  db.run(`
    INSERT INTO model_limits (pattern, max_tokens, notes) VALUES
      ('claude-opus-4-7',   1000000, '1M GA'),
      ('claude-opus-4',     200000,  '200K'),
      ('claude-sonnet-4-6', 1000000, '1M GA'),
      ('claude-haiku-4',    200000,  '200K');
  `);

  // anomaly_thresholds — 임계 시드.
  db.run(`
    CREATE TABLE anomaly_thresholds (
      project_id   TEXT NOT NULL DEFAULT '*',
      model_id     TEXT NOT NULL DEFAULT '*',
      warn_pct     INTEGER NOT NULL,
      critical_pct INTEGER NOT NULL,
      notes        TEXT,
      updated_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (project_id, model_id)
    );
  `);
  db.run(`INSERT INTO anomaly_thresholds (project_id, model_id, warn_pct, critical_pct) VALUES ('*', '*', 15, 25);`);

  // requests — agent-spike WITH RECURSIVE 대상.
  db.run(`
    CREATE TABLE requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      tool_name TEXT,
      tool_use_id TEXT,
      parent_tool_use_id TEXT,
      tokens_total INTEGER DEFAULT 0,
      event_type TEXT,
      model TEXT
    );
  `);

  return db;
}

function insertRequest(
  db: Database,
  overrides: Partial<{
    id: string;
    session_id: string;
    timestamp: number;
    type: string;
    tool_name: string | null;
    tool_use_id: string | null;
    parent_tool_use_id: string | null;
    tokens_total: number;
    event_type: string | null;
    model: string | null;
  }> = {},
): string {
  const id = overrides.id ?? `r-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO requests (id, session_id, timestamp, type, tool_name, tool_use_id, parent_tool_use_id, tokens_total, event_type, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    overrides.session_id ?? 'sess-1',
    overrides.timestamp ?? Date.now(),
    overrides.type ?? 'tool_call',
    overrides.tool_name ?? null,
    overrides.tool_use_id ?? null,
    overrides.parent_tool_use_id ?? null,
    overrides.tokens_total ?? 0,
    overrides.event_type ?? 'tool',
    overrides.model ?? null,
  );
  return id;
}

// =============================================================================
// 캐시 초기화 — model_limits / anomaly_thresholds 모두 프로세스 단위 캐시라 매 테스트마다 클리어 필수.
// =============================================================================

beforeEach(() => {
  invalidateAnomalyThresholdsCache();
  invalidateModelLimitsCache();
});

afterEach(() => {
  invalidateAnomalyThresholdsCache();
  invalidateModelLimitsCache();
});

// =============================================================================
// anomaly_thresholds — 조회 + 우선순위 + 캐시 (ADR-004)
// =============================================================================

describe('anomaly_thresholds — 우선순위 (ADR-004)', () => {
  test('전역 시드 ("*","*", 15, 25)만 있을 때', () => {
    const db = createTestDb();
    const t = getAnomalyThresholds(db, 'proj-A', 'claude-opus-4-7');
    expect(t.warnPct).toBe(15);
    expect(t.criticalPct).toBe(25);
  });

  test('project_id 일치 우선 (project, "*")', () => {
    const db = createTestDb();
    db.run(`INSERT INTO anomaly_thresholds VALUES ('proj-A', '*', 10, 20, null, 0);`);
    invalidateAnomalyThresholdsCache();
    const t = getAnomalyThresholds(db, 'proj-A', 'claude-haiku-4');
    expect(t.warnPct).toBe(10);
    expect(t.criticalPct).toBe(20);
  });

  test('project + model 정확 일치는 그보다 우선', () => {
    const db = createTestDb();
    db.run(`INSERT INTO anomaly_thresholds VALUES ('proj-A', '*', 10, 20, null, 0);`);
    db.run(`INSERT INTO anomaly_thresholds VALUES ('proj-A', 'claude-haiku-4', 5, 8, null, 0);`);
    invalidateAnomalyThresholdsCache();
    const t = getAnomalyThresholds(db, 'proj-A', 'claude-haiku-4');
    expect(t.warnPct).toBe(5);
    expect(t.criticalPct).toBe(8);
  });

  test('테이블 미존재 → DEFAULT_ANOMALY_THRESHOLDS 코드 폴백', () => {
    const db = new Database(':memory:');
    invalidateAnomalyThresholdsCache();
    const t = getAnomalyThresholds(db, null, null);
    expect(t.warnPct).toBe(DEFAULT_ANOMALY_THRESHOLDS.warnPct);
    expect(t.criticalPct).toBe(DEFAULT_ANOMALY_THRESHOLDS.criticalPct);
  });

  test('invalidateAnomalyThresholdsCache 후 신규 시드 반영', () => {
    const db = createTestDb();
    // 첫 호출 — 전역 15/25 캐시.
    expect(getAnomalyThresholds(db, null, null).warnPct).toBe(15);
    // 시드 UPDATE — 캐시 무효화 전엔 반영 안 됨.
    db.run(`UPDATE anomaly_thresholds SET warn_pct = 50, critical_pct = 70 WHERE project_id = '*' AND model_id = '*';`);
    expect(getAnomalyThresholds(db, null, null).warnPct).toBe(15);
    invalidateAnomalyThresholdsCache();
    expect(getAnomalyThresholds(db, null, null).warnPct).toBe(50);
    expect(getAnomalyThresholds(db, null, null).criticalPct).toBe(70);
  });
});

// =============================================================================
// bloated-sys (ADR-001)
// =============================================================================

describe('detectBloatedSys — 윈도우 비율 분기 (ADR-001)', () => {
  test('정상 운영 — 5.8% (200K 모델) → stage=null', () => {
    const db = createTestDb();
    // 200K 윈도우 모델에서 5.8% → byte / 4 / 200000 = 0.058
    // bytes = 0.058 * 200000 * 4 = 46400 bytes
    const result = detectBloatedSys(db, {
      systemByteSize: 46400,
      model: 'claude-haiku-4',
    });
    expect(result.stage).toBeNull();
    expect(result.pct).toBeCloseTo(0.058, 3);
    expect(result.system_tokens).toBe(46400 / 4);
  });

  test('warn 임계 진입 — pct=18% → stage="warn"', () => {
    const db = createTestDb();
    // 200K 모델에서 18%: tokens = 0.18 * 200000 = 36000, bytes = 144000
    const result = detectBloatedSys(db, {
      systemByteSize: 144000,
      model: 'claude-haiku-4',
    });
    expect(result.stage).toBe('warn');
    expect(result.pct).toBeCloseTo(0.18, 3);
    expect(result.threshold_warn).toBeCloseTo(0.15, 5);
    expect(result.threshold_critical).toBeCloseTo(0.25, 5);
  });

  test('warn 경계 — pct=15% 정확히 → stage="warn" (≥ 조건)', () => {
    const db = createTestDb();
    // 200K 모델에서 정확히 15%: tokens = 30000, bytes = 120000
    const result = detectBloatedSys(db, {
      systemByteSize: 120000,
      model: 'claude-haiku-4',
    });
    expect(result.stage).toBe('warn');
    expect(result.pct).toBeCloseTo(0.15, 5);
  });

  test('critical 진입 — 사용자 사례 80% (1M 모델) → stage="critical"', () => {
    const db = createTestDb();
    // 1M 윈도우 모델에서 80%: tokens = 800000, bytes = 3200000 (≈ 3.2MB)
    const result = detectBloatedSys(db, {
      systemByteSize: 3_200_000,
      model: 'claude-opus-4-7',
    });
    expect(result.stage).toBe('critical');
    expect(result.pct).toBeCloseTo(0.8, 2);
    expect(result.system_tokens).toBe(800000);
  });

  test('critical 경계 — pct=25% 정확히 → stage="critical"', () => {
    const db = createTestDb();
    // 200K 모델에서 정확히 25%: tokens = 50000, bytes = 200000
    const result = detectBloatedSys(db, {
      systemByteSize: 200_000,
      model: 'claude-haiku-4',
    });
    expect(result.stage).toBe('critical');
    expect(result.pct).toBeCloseTo(0.25, 5);
  });

  test('동일 토큰을 1M 모델로 보면 pct가 1/5로 줄어듦 (윈도우 차이 반영)', () => {
    const db = createTestDb();
    const bytes = 200_000;
    const small = detectBloatedSys(db, { systemByteSize: bytes, model: 'claude-haiku-4' });
    const big = detectBloatedSys(db, { systemByteSize: bytes, model: 'claude-opus-4-7' });
    expect(small.pct).toBeCloseTo(0.25, 5);
    expect(big.pct).toBeCloseTo(0.05, 5);
    expect(small.stage).toBe('critical');
    expect(big.stage).toBeNull();
  });

  test('system_byte_size 0/null → 정상 처리 (stage=null)', () => {
    const db = createTestDb();
    expect(detectBloatedSys(db, { systemByteSize: 0, model: 'claude-opus-4-7' }).stage).toBeNull();
    expect(detectBloatedSys(db, { systemByteSize: null, model: 'claude-opus-4-7' }).stage).toBeNull();
  });

  test('anomaly_thresholds 커스텀 임계 적용 — project 오버라이드', () => {
    const db = createTestDb();
    db.run(`INSERT INTO anomaly_thresholds VALUES ('proj-tight', '*', 5, 10, null, 0);`);
    invalidateAnomalyThresholdsCache();
    // 6%면 일반 시드(15/25)에선 normal, 커스텀(5/10)에선 warn
    const tokens = 0.06 * 200000;
    const bytes = tokens * 4;
    const normal = detectBloatedSys(db, {
      systemByteSize: bytes,
      model: 'claude-haiku-4',
      projectId: 'proj-A',
    });
    const tight = detectBloatedSys(db, {
      systemByteSize: bytes,
      model: 'claude-haiku-4',
      projectId: 'proj-tight',
    });
    expect(normal.stage).toBeNull();
    expect(tight.stage).toBe('warn');
  });

  test('첫 prompt heavy 단일 prompt 세션도 동일 임계 적용 (ADR-001 흡수)', () => {
    // bloated-sys 검출은 단일 prompt 세션이라도 byte/token 정보만 있으면 동일 분기.
    // 별도 "첫 prompt heavy" 분기가 없으므로 동일 함수가 모두 처리한다 — 호출자(enricher)가
    // 첫 prompt 행에만 부여하면 자연스럽게 흡수.
    const db = createTestDb();
    const result = detectBloatedSys(db, {
      systemByteSize: 3_200_000, // 80%
      model: 'claude-opus-4-7',
    });
    expect(result.stage).toBe('critical');
  });
});

// =============================================================================
// agent-spike (ADR-002)
// =============================================================================

describe('detectAgentSpike — AND 조건 + WITH RECURSIVE 깊이 3 (ADR-002)', () => {
  test('자식 0건 → stage=null', () => {
    const db = createTestDb();
    insertRequest(db, { tool_use_id: 'agent-1', tool_name: 'Agent', tokens_total: 100 });
    const result = detectAgentSpike(db, {
      tool_use_id: 'agent-1',
      tool_name: 'Agent',
      tokens_total: 100,
      model: 'claude-opus-4-7',
    });
    expect(result.stage).toBeNull();
    expect(result.child_count).toBe(0);
    expect(result.child_token_sum).toBe(0);
  });

  test('자식합 < 윈도우 15% (조건 1 미충족) → stage=null', () => {
    // 1M 모델, 부모 100 tokens, 자식 합 50000 tokens (5%) — 조건 1 미충족
    const db = createTestDb();
    insertRequest(db, { tool_use_id: 'agent-2', tool_name: 'Agent', tokens_total: 100 });
    insertRequest(db, { parent_tool_use_id: 'agent-2', tool_name: 'Read', tokens_total: 50000 });

    const result = detectAgentSpike(db, {
      tool_use_id: 'agent-2',
      tool_name: 'Agent',
      tokens_total: 100,
      model: 'claude-opus-4-7',
    });
    // 자식합 5% < 15% → null. 다만 multiplier (50000/100=500)는 매우 큼 — AND 조건 검증.
    expect(result.pct_of_window).toBeCloseTo(0.05, 3);
    expect(result.multiplier).toBe(500);
    expect(result.stage).toBeNull();
  });

  test('자식합/부모 < 10× (조건 2 미충족) → stage=null', () => {
    // 200K 모델, 부모 50000 tokens, 자식 합 60000 tokens (30% of window, 1.2x of parent) — 조건 2 미충족
    const db = createTestDb();
    insertRequest(db, { tool_use_id: 'agent-3', tool_name: 'Agent', tokens_total: 50000 });
    insertRequest(db, { parent_tool_use_id: 'agent-3', tool_name: 'Read', tokens_total: 60000 });

    const result = detectAgentSpike(db, {
      tool_use_id: 'agent-3',
      tool_name: 'Agent',
      tokens_total: 50000,
      model: 'claude-haiku-4',
    });
    expect(result.pct_of_window).toBeCloseTo(0.3, 3);
    expect(result.multiplier).toBeCloseTo(1.2, 3);
    expect(result.stage).toBeNull();
  });

  test('양 조건 모두 통과 → stage="spike" + multiplier 정확', () => {
    // 200K 모델, 부모 3000 tokens, 자식 합 40000 tokens (20% > 15% AND 13.33x > 10x)
    const db = createTestDb();
    insertRequest(db, { tool_use_id: 'agent-4', tool_name: 'Agent', tokens_total: 3000 });
    insertRequest(db, { parent_tool_use_id: 'agent-4', tool_name: 'Read', tokens_total: 20000 });
    insertRequest(db, { parent_tool_use_id: 'agent-4', tool_name: 'Grep', tokens_total: 20000 });

    const result = detectAgentSpike(db, {
      tool_use_id: 'agent-4',
      tool_name: 'Agent',
      tokens_total: 3000,
      model: 'claude-haiku-4',
    });
    expect(result.stage).toBe('spike');
    expect(result.child_count).toBe(2);
    expect(result.child_token_sum).toBe(40000);
    expect(result.pct_of_window).toBeCloseTo(0.2, 3);
    expect(result.multiplier).toBeCloseTo(40000 / 3000, 3);
    expect(result.threshold_multiplier).toBe(__test.AGENT_SPIKE_MULTIPLIER_THRESHOLD);
  });

  test('WITH RECURSIVE 깊이 3 — Agent → Skill → Tool 자식 합산', () => {
    // 200K 모델, 부모 Agent 1000 tokens.
    // Depth 1: Skill (parent_tool_use_id=Agent), tokens=5000
    // Depth 2: Read (parent_tool_use_id=Skill), tokens=20000
    // Depth 3: Bash (parent_tool_use_id=Read), tokens=20000
    // 총 자식합 = 5000 + 20000 + 20000 = 45000 (22.5% of 200K, 45x of 1000) → spike
    const db = createTestDb();
    insertRequest(db, { tool_use_id: 'agent-deep', tool_name: 'Agent', tokens_total: 1000 });
    insertRequest(db, {
      tool_use_id: 'skill-1', parent_tool_use_id: 'agent-deep',
      tool_name: 'Skill', tokens_total: 5000,
    });
    insertRequest(db, {
      tool_use_id: 'read-1', parent_tool_use_id: 'skill-1',
      tool_name: 'Read', tokens_total: 20000,
    });
    insertRequest(db, {
      tool_use_id: 'bash-1', parent_tool_use_id: 'read-1',
      tool_name: 'Bash', tokens_total: 20000,
    });

    const result = detectAgentSpike(db, {
      tool_use_id: 'agent-deep',
      tool_name: 'Agent',
      tokens_total: 1000,
      model: 'claude-haiku-4',
    });
    expect(result.child_count).toBe(3);
    expect(result.child_token_sum).toBe(45000);
    expect(result.stage).toBe('spike');
  });

  test('깊이 4는 합산 제외 — depth ≤ 3 한정', () => {
    // 200K 모델, 부모 1000 tokens.
    // Depth 1: 5000, Depth 2: 20000, Depth 3: 20000, Depth 4: 1000000 (가상 거대값 — 합산 제외돼야 함)
    const db = createTestDb();
    insertRequest(db, { tool_use_id: 'agent-d4', tool_name: 'Agent', tokens_total: 1000 });
    insertRequest(db, { tool_use_id: 's1', parent_tool_use_id: 'agent-d4', tool_name: 'Skill', tokens_total: 5000 });
    insertRequest(db, { tool_use_id: 's2', parent_tool_use_id: 's1', tool_name: 'Skill', tokens_total: 20000 });
    insertRequest(db, { tool_use_id: 't3', parent_tool_use_id: 's2', tool_name: 'Read', tokens_total: 20000 });
    insertRequest(db, { tool_use_id: 't4', parent_tool_use_id: 't3', tool_name: 'Bash', tokens_total: 1_000_000 });

    const result = detectAgentSpike(db, {
      tool_use_id: 'agent-d4',
      tool_name: 'Agent',
      tokens_total: 1000,
      model: 'claude-haiku-4',
    });
    // 깊이 3까지만 합산: 5000 + 20000 + 20000 = 45000
    expect(result.child_token_sum).toBe(45000);
    expect(result.child_count).toBe(3);
  });

  test('Skill 부모 — Agent 외 Skill 도 후보', () => {
    const db = createTestDb();
    insertRequest(db, { tool_use_id: 'skill-parent', tool_name: 'Skill', tokens_total: 1000 });
    insertRequest(db, { parent_tool_use_id: 'skill-parent', tool_name: 'Read', tokens_total: 35000 });

    const result = detectAgentSpike(db, {
      tool_use_id: 'skill-parent',
      tool_name: 'Skill',
      tokens_total: 1000,
      model: 'claude-haiku-4',
    });
    // 35000 / 200000 = 17.5% > 15%, 35000/1000 = 35× > 10× → spike
    expect(result.stage).toBe('spike');
  });

  test('Skill 접두사 매칭 — "Skill:foo" 같은 변형도 후보 (isSubagentParentTool)', () => {
    expect(__test.isAgentSpikeParentCandidate('Skill')).toBe(true);
    expect(__test.isAgentSpikeParentCandidate('SkillRunner')).toBe(true);
    expect(__test.isAgentSpikeParentCandidate('Task:foo')).toBe(true);
    expect(__test.isAgentSpikeParentCandidate('Agent')).toBe(true);
    expect(__test.isAgentSpikeParentCandidate('Bash')).toBe(false);
    expect(__test.isAgentSpikeParentCandidate(null)).toBe(false);
  });

  test('tool_use_id가 없으면 stage=null (부모 매칭 불가)', () => {
    const db = createTestDb();
    const result = detectAgentSpike(db, {
      tool_use_id: null,
      tool_name: 'Agent',
      tokens_total: 1000,
      model: 'claude-haiku-4',
    });
    expect(result.stage).toBeNull();
    expect(result.child_count).toBe(0);
  });

  test('Agent/Skill/Task 외 도구는 stage=null (Bash 등)', () => {
    const db = createTestDb();
    insertRequest(db, { tool_use_id: 'bash-1', tool_name: 'Bash', tokens_total: 100 });
    insertRequest(db, { parent_tool_use_id: 'bash-1', tool_name: 'Read', tokens_total: 99999 });

    const result = detectAgentSpike(db, {
      tool_use_id: 'bash-1',
      tool_name: 'Bash',
      tokens_total: 100,
      model: 'claude-haiku-4',
    });
    expect(result.stage).toBeNull();
  });

  test('pre_tool 자식은 합산에서 제외 (event_type 필터)', () => {
    // pre_tool 행이 합산되면 자식 토큰 합이 과대 추정될 수 있음 → 필터 확인.
    const db = createTestDb();
    insertRequest(db, { tool_use_id: 'agent-pre', tool_name: 'Agent', tokens_total: 100 });
    insertRequest(db, {
      parent_tool_use_id: 'agent-pre', tool_name: 'Read',
      tokens_total: 99999, event_type: 'pre_tool',
    });
    insertRequest(db, {
      parent_tool_use_id: 'agent-pre', tool_name: 'Read',
      tokens_total: 30000, event_type: 'tool',
    });

    const result = detectAgentSpike(db, {
      tool_use_id: 'agent-pre',
      tool_name: 'Agent',
      tokens_total: 100,
      model: 'claude-haiku-4',
    });
    // 30000만 합산
    expect(result.child_token_sum).toBe(30000);
    expect(result.child_count).toBe(1);
  });
});
