/**
 * anomaly-thresholds — 임계 정책 조회·캐시 단위 특성화 테스트 (T02 storage 선반출 사전 단계)
 *
 * @description
 *   `packages/server/src/anomaly-thresholds.ts` 의 현재 동작을 고정하는 characterization test.
 *   기존 `metrics/calculators/__tests__/anomaly.test.ts` 는 calculator 경유로 일부 우선순위만
 *   다뤘다(전역 / project+* / project+model exact / 테이블 미존재 / invalidate). 본 파일은
 *   anomaly-thresholds 모듈 자체의 단위 동작을 직접 고정한다.
 *
 *   anomaly.test.ts 와의 중복을 피하고 다음 공백을 메운다:
 *   - 4단계 우선순위 중 anomaly.test.ts 가 단독으로 검증하지 않은 ('*', model_id) 레벨(레벨 3).
 *   - 우선순위가 더 구체적인 항목이 존재해도 정확히 그 항목만 채택되는지(레벨 간 단락).
 *   - getAllAnomalyThresholds (디버깅/관측 accessor) 의 반환 — 캐시 사본 반환.
 *   - DEFAULT_ANOMALY_THRESHOLDS 상수값 (15/25) 고정.
 *   - _cache try/catch 폴백(테이블 미존재) + invalidate 후 재로딩.
 *
 *   storage 선반출(@spyglass/storage) 후 import 경로만 바뀌고 동작은 동일해야 하므로,
 *   이 테스트가 선반출의 안전망(특성화 고정)이다.
 *
 * @see packages/server/src/anomaly-thresholds.ts
 * @see packages/server/src/metrics/calculators/__tests__/anomaly.test.ts (calculator 경유 커버리지)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  getAnomalyThresholds,
  getAllAnomalyThresholds,
  invalidateAnomalyThresholdsCache,
  DEFAULT_ANOMALY_THRESHOLDS,
} from '../anomaly-thresholds';

// =============================================================================
// fixture — in-memory bun:sqlite (기존 테스트 스타일 준수)
// =============================================================================

/**
 * anomaly_thresholds 테이블을 가진 in-memory DB.
 * Migration 033 의 컬럼 형태를 그대로 재현.
 */
function newDbWithTable(): Database {
  const db = new Database(':memory:');
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
  return db;
}

function seed(
  db: Database,
  projectId: string,
  modelId: string,
  warnPct: number,
  criticalPct: number,
): void {
  db.prepare(
    `INSERT INTO anomaly_thresholds (project_id, model_id, warn_pct, critical_pct, notes, updated_at)
     VALUES (?, ?, ?, ?, NULL, 0)`,
  ).run(projectId, modelId, warnPct, criticalPct);
}

// 캐시는 프로세스 단위 전역 → 매 테스트 격리 필수.
beforeEach(() => {
  invalidateAnomalyThresholdsCache();
});
afterEach(() => {
  invalidateAnomalyThresholdsCache();
});

// =============================================================================
// 4단계 우선순위 매칭 (ADR-004)
//   1) (project, model) > 2) (project, '*') > 3) ('*', model) > 4) ('*', '*') > 코드 폴백
// =============================================================================

describe('getAnomalyThresholds — 4단계 우선순위', () => {
  test('레벨 1: (project, model) 정확 일치가 최우선', () => {
    const db = newDbWithTable();
    seed(db, '*', '*', 15, 25);
    seed(db, 'proj-A', '*', 11, 21);
    seed(db, '*', 'mdl-X', 12, 22);
    seed(db, 'proj-A', 'mdl-X', 1, 2);
    invalidateAnomalyThresholdsCache();

    const t = getAnomalyThresholds(db, 'proj-A', 'mdl-X');
    expect(t.warnPct).toBe(1);
    expect(t.criticalPct).toBe(2);
  });

  test('레벨 2: exact 부재 시 (project, "*") 채택', () => {
    const db = newDbWithTable();
    seed(db, '*', '*', 15, 25);
    seed(db, 'proj-A', '*', 11, 21);
    seed(db, '*', 'mdl-X', 12, 22);
    invalidateAnomalyThresholdsCache();

    // (proj-A, mdl-X) 정확 일치는 없음 → (proj-A,*) 가 ('*',mdl-X) 보다 우선.
    const t = getAnomalyThresholds(db, 'proj-A', 'mdl-X');
    expect(t.warnPct).toBe(11);
    expect(t.criticalPct).toBe(21);
  });

  test('레벨 3: (project,*) 부재 시 ("*", model) 채택 (anomaly.test.ts 미커버 공백)', () => {
    const db = newDbWithTable();
    seed(db, '*', '*', 15, 25);
    seed(db, '*', 'mdl-X', 12, 22);
    invalidateAnomalyThresholdsCache();

    // proj-A 전용 행이 전혀 없음 → ('*', mdl-X) 가 전역('*','*') 보다 우선.
    const t = getAnomalyThresholds(db, 'proj-A', 'mdl-X');
    expect(t.warnPct).toBe(12);
    expect(t.criticalPct).toBe(22);
  });

  test('레벨 4: 그 외 모두 부재 시 전역 ("*","*") 채택', () => {
    const db = newDbWithTable();
    seed(db, '*', '*', 15, 25);
    invalidateAnomalyThresholdsCache();

    const t = getAnomalyThresholds(db, 'proj-A', 'mdl-X');
    expect(t.warnPct).toBe(15);
    expect(t.criticalPct).toBe(25);
  });

  test('레벨 5: 전역 시드조차 없으면 DEFAULT_ANOMALY_THRESHOLDS 코드 폴백', () => {
    const db = newDbWithTable(); // 테이블 존재하나 행 0건.
    invalidateAnomalyThresholdsCache();

    const t = getAnomalyThresholds(db, 'proj-A', 'mdl-X');
    expect(t.warnPct).toBe(DEFAULT_ANOMALY_THRESHOLDS.warnPct);
    expect(t.criticalPct).toBe(DEFAULT_ANOMALY_THRESHOLDS.criticalPct);
  });

  test('projectId/modelId null/undefined 는 "*" 로 폴백되어 전역 매칭', () => {
    const db = newDbWithTable();
    seed(db, '*', '*', 33, 44);
    invalidateAnomalyThresholdsCache();

    expect(getAnomalyThresholds(db, null, null).warnPct).toBe(33);
    expect(getAnomalyThresholds(db, undefined, undefined).warnPct).toBe(33);
    // 한쪽만 null 이어도 '*' 폴백.
    expect(getAnomalyThresholds(db, 'proj-A', null).criticalPct).toBe(44);
  });
});

