// 순수 포매터 유틸 — DOM/상태 의존 없음

export function fmt(n) { return (n ?? 0).toLocaleString('ko-KR'); }

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
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const diffMs  = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}시간 전`;
  return `${Math.floor(diffH / 24)}일 전`;
}

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const isSameDay = d.toDateString() === new Date().toDateString();
  return isSameDay ? fmtTime(ts)
    : d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' + fmtTime(ts);
}

export function fmtTimestamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const isToday = d.toDateString() === new Date().toDateString();
  const time  = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const prefix = isToday ? '' : d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ';
  const rel    = fmtRelative(ts);
  return rel ? `${prefix}${time} · ${rel}` : `${prefix}${time}`;
}

export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
