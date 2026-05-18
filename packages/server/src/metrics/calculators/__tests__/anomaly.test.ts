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
import {
  computeRowAnomalies,
  detectBloatedSys,
  detectAgentSpike,
  __test,
  type RowAnomalyInput,
} from '../anomaly';
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

// =============================================================================
// computeRowAnomalies — spike/loop/slow 행 단위 부착 (v2.0.1 회귀 복원)
// =============================================================================

function row(over: Partial<RowAnomalyInput>): RowAnomalyInput {
  return {
    id: over.id ?? 'r',
    session_id: over.session_id ?? 'sess-1',
    turn_id: over.turn_id ?? null,
    type: over.type ?? 'tool_call',
    tool_name: over.tool_name ?? null,
    timestamp: over.timestamp ?? 0,
    tokens_input: over.tokens_input ?? 0,
    duration_ms: over.duration_ms ?? 0,
  };
}

describe('computeRowAnomalies — spike (세션 prompt 평균 ×2 초과)', () => {
  test('세션 평균의 2배 초과 prompt에 stage="spike" 부여', () => {
    // 평균 = (1000 + 1500 + 8000) / 3 = 3500, 임계 = 7000.
    // 8000 > 7000 → spike.
    const out = computeRowAnomalies([
      row({ id: 'p1', type: 'prompt', tokens_input: 1000, timestamp: 1 }),
      row({ id: 'p2', type: 'prompt', tokens_input: 1500, timestamp: 2 }),
      row({ id: 'p3', type: 'prompt', tokens_input: 8000, timestamp: 3 }),
    ]);
    expect(out.get('p3')?.spike.stage).toBe('spike');
    expect(out.get('p1')?.spike.stage ?? null).toBeNull();
    expect(out.get('p2')?.spike.stage ?? null).toBeNull();
  });

  test('단일 prompt 세션은 평균 샘플 부족 → 미검출', () => {
    const out = computeRowAnomalies([
      row({ id: 'p1', type: 'prompt', tokens_input: 9999, timestamp: 1 }),
    ]);
    expect(out.get('p1')).toBeUndefined();
  });

  test('서로 다른 세션은 독립 평균', () => {
    // 세션 A: 1000 / 1500 평균 1250 → 임계 2500
    // 세션 B: 10 / 10000 평균 5005 → 임계 10010 → 10000 미초과
    const out = computeRowAnomalies([
      row({ id: 'a1', session_id: 'A', type: 'prompt', tokens_input: 1000, timestamp: 1 }),
      row({ id: 'a2', session_id: 'A', type: 'prompt', tokens_input: 1500, timestamp: 2 }),
      row({ id: 'b1', session_id: 'B', type: 'prompt', tokens_input: 10,    timestamp: 3 }),
      row({ id: 'b2', session_id: 'B', type: 'prompt', tokens_input: 10000, timestamp: 4 }),
    ]);
    expect(out.get('a1')?.spike.stage ?? null).toBeNull();
    expect(out.get('a2')?.spike.stage ?? null).toBeNull();
    expect(out.get('b2')?.spike.stage ?? null).toBeNull(); // 10000 < 10010
  });
});