// =============================================================================
// 테이블 미존재 try/catch 폴백 (마이그레이션 미적용 안전망)
// =============================================================================

describe('getAnomalyThresholds — 테이블 미존재 폴백', () => {
  test('anomaly_thresholds 테이블이 없으면 catch → DEFAULT 폴백 (throw 없음)', () => {
    const db = new Database(':memory:'); // 테이블 자체 없음.
    invalidateAnomalyThresholdsCache();

    const t = getAnomalyThresholds(db, 'any', 'any');
    expect(t.warnPct).toBe(DEFAULT_ANOMALY_THRESHOLDS.warnPct);
    expect(t.criticalPct).toBe(DEFAULT_ANOMALY_THRESHOLDS.criticalPct);
  });
});

// =============================================================================
// 캐시 라이프사이클 — _cache 1회 로드 + invalidate 재로딩
// =============================================================================

describe('anomaly-thresholds 캐시 (_cache)', () => {
  test('시드는 첫 호출 시 1회 로드되어 캐시 — UPDATE 는 invalidate 전까지 미반영', () => {
    const db = newDbWithTable();
    seed(db, '*', '*', 15, 25);

    // 첫 호출 — 15/25 캐시.
    expect(getAnomalyThresholds(db, null, null).warnPct).toBe(15);

    // DB 직접 UPDATE — 캐시 무효화 전에는 이전 값 유지.
    db.run(
      `UPDATE anomaly_thresholds SET warn_pct = 99, critical_pct = 100 WHERE project_id = '*' AND model_id = '*'`,
    );
    expect(getAnomalyThresholds(db, null, null).warnPct).toBe(15);

    // 무효화 후 재로딩 → 새 값 반영.
    invalidateAnomalyThresholdsCache();
    expect(getAnomalyThresholds(db, null, null).warnPct).toBe(99);
    expect(getAnomalyThresholds(db, null, null).criticalPct).toBe(100);
  });

  test('새로 INSERT 된 더 구체적인 행도 invalidate 후에야 반영', () => {
    const db = newDbWithTable();
    seed(db, '*', '*', 15, 25);
    // 전역만 캐시.
    expect(getAnomalyThresholds(db, 'proj-A', 'mdl-X').warnPct).toBe(15);

    // 더 구체적인 행 추가 — 무효화 전엔 전역 그대로.
    seed(db, 'proj-A', 'mdl-X', 3, 7);
    expect(getAnomalyThresholds(db, 'proj-A', 'mdl-X').warnPct).toBe(15);

    invalidateAnomalyThresholdsCache();
    expect(getAnomalyThresholds(db, 'proj-A', 'mdl-X').warnPct).toBe(3);
  });
});

// =============================================================================
// getAllAnomalyThresholds — 디버깅/관측 accessor
// =============================================================================

describe('getAllAnomalyThresholds', () => {
  test('캐시된 모든 시드 행을 반환', () => {
    const db = newDbWithTable();
    seed(db, '*', '*', 15, 25);
    seed(db, 'proj-A', '*', 11, 21);
    invalidateAnomalyThresholdsCache();

    const all = getAllAnomalyThresholds(db);
    expect(all.length).toBe(2);
    // raw row 형태(project_id/model_id/warn_pct/critical_pct) 그대로 노출.
    const global = all.find((r) => r.project_id === '*' && r.model_id === '*');
    expect(global?.warn_pct).toBe(15);
    expect(global?.critical_pct).toBe(25);
  });

  test('반환 배열은 캐시 내부 배열의 사본 — 호출자 변형이 캐시를 오염시키지 않음', () => {
    const db = newDbWithTable();
    seed(db, '*', '*', 15, 25);
    invalidateAnomalyThresholdsCache();

    const first = getAllAnomalyThresholds(db);
    first.pop(); // 반환 배열 변형.
    // 캐시는 그대로 → 다음 호출은 여전히 1건.
    expect(getAllAnomalyThresholds(db).length).toBe(1);
  });

  test('테이블 미존재 시 빈 배열 (throw 없음)', () => {
    const db = new Database(':memory:');
    invalidateAnomalyThresholdsCache();
    expect(getAllAnomalyThresholds(db)).toEqual([]);
  });
});

// =============================================================================
// 상수 고정
// =============================================================================

describe('DEFAULT_ANOMALY_THRESHOLDS 상수', () => {
  test('현재 동작 고정 — warn 15 / critical 25 (ADR-001)', () => {
    expect(DEFAULT_ANOMALY_THRESHOLDS.warnPct).toBe(15);
    expect(DEFAULT_ANOMALY_THRESHOLDS.criticalPct).toBe(25);
  });
});
