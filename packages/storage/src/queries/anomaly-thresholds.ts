/**
 * Anomaly Thresholds — bloated-sys / agent-spike 임계 정책 조회·캐시 (Migration 033)
 *
 * @description
 *   `anomaly_thresholds` 테이블에서 (project_id, model_id) → {warnPct, criticalPct} 조회.
 *   model-limits.ts 와 동일한 시드+캐시 패턴: 첫 호출 시 1회 로드 → 인메모리 보존.
 *   운영자가 SQL로 시드를 갱신하고 즉시 반영을 원하면 `invalidateAnomalyThresholdsCache()` 호출.
 *
 * 우선순위 (ADR-004):
 *   1) (project_id, model_id) 둘 다 정확히 일치
 *   2) (project_id, '*')        — 같은 프로젝트의 전 모델 적용
 *   3) ('*', model_id)          — 같은 모델의 전 프로젝트 적용
 *   4) ('*', '*')               — 전역 폴백 (기본 시드 15/25)
 *
 * 캐시 키: `${projectId ?? '*'}|${modelId ?? '*'}` — 명확한 직렬화.
 *
 * 호출자:
 *   - packages/server/src/metrics/calculators/anomaly.ts (T-03 bloated-sys / T-04 agent-spike)
 *   - packages/server/src/cli/analyze.ts (T-08 백필 후 무효화)
 *
 * @see packages/storage/migrations/033-anomaly-thresholds.sql
 * @see packages/server/src/model-limits.ts (동일 패턴의 거울 구현)
 * @see .claude/docs/plans/anomaly-bloated-sys/adr.md ADR-004
 */

import type { Database } from 'bun:sqlite';

// =============================================================================
// 타입
// =============================================================================

/**
 * (project_id, model_id) → 임계 매핑.
 *
 * `warnPct` / `criticalPct` 는 정수 percentage (0~100).
 * bloated-sys가 두 단계를 모두 사용하고, agent-spike는 warnPct(=15)만 사용한다.
 */
export interface AnomalyThresholds {
  warnPct: number;
  criticalPct: number;
}

interface AnomalyThresholdRow {
  project_id: string;
  model_id: string;
  warn_pct: number;
  critical_pct: number;
}

// =============================================================================
// 기본 폴백 (ADR-001)
// =============================================================================

/**
 * DB 시드 누락 시 안전한 기본값 (ADR-001 채택값).
 * `anomaly_thresholds` 테이블이 비어 있어도 검출 로직이 동작하도록 코드 폴백.
 */
export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  warnPct: 15,
  criticalPct: 25,
};

// =============================================================================
// 캐시
// =============================================================================

/** DB 시드 인메모리 캐시 — 첫 호출 시 채워짐. */
let _cache: ReadonlyArray<AnomalyThresholdRow> | null = null;

function ensureCache(db: Database): ReadonlyArray<AnomalyThresholdRow> {
  if (_cache === null) {
    try {
      _cache = db
        .query<AnomalyThresholdRow, []>(
          'SELECT project_id, model_id, warn_pct, critical_pct FROM anomaly_thresholds',
        )
        .all();
    } catch {
      // 테이블 미존재(마이그레이션 미적용) — 폴백 안전망. 운영자가 마이그레이션을 돌리면 캐시 채워짐.
      _cache = [];
    }
  }
  return _cache;
}

/**
 * 운영자가 SQL로 `anomaly_thresholds` 시드를 갱신한 직후 호출하면 다음 조회부터 새 값이 반영.
 * 일반적인 경우엔 프로세스 재시작이 더 명확하다.
 *
 * CLI 백필(T-08)이 완료된 후에도 호출하여 캐시 일관성을 보장한다.
 */
export function invalidateAnomalyThresholdsCache(): void {
  _cache = null;
}

// =============================================================================
// 조회
// =============================================================================

/**
 * (projectId, modelId) → AnomalyThresholds 조회.
 *
 * 우선순위 매칭 (ADR-004):
 *   1) exact match  (project, model)
 *   2) project + '*'
 *   3) '*' + model
 *   4) '*' + '*'  (전역 폴백)
 *   5) 그래도 없으면 DEFAULT_ANOMALY_THRESHOLDS (코드 폴백)
 *
 * @param db — DB 인스턴스
 * @param projectId — proxy_requests/sessions의 project_name. null/undefined 시 '*' 폴백
 * @param modelId — proxy_requests.model 또는 requests.model. null/undefined 시 '*' 폴백
 */
export function getAnomalyThresholds(
  db: Database,
  projectId?: string | null,
  modelId?: string | null,
): AnomalyThresholds {
  const rows = ensureCache(db);
  const pid = projectId ?? '*';
  const mid = modelId ?? '*';

  // 우선순위별로 첫 매치를 반환. 캐시가 작아 O(N) 스캔 충분.
  const exact = rows.find((r) => r.project_id === pid && r.model_id === mid);
  if (exact) return toThresholds(exact);

  const projectOnly = rows.find((r) => r.project_id === pid && r.model_id === '*');
  if (projectOnly) return toThresholds(projectOnly);

  const modelOnly = rows.find((r) => r.project_id === '*' && r.model_id === mid);
  if (modelOnly) return toThresholds(modelOnly);

  const global = rows.find((r) => r.project_id === '*' && r.model_id === '*');
  if (global) return toThresholds(global);

  // DB 시드 자체가 없는 비정상 상태 — 코드 폴백.
  return DEFAULT_ANOMALY_THRESHOLDS;
}

function toThresholds(row: AnomalyThresholdRow): AnomalyThresholds {
  return { warnPct: row.warn_pct, criticalPct: row.critical_pct };
}

/**
 * 디버깅/관측용 — 캐시된 모든 시드 행 반환.
 * UI 표시나 doctor 체크에서 사용 가능.
 */
export function getAllAnomalyThresholds(db: Database): AnomalyThresholdRow[] {
  return [...ensureCache(db)];
}