describe('computeRowAnomalies — loop (turn 내 동일 tool 3연속)', () => {
  test('Read × 3 연속 → 세 행 모두 stage="loop"', () => {
    const out = computeRowAnomalies([
      row({ id: 'l1', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 1, duration_ms: 100 }),
      row({ id: 'l2', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 2, duration_ms: 100 }),
      row({ id: 'l3', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 3, duration_ms: 100 }),
    ]);
    expect(out.get('l1')?.loop.stage).toBe('loop');
    expect(out.get('l2')?.loop.stage).toBe('loop');
    expect(out.get('l3')?.loop.stage).toBe('loop');
  });

  test('Read × 2 만 → loop 미검출', () => {
    const out = computeRowAnomalies([
      row({ id: 'l1', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 1 }),
      row({ id: 'l2', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 2 }),
    ]);
    expect(out.get('l1')).toBeUndefined();
    expect(out.get('l2')).toBeUndefined();
  });

  test('다른 turn에서는 연속 streak 분리', () => {
    const out = computeRowAnomalies([
      row({ id: 'a1', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 1 }),
      row({ id: 'a2', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 2 }),
      row({ id: 'b1', type: 'tool_call', tool_name: 'Read', turn_id: 'T2', timestamp: 3 }),
    ]);
    expect(out.get('a1')).toBeUndefined();
    expect(out.get('b1')).toBeUndefined();
  });

  test('입력 순서 역(DESC)이어도 timestamp ASC 정렬 후 검출', () => {
    // DESC 입력
    const out = computeRowAnomalies([
      row({ id: 'l3', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 3 }),
      row({ id: 'l2', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 2 }),
      row({ id: 'l1', type: 'tool_call', tool_name: 'Read', turn_id: 'T1', timestamp: 1 }),
    ]);
    expect(out.get('l1')?.loop.stage).toBe('loop');
    expect(out.get('l2')?.loop.stage).toBe('loop');
    expect(out.get('l3')?.loop.stage).toBe('loop');
  });
});

describe('computeRowAnomalies — slow (전체 P95 초과)', () => {
  test('P95를 초과한 단일 outlier에 stage="slow"', () => {
    // duration: 100, 200, 200, 300, 90000 — sorted [100,200,200,300,90000], n=5,
    // ceil(5*0.95)-1 = 5-1 = 4 → p95 = 90000. 초과 행은 없음 → none flagged.
    // 충분한 표본을 만들어 outlier가 분리되게 한다.
    const rows: RowAnomalyInput[] = [];
    for (let i = 0; i < 19; i++) {
      rows.push(row({ id: `s${i}`, type: 'tool_call', tool_name: 'Bash', duration_ms: 200, timestamp: i }));
    }
    rows.push(row({ id: 'slow-x', type: 'tool_call', tool_name: 'Bash', duration_ms: 90000, timestamp: 100 }));
    // n=20, ceil(20*0.95)-1 = 19-1 = 18 → 정렬 후 인덱스 18은 200 (마지막 200), p95=200.
    // slow-x(90000) > 200 → slow.
    const out = computeRowAnomalies(rows);
    expect(out.get('slow-x')?.slow.stage).toBe('slow');
    expect(out.get('slow-x')?.slow.p95_ms).toBe(200);
    expect(out.get('s0')?.slow.stage ?? null).toBeNull();
  });

  test('duration 0/음수 행은 P95 계산에 미포함 (tool_call만)', () => {
    const out = computeRowAnomalies([
      row({ id: 'p1', type: 'prompt', tokens_input: 100, duration_ms: 999999, timestamp: 1 }),
      row({ id: 't1', type: 'tool_call', tool_name: 'Bash', duration_ms: 0, timestamp: 2 }),
      row({ id: 't2', type: 'tool_call', tool_name: 'Bash', duration_ms: 100, timestamp: 3 }),
    ]);
    // tool_call duration > 0 표본은 단 1건(t2=100). p95=100 → 초과 없음.
    expect(out.get('p1')?.slow.stage ?? null).toBeNull();
    expect(out.get('t1')).toBeUndefined();
    expect(out.get('t2')).toBeUndefined();
  });
});

