/**
 * metrics/_shared.ts — 시간 윈도우 파싱 + 응답 헬퍼.
 *
 * @description
 *   srp-redesign Phase 3: server/metrics.ts(561줄) 분해 결과.
 *   변경 이유: "메트릭 응답 contract·시간 윈도우 파라미터 정책".
 *
 *   metrics/* 모든 라우트·계산기가 의존하는 공통 모듈. 이 파일이 바뀌면 메트릭 시스템 전체가
 *   영향받지만, 변경 이유가 한 가지(응답 표준)라 한 곳에 응집해야 SRP 준수.
 */

// =============================================================================
// 응답 contract
// =============================================================================

export interface MetricMeta {
  /** 요청에서 사용된 시간 범위 라벨 ('24h' | '7d' | '30d' | 'custom' | 'all') */
  range: string;
  /** 실제 적용된 from 타임스탬프 (ms, undefined=제한 없음) */
  from?: number;
  /** 실제 적용된 to 타임스탬프 (ms, undefined=제한 없음) */
  to?: number;
  /** 응답 생성 시각 (ms) */
  generated_at: number;
}

export interface MetricsResponse<T> {
  success: boolean;
  data: T;
  meta: MetricMeta;
}

// =============================================================================
// 시간 윈도우
// =============================================================================

export interface TimeWindow {
  from?: number;
  to?: number;
  label: string;
}

/**
 * 쿼리 파라미터 → {from, to, label}.
 * 우선순위: from/to 명시 > range > 기본 24h.
 */
export function parseTimeWindow(url: URL): TimeWindow {
  const fromQ = url.searchParams.get('from');
  const toQ   = url.searchParams.get('to');
  const range = url.searchParams.get('range') || '24h';

  if (fromQ || toQ) {
    return {
      from: fromQ ? parseInt(fromQ, 10) : undefined,
      to:   toQ   ? parseInt(toQ, 10)   : undefined,
      label: 'custom',
    };
  }

  const now = Date.now();
  switch (range) {
    case '24h':
      return { from: now - 24 * 60 * 60 * 1000, to: now, label: '24h' };
    case '7d':
      return { from: now - 7  * 24 * 60 * 60 * 1000, to: now, label: '7d' };
    case '30d':
      return { from: now - 30 * 24 * 60 * 60 * 1000, to: now, label: '30d' };
    case 'all':
      return { from: undefined, to: undefined, label: 'all' };
    default:
      return { from: now - 24 * 60 * 60 * 1000, to: now, label: '24h' };
  }
}

// =============================================================================
// 응답 빌더
// =============================================================================

export function jsonResponse<T>(body: MetricsResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function buildMeta(window: TimeWindow): MetricMeta {
  return {
    range: window.label,
    from: window.from,
    to: window.to,
    generated_at: Date.now(),
  };
}

// =============================================================================
// 시계열 헬퍼
// =============================================================================

/**
 * 1h 단위로 정렬된 buckets를 N개 슬롯으로 채운다 (빈 버킷=0).
 * builder가 만드는 출력 타입을 그대로 보존해 호출 측 cast가 불필요하도록 한다.
 *
 * burn-rate / cache-trend 양쪽이 같은 패턴이라 공통 헬퍼로 추출.
 */
export function fillHourSlots<T extends { hour_ts: number }, U>(
  rawRows: T[],
  fromMs: number,
  toMs: number,
  builder: (hour_ts: number, row: T | undefined) => U
): U[] {
  const HOUR = 3_600_000;
  const startSlot = Math.floor(fromMs / HOUR) * HOUR;
  const endSlot   = Math.floor(toMs / HOUR) * HOUR;
  const map = new Map<number, T>();
  for (const r of rawRows) map.set(r.hour_ts, r);
  const out: U[] = [];
  for (let ts = startSlot; ts <= endSlot; ts += HOUR) {
    out.push(builder(ts, map.get(ts)));
  }
  return out;
}
