/**
 * stats-bridge — 사전집계 버킷의 Hot↔Warm(Archive) 대응 단일 진실 소스 (roadmap Phase 5-6, ADR A6)
 *
 * @description
 *   `stats_hourly`/`stats_proxy_hourly`(Hot)와 `archive_stats_hourly`/`archive_stats_proxy_hourly`
 *   (Archive, migration 067)는 **동일한 가법 컬럼**을 갖는다. 이 모듈은 그 대응 관계를 한 곳에
 *   모아, (1) 오래된 버킷 이주 SQL과 (2) 조회 시 Hot+Archive UNION 소스를 **같은 컬럼 목록에서**
 *   파생시킨다. 컬럼이 한쪽에만 추가되어 이주/조회가 어긋나는 drift를 구조적으로 막는다.
 *
 *   행 아카이브(claude_events/requests)와 달리 stats는 파일·archive_index·keyset이 불필요하다
 *   (버킷은 이미 압축된 집계라 통짜 이동). 따라서 이주는 **테이블 간 INSERT+DELETE**이고,
 *   조회 병합은 **두 테이블 UNION ALL 후 재집계**다(sum/count 가법 → UNION 후 SUM=원본 SUM exact, ADR A6).
 *
 *   가법 재이주(ADR A6): 이미 아카이브된 hour 버킷과 동일 PK로 늦게 도착한 Hot 버킷이 생기면
 *   (예: 오래된 timestamp의 재생 이벤트가 트리거로 새 버킷 UPSERT), 다음 이주에서 PK 충돌 →
 *   `ON CONFLICT DO UPDATE`로 **더한다**(덮어쓰기 아님). 옵션 게이트 없이 이것이 기본 정공법.
 *
 *   P95 스케치(`archive_stats_hourly.duration_ms_sketch`)는 여기서 채우지 않는다(NULL 방치) —
 *   sum/count 병합이 핵심이고 P95는 후순위(handoff). aggregate-latency는 현재 raw `requests`
 *   기반이라 archive 구간을 근사(과소평가)하며, 스케치 병합은 별도 단계에서 채운다.
 *
 * @dependencies bun:sqlite, migration 067(archive_stats_*), migration 030/032(stats_*)
 * @flow
 *   - 이주:  server/runtime/maintenance → archiveOldStats(db, {safeArchiveTs})
 *   - 조회:  queries/{request/aggregate-*, proxy-stats, metrics/timeseries} → statsHourlyUnionSource()/statsProxyUnionSource()
 */

import type { Database } from 'bun:sqlite';

// =============================================================================
// 컬럼 SSoT — 이주 SQL과 UNION 소스가 공유. schema/067·030·032와 정합(변경 시 여기 한 곳).
// =============================================================================

/** stats_hourly PK/차원 컬럼(archive PK와 동일 — ON CONFLICT 타깃). */
const STATS_HOURLY_DIMS = ['hour_ts', 'model', 'type', 'event_type'] as const;
/** stats_hourly 가법 측정 컬럼(SUM 시 exact). duration_ms_sketch/id/updated_at 제외. */
const STATS_HOURLY_SUMS = [
  'request_count',
  'tokens_input',
  'tokens_output',
  'tokens_total',
  'cache_creation_tokens',
  'cache_read_tokens',
  'duration_ms_sum',
  'duration_ms_count',
  'tokens_input_high_sum',
  'tokens_output_high_sum',
  'tokens_total_high_sum',
  'tokens_high_count',
] as const;

/** stats_proxy_hourly PK/차원 컬럼. */
const STATS_PROXY_DIMS = ['hour_ts', 'model'] as const;
/** stats_proxy_hourly 가법 측정 컬럼. */
const STATS_PROXY_SUMS = [
  'request_count',
  'error_count',
  'stream_count',
  'tokens_input',
  'tokens_output',
  'cache_creation_tokens',
  'cache_read_tokens',
  'response_time_ms_sum',
  'response_time_ms_count',
  'first_token_ms_sum',
  'first_token_ms_count',
  'cost_usd_sum',
] as const;

/** 이주/조회 대응 테이블 쌍 명세. */
interface StatsBridgeSpec {
  hot: string;
  archive: string;
  dims: readonly string[];
  sums: readonly string[];
}

const HOURLY_SPEC: StatsBridgeSpec = {
  hot: 'stats_hourly',
  archive: 'archive_stats_hourly',
  dims: STATS_HOURLY_DIMS,
  sums: STATS_HOURLY_SUMS,
};
const PROXY_SPEC: StatsBridgeSpec = {
  hot: 'stats_proxy_hourly',
  archive: 'archive_stats_proxy_hourly',
  dims: STATS_PROXY_DIMS,
  sums: STATS_PROXY_SUMS,
};

