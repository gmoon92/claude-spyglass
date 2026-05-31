// @ts-check
// util/date-range-storage.js — 활성 range localStorage hydrator
//
// date-range-filter ADR-004: preset만 저장, custom은 휘발 (절대시각 stale 위험).
//
// 정책:
//   - key: 'cs.dateRange'
//   - value: JSON.stringify({ v:1, type:'preset', value })
//   - 저장 시점: cs:active-range-changed 이벤트 구독 (preset만 저장, custom 시 no-op)
//   - 복원 시점: init()에서 SSE/fetchAll보다 먼저 1회
//   - 스키마 버전: 현재 v:1. 향후 변경 시 v:2 분기 + 마이그레이션
//   - custom 값이 저장되어 있는 경우(구버전/디버깅): 무시하고 default로 폴백
//     + ephemeral-toast 1초 안내

import { setActiveRange } from '../api.js';

const STORAGE_KEY = 'cs.dateRange';
const SCHEMA_VERSION = 1;

/**
 * @param {{type:'preset', value:string} | {type:'custom', from:number, to:number}} activeRange
 */
export function saveDateRange(activeRange: any) {
  if (typeof localStorage === 'undefined') return;
  if (!activeRange || activeRange.type !== 'preset') return; // custom 휘발
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: SCHEMA_VERSION,
      type: 'preset',
      value: activeRange.value,
    }));
  } catch { /* quota/serialize 실패 silent */ }
}

/**
 * @returns {import('../api.js').PresetRange | null} null이면 호출자가 default 사용
 */
export function loadDateRange() {
  if (typeof localStorage === 'undefined') return null;
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || parsed.v !== SCHEMA_VERSION) return null;
  if (parsed.type !== 'preset') return null;          // custom 저장된 경우 무시
  if (typeof parsed.value !== 'string') return null;
  // 저장값은 런타임 string — setActiveRange가 normalizeRange로 재검증하므로 PresetValue로 좁힘.
  return { type: 'preset' as const, value: parsed.value as string };
}

/**
 * init() 진입 직후 1회 호출. 저장된 preset이 있으면 복원, 없으면 default 'all'.
 * 'cs:active-range-changed' 구독으로 향후 변경 자동 저장 등록.
 *
 * @param {(msg: string) => void} [onCustomEphemeralToast] custom 잔존값 발견 시 안내용
 */
export function initDateRangeStorage(onCustomEphemeralToast?: (msg: string) => void) {
  // 1. hydrate
  const restored = loadDateRange();
  if (restored) {
    setActiveRange(restored as Parameters<typeof setActiveRange>[0]);
  } else if (typeof localStorage !== 'undefined') {
    // 구버전 raw 값이 있었는데 폴백된 경우 — 사용자에게 1회 안내 (선택)
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && raw.includes('custom') && typeof onCustomEphemeralToast === 'function') {
        const msg = (typeof window !== 'undefined' && window.I18n?.t?.('ui.main.date-filter.custom.ephemeral-toast')) || '';
        if (msg) onCustomEphemeralToast(msg);
      }
    } catch { /* silent */ }
  }
  // 2. 변경 이벤트 자동 저장
  if (typeof document !== 'undefined') {
    document.addEventListener('cs:active-range-changed', (e) => {
      saveDateRange((e as CustomEvent).detail);
    });
  }
}
