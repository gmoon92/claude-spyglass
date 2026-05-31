// @ts-check
// 순수 포매터 유틸 — DOM 의존 없음, 활성 i18n 언어 기반 locale 적용
// (ko-KR 하드코딩 시 영/일/중 사용자에게도 한국어 숫자·날짜 형식이 노출되어 브랜드 일관성 손상)
//
// getLocale은 i18n-utils.js의 SSoT를 재사용한다 (chart.js / 정렬 모듈과 통일).

import { getLocale } from './i18n-utils.js';

export function fmt(n) { return (n ?? 0).toLocaleString(getLocale()); }

export function formatDuration(ms) {
  if (ms === null || ms === undefined || isNaN(ms) || ms < 0) return '—';
  if (ms >= 3_600_000) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function fmtToken(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export function fmtRelative(ts) {
  if (!ts) return '';
  const t = window.I18n?.t ?? ((k) => k);
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const diffMs  = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return t('common.formatters.just-now');
  if (diffMin < 60) return t('common.formatters.minutes-ago', { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return t('common.formatters.hours-ago', { n: diffH });
  return t('common.formatters.days-ago', { n: Math.floor(diffH / 24) });
}

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const isSameDay = d.toDateString() === new Date().toDateString();
  return isSameDay ? fmtTime(ts)
    : d.toLocaleDateString(getLocale(), { month: '2-digit', day: '2-digit' }) + ' ' + fmtTime(ts);
}

export function fmtTimestamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const isToday = d.toDateString() === new Date().toDateString();
  const locale = getLocale();
  const time  = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const prefix = isToday ? '' : d.toLocaleDateString(locale, { month: '2-digit', day: '2-digit' }) + ' ';
  const rel    = fmtRelative(ts);
  return rel ? `${prefix}${time} · ${rel}` : `${prefix}${time}`;
}

export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function shortModelName(model) {
  return model || null;
}
