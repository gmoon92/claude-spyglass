/**
 * lib/settings-format.ts — 바이트/업타임/상대시각 포맷터 (P2-06)
 *
 * 원본: settings-view.js:1546-1568 의 formatBytes/formatUptime/formatRelTime 순수함수.
 *   SSoT 1:1 이식(재구현 금지 — 아키텍처 §1.1 주의). 순수함수라 lib/ 로 승격(architecture.md:46,60).
 *   ServerPanel(로그 크기/시각) + 진단 카드(uptime)에서 재사용 → P2-07 SqlitePanel 도 재사용.
 */

/** 바이트 → 사람이 읽는 단위(원본 :1546). null → '—'. */
export function formatBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 초 → "Ns" / "Nm Ns" / "Nh Nm"(원본 :1554). */
export function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

/** 절대 ms → 상대 "Ns/Nm/Nh/Nd ago"(원본 :1562). */
export function formatRelTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}
