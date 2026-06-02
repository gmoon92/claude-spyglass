// @ts-check
// 순수 포매터 유틸 — DOM 의존 없음, 활성 i18n 언어 기반 locale 적용
// (ko-KR 하드코딩 시 영/일/중 사용자에게도 한국어 숫자·날짜 형식이 노출되어 브랜드 일관성 손상)
//
// getLocale은 i18n-utils.js의 SSoT를 재사용한다 (chart.js / 정렬 모듈과 통일).

import { getLocale } from './i18n-utils.js';

export function fmt(n: number | null | undefined) { return (n ?? 0).toLocaleString(getLocale()); }

export function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined || isNaN(ms) || ms < 0) return '—';
  if (ms >= 3_600_000) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function fmtToken(n: number | null | undefined) {
  if (!n) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

/**
 * Date 생성자 입력 정규화 — 원본 `ts < 1e12 ? ts * 1000 : ts` 와 출력 동치.
 *  - 초 단위 epoch(<1e12) 는 ms 로 환산, ms epoch 는 그대로.
 *  - ISO 문자열은 Number() 가 NaN → `n < 1e12` false → 원본 문자열을 그대로 new Date 에 전달.
 *  - 숫자 문자열은 원본의 암묵 강제변환(`str < num`, `str * num`)과 동일한 수치로 환산.
 * 호출 측 데이터가 string|number 혼재(스키마 number, RowLike/픽스처 ISO 문자열)이므로
 * strict 하에서 단일 지점으로 좁힌다(런타임 동작 무변경).
 */
function toDateArg(ts: string | number): string | number {
  const n = typeof ts === 'number' ? ts : Number(ts);
  return n < 1e12 ? n * 1000 : ts;
}

export function fmtRelative(ts: string | number | null | undefined) {
  if (!ts) return '';
  const t = window.I18n?.t ?? ((k: string) => k);
  const d = new Date(toDateArg(ts));
  const diffMs  = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return t('common.formatters.just-now');
  if (diffMin < 60) return t('common.formatters.minutes-ago', { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return t('common.formatters.hours-ago', { n: diffH });
  return t('common.formatters.days-ago', { n: Math.floor(diffH / 24) });
}

export function fmtTime(ts: string | number | null | undefined) {
  if (!ts) return '—';
  const d = new Date(toDateArg(ts));
  // hourCycle:'h23' — 24시간제 고정. ko 12시간제의 오전/오후(AM/PM) dayPeriod 표기는 ICU 버전마다
  //   "오전" vs "AM" 으로 갈려(로컬 vs CI ICU78) 골든 스냅샷이 환경별로 깨졌다. 24시간제는 dayPeriod 가
  //   없어 locale·ICU 무관 결정론이며, 옵저버빌리티 로그 시각 표기에도 더 적합하다.
  return d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}

export function fmtDate(ts: string | number | null | undefined) {
  if (!ts) return '—';
  const d = new Date(toDateArg(ts));
  const isSameDay = d.toDateString() === new Date().toDateString();
  return isSameDay ? fmtTime(ts)
    : d.toLocaleDateString(getLocale(), { month: '2-digit', day: '2-digit' }) + ' ' + fmtTime(ts);
}

export function fmtTimestamp(ts: string | number | null | undefined) {
  if (!ts) return '—';
  const d = new Date(toDateArg(ts));
  const isToday = d.toDateString() === new Date().toDateString();
  const locale = getLocale();
  // hourCycle:'h23' — 24시간제 고정(fmtTime 주석 참조: ICU 버전 무관 결정론 + 로그 시각 적합).
  const time  = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const prefix = isToday ? '' : d.toLocaleDateString(locale, { month: '2-digit', day: '2-digit' }) + ' ';
  const rel    = fmtRelative(ts);
  return rel ? `${prefix}${time} · ${rel}` : `${prefix}${time}`;
}

export function escHtml(s: unknown) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function shortModelName(model: string | null | undefined) {
  return model || null;
}
