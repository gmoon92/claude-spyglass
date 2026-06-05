// app/compute-range.ts — ActiveRange → from/to 파라미터 순수 변환 (date-filter-propagation).
//
// 원본 SSoT: assets/js/api.js computeRange(activeRange, now) / getMetricRangeParams (ADR-002).
//   레거시는 모듈 상태(_activeRange)를 읽어 from/to 를 계산했으나, React 계층은 store 무참조
//   원칙(api/→stores/ 금지, fetchers.ts §22)에 따라 activeRange 를 **인자로 주입**받는다.
//   본 모듈은 app 계층(stores 소비 허용)에서 store.activeRange 를 읽어 fetcher 가 받는
//   RangeParams({from,to} | {range}) 로 변환하는 어댑터다.
//
// 계약(레거시 1:1, ADR-002 — "DO NOT leak {type,value}"):
//   - rangeToParams(ar, now): {} | {from,to}      — /api/requests·dashboard·sessions·stats/cache 용
//   - rangeToMetricParams(ar, now): {from,to} | {range:'all'} — /api/metrics/* 용
//     ('all' 상태에서 metrics 라우터는 from/to 누락 시 서버 기본 24h 로 떨어지므로 range='all' 명시).

import type { ActiveRange } from '../stores/app-store';
import type { RangeParams } from '../api/fetchers';
import type { MetricParams } from '../features/dashboard/metrics-fetchers';

/**
 * ActiveRange + now(ms epoch) → {} | {from,to}. 레거시 api.js computeRange 1:1.
 *   - custom: from/to 유한값이면 그대로, 무효(NaN)면 {} 폴백(레거시 console.warn 분기 동치 — 전체).
 *   - preset: 1h/today/yesterday/7d/30d/week 시간창 계산, all/null/unknown → {} (전체, 서버 기본).
 * now 주입으로 TZ/시각 의존을 격리(레거시 테스트 용이성 동치).
 */
export function rangeToParams(ar: ActiveRange, now: number = Date.now()): RangeParams {
  if (ar == null) return {}; // null → 호출자 default('all') 폴백 의미 1:1
  if (ar.type === 'custom') {
    if (!Number.isFinite(ar.from) || !Number.isFinite(ar.to)) return {};
    return { from: ar.from, to: ar.to };
  }
  // preset
  switch (ar.value) {
    case '1h':
      return { from: now - 60 * 60 * 1000, to: now };
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start.getTime(), to: now };
    }
    case 'yesterday': {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(0, 0, 0, 0);
      return { from: start.getTime(), to: end.getTime() - 1 };
    }
    case '7d':
      return { from: now - 7 * 24 * 60 * 60 * 1000, to: now };
    case '30d':
      return { from: now - 30 * 24 * 60 * 60 * 1000, to: now };
    case 'week': {
      // legacy 호환 — api.js computeRange 'week' 분기(T-06 제거 예정 transitional 안전망).
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { from: start.getTime(), to: now };
    }
    case 'all':
    default:
      return {};
  }
}

/**
 * /api/metrics/* 용 range 파라미터. 레거시 api.js getMetricRangeParams 1:1.
 * from/to 가 있으면 그대로, 없으면(전체) range:'all' 명시(서버 기본 24h 폴백 방지).
 */
export function rangeToMetricParams(ar: ActiveRange, now: number = Date.now()): RangeParams {
  const dr = rangeToParams(ar, now);
  if (dr.from != null && dr.to != null) return dr;
  return { range: 'all' };
}

/**
 * model-usage 도넛 fetch 파라미터 — metricRange + 선택 프로젝트 스코프.
 *
 * 분리 근거(연쇄 리로드 방지): BrowseLayout 메인 population effect 의 5 fetch 중 selectedProject 를
 *   실제로 쓰는 것은 model-usage 하나뿐이다. 이 순수 함수로 "어떤 입력이 어떤 fetch 파라미터를
 *   결정하는가"를 표면화해, model-usage 만 selectedProject 에 의존하는 별도 effect 로 떼어낸다.
 *   결과적으로 진입 auto-select 가 selectedProject 를 채워도 dashboard/sessions/requests/cache
 *   (project 무관) 4요청은 재발화하지 않는다(마운트 시 무거운 요청 2회 실행 회귀 제거).
 *
 *   - project 지정(truthy) → metricRange 에 project 병합(서버가 sessions JOIN 으로 모델 분포 스코프).
 *   - project null/빈문자 → metricRange 그대로(전역, 서버 기본).
 *   입력 metricRange 는 변형하지 않는다(스프레드 복사).
 */
export function buildModelUsageParams(metricRange: RangeParams, project: string | null): MetricParams {
  return project ? { ...metricRange, project } : metricRange;
}
