/**
 * retention.ts — 데이터 보존 기간 단일 SSoT.
 *
 * 책임:
 *   SQLite RDB 와 그래프 DB(LadybugDB) 가 *동일한 cutoff* 로 데이터를 정리하도록 retention
 *   일수를 한 곳에서 결정한다. RDB 측 `maintenance.ts` 와 graph 측 `deleteOldGraphData`
 *   는 본 모듈의 `getRetentionCutoffTs()` 를 호출하므로, retention 기간 변경 시 본 파일만
 *   수정하면 양쪽이 자동으로 같이 움직인다.
 *
 * 우선순위:
 *   1) `process.env.SPYGLASS_RETENTION_DAYS` — 운영자 오버라이드.
 *   2) `DEFAULT_RETENTION_DAYS` — 30일.
 *
 *   env 가 0 이하 / non-numeric 이면 default 폴백 — 잘못된 값으로 인한 *전체 데이터 즉시
 *   삭제* 사고 방지.
 *
 * @see packages/server/src/runtime/maintenance.ts — 일별 스케줄러 호출자
 * @see packages/storage-graph/src/queries/retention.ts — 그래프 cutoff 적용 SoT
 */

/**
 * 기본 보존 기간 — 운영자가 SPYGLASS_RETENTION_DAYS 를 지정하지 않았을 때 사용.
 */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * env 변수에서 retention 일수를 읽어 반환. 잘못된 값(음수/0/non-numeric) 은 default 폴백.
 *
 *   - 음수: 미래 cutoff → 전체 데이터 즉시 삭제 위험 → 폴백.
 *   - 0: 모든 데이터 즉시 삭제 위험 → 폴백.
 *   - 비숫자: parseInt 가 NaN → 폴백.
 */
export function getRetentionDays(): number {
  const raw = parseInt(process.env.SPYGLASS_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
}

/**
 * 현재 시각 기준 retention cutoff 타임스탬프(ms) 반환.
 *
 *   `now - retentionDays * 24h` 이전의 데이터가 삭제 대상.
 *   `now` 인자는 단위 테스트에서 결정론적 cutoff 검증용 — 운영 코드는 기본값(Date.now()) 사용.
 */
export function getRetentionCutoffTs(now: number = Date.now()): number {
  return now - getRetentionDays() * 24 * 60 * 60 * 1000;
}

/**
 * hook raw 원장(`~/.spyglass/logs/hook-raw/YYYY-MM-DD.jsonl`) 버킷 보존 기간 기본값.
 *
 *   raw 원장은 서버 다운 시 수동 복구용 디버그 안전망(write-only) — replay 코드 없음.
 *   영구 자산이 아니므로 RDB(30일)보다 짧게 잡아 디스크 비대화를 막는다.
 */
export const DEFAULT_RAW_LOG_RETENTION_DAYS = 7;

/**
 * raw 원장 버킷 보존 일수. `SPYGLASS_RAW_LOG_RETENTION_DAYS` 오버라이드.
 * 잘못된 값(0/음수/non-numeric)은 default 폴백 (RDB retention 과 동일 가드).
 */
export function getRawLogRetentionDays(): number {
  const raw = parseInt(process.env.SPYGLASS_RAW_LOG_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RAW_LOG_RETENTION_DAYS;
}

/**
 * raw 원장 버킷 cutoff 타임스탬프(ms). 이 시각 이전에 끝난 버킷이 삭제 대상.
 */
export function getRawLogRetentionCutoffTs(now: number = Date.now()): number {
  return now - getRawLogRetentionDays() * 24 * 60 * 60 * 1000;
}