describe('computeRowAnomalies — DEMO-SPIKE-multi 회귀 시나리오', () => {
  // 실제 데모 데이터(prompt 3건, Read 3연속, Bash 90000ms, Agent + Read×5)에 다른 세션의
  // 정상 tool_call이 같은 페이지 응답에 포함된 일반 운영 컨텍스트를 재현 — P95 분포 정상화.
  test('데모 시드의 모든 anomaly 행이 stage 부여됨 (페이지 컨텍스트 포함)', () => {
    const rows: RowAnomalyInput[] = [
      // 3 prompts — 평균 (1000+1500+8000)/3 = 3500, 임계 7000 → p3가 spike
      row({ id: 'DEMO-multi-prompt-1', type: 'prompt', tokens_input: 1000, timestamp: 10, duration_ms: 0 }),
      row({ id: 'DEMO-multi-prompt-2', type: 'prompt', tokens_input: 1500, timestamp: 20, duration_ms: 0 }),
      row({ id: 'DEMO-multi-prompt-3', type: 'prompt', tokens_input: 8000, timestamp: 30, duration_ms: 0 }),
      // 3 Read in LOOP turn → loop
      row({ id: 'DEMO-multi-loop-1', type: 'tool_call', tool_name: 'Read', turn_id: 'DEMO-TURN-LOOP', timestamp: 40, duration_ms: 200 }),
      row({ id: 'DEMO-multi-loop-2', type: 'tool_call', tool_name: 'Read', turn_id: 'DEMO-TURN-LOOP', timestamp: 41, duration_ms: 200 }),
      row({ id: 'DEMO-multi-loop-3', type: 'tool_call', tool_name: 'Read', turn_id: 'DEMO-TURN-LOOP', timestamp: 42, duration_ms: 200 }),
      // Bash 90000ms → slow (P95 초과)
      row({ id: 'DEMO-multi-slow-1', type: 'tool_call', tool_name: 'Bash', turn_id: 'DEMO-TURN-SLOW', timestamp: 50, duration_ms: 90000 }),
      // Agent + child Read × 5
      row({ id: 'DEMO-multi-agent-parent', type: 'tool_call', tool_name: 'Agent', turn_id: 'DEMO-TURN-AGENT', timestamp: 60, duration_ms: 1000 }),
      row({ id: 'DEMO-multi-agent-child-1', type: 'tool_call', tool_name: 'Read', turn_id: 'DEMO-TURN-AGENT', timestamp: 61, duration_ms: 100 }),
      row({ id: 'DEMO-multi-agent-child-2', type: 'tool_call', tool_name: 'Read', turn_id: 'DEMO-TURN-AGENT', timestamp: 62, duration_ms: 100 }),
      row({ id: 'DEMO-multi-agent-child-3', type: 'tool_call', tool_name: 'Read', turn_id: 'DEMO-TURN-AGENT', timestamp: 63, duration_ms: 100 }),
      row({ id: 'DEMO-multi-agent-child-4', type: 'tool_call', tool_name: 'Read', turn_id: 'DEMO-TURN-AGENT', timestamp: 64, duration_ms: 100 }),
      row({ id: 'DEMO-multi-agent-child-5', type: 'tool_call', tool_name: 'Read', turn_id: 'DEMO-TURN-AGENT', timestamp: 65, duration_ms: 100 }),
    ];
    // 동일 페이지에 함께 들어올 다른 세션 정상 tool_call (운영 시 일반적 — /api/requests limit=100).
    // P95가 90000보다 작아져 slow가 정상 검출되도록 한다.
    for (let i = 0; i < 30; i++) {
      rows.push(row({
        id: `OTHER-tool-${i}`, session_id: 'OTHER-sess', type: 'tool_call',
        tool_name: 'Bash', turn_id: `OTHER-T${i}`, timestamp: 1000 + i, duration_ms: 300,
      }));
    }
    const out = computeRowAnomalies(rows);
    expect(out.get('DEMO-multi-prompt-3')?.spike.stage).toBe('spike');
    expect(out.get('DEMO-multi-loop-1')?.loop.stage).toBe('loop');
    expect(out.get('DEMO-multi-loop-2')?.loop.stage).toBe('loop');
    expect(out.get('DEMO-multi-loop-3')?.loop.stage).toBe('loop');
    expect(out.get('DEMO-multi-slow-1')?.slow.stage).toBe('slow');
  });
});

describe('computeRowAnomalies — 엣지 케이스', () => {
  test('빈 배열', () => {
    expect(computeRowAnomalies([]).size).toBe(0);
  });

  test('전체가 정상이면 map empty', () => {
    const out = computeRowAnomalies([
      row({ id: 't1', type: 'tool_call', tool_name: 'Bash', duration_ms: 100, timestamp: 1 }),
      row({ id: 't2', type: 'tool_call', tool_name: 'Read', duration_ms: 100, timestamp: 2 }),
    ]);
    expect(out.size).toBe(0);
  });
});