// =============================================================================
// 조회 병합 — Hot+Archive UNION 소스 (Query Layer가 FROM 절에 삽입)
// =============================================================================

/**
 * `(SELECT dims+sums FROM hot UNION ALL SELECT dims+sums FROM archive) AS <hot명>` 문자열 생성.
 * 원본 테이블명으로 alias → 호출부의 WHERE/GROUP BY/컬럼참조를 그대로 두고 FROM만 교체하면 된다.
 * WHERE 필터는 호출부가 바깥에서 1회 적용(양쪽 half 재기술·파라미터 중복 불필요).
 */
function unionSource(spec: StatsBridgeSpec): string {
  const cols = [...spec.dims, ...spec.sums].join(', ');
  return `(SELECT ${cols} FROM ${spec.hot} UNION ALL SELECT ${cols} FROM ${spec.archive}) AS ${spec.hot}`;
}

/** stats_hourly Hot+Archive 병합 소스. `FROM stats_hourly` → `FROM ${statsHourlyUnionSource()}`. */
export function statsHourlyUnionSource(): string {
  return unionSource(HOURLY_SPEC);
}

/** stats_proxy_hourly Hot+Archive 병합 소스. */
export function statsProxyUnionSource(): string {
  return unionSource(PROXY_SPEC);
}

// =============================================================================
// 이주 — 오래된 버킷을 Archive로 옮기고 Hot에서 삭제 (테이블 간, 트랜잭션 원자)
// =============================================================================

export interface StatsArchiveResult {
  /** archive로 이동한(=Hot에서 삭제된) stats_hourly 버킷 수. */
  statsHourly: number;
  /** 동 stats_proxy_hourly 버킷 수. */
  statsProxy: number;
}

export interface StatsArchiveOptions {
  /** 이주 상한(ms, 미포함). flush-gate.computeSafeArchiveTs 결과(UTC일 경계). */
  safeArchiveTs: number;
}

/**
 * safeArchiveTs 미만 hour 버킷을 archive_stats_* 로 이주(가법 병합)하고 Hot에서 삭제한다.
 *
 * hour_ts는 unix epoch **sec**, safeArchiveTs는 **ms**(UTC일 경계) → cutoffSec = floor(ms/1000).
 * 일 경계 정렬이라 hour 버킷은 분할되지 않는다(ADR A4). row 아카이브(archiveOldData)와 동일
 * safeArchiveTs를 쓰면 Hot/Archive가 시각 축에서 겹치지 않아 UNION 재집계가 exact.
 *
 * @returns 테이블별 이주 버킷 수
 */
export function archiveOldStats(db: Database, opts: StatsArchiveOptions): StatsArchiveResult {
  const cutoffSec = Math.floor(opts.safeArchiveTs / 1000);
  return {
    statsHourly: archiveStatsTable(db, HOURLY_SPEC, cutoffSec),
    statsProxy: archiveStatsTable(db, PROXY_SPEC, cutoffSec),
  };
}

/**
 * 단일 테이블 쌍 이주. INSERT…SELECT(ON CONFLICT 가법) + DELETE를 한 트랜잭션으로 원자 처리.
 * @returns Hot에서 삭제된 버킷 수(=DELETE changes)
 */
function archiveStatsTable(db: Database, spec: StatsBridgeSpec, cutoffSec: number): number {
  const insertCols = [...spec.dims, ...spec.sums, 'updated_at'];
  const colList = insertCols.join(', ');
  // 가법 병합: 기존 archive 값 + 새 값(excluded). 차원(PK) 충돌 시에만 발동, 없으면 순수 INSERT.
  const onConflict = spec.sums.map((c) => `${c} = ${c} + excluded.${c}`).join(', ');
  const insertSql = `
    INSERT INTO ${spec.archive} (${colList})
    SELECT ${colList} FROM ${spec.hot} WHERE hour_ts < ?
    ON CONFLICT(${spec.dims.join(', ')}) DO UPDATE SET
      ${onConflict},
      updated_at = excluded.updated_at
  `;
  const deleteSql = `DELETE FROM ${spec.hot} WHERE hour_ts < ?`;

  let deleted = 0;
  db.transaction(() => {
    db.run(insertSql, [cutoffSec]);
    deleted = db.run(deleteSql, [cutoffSec]).changes;
  })();
  return deleted;
}
