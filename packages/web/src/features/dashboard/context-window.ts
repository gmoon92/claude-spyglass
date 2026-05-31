/**
 * features/dashboard/context-window.ts — 컨텍스트 윈도우 표시 유틸 (P3-09)
 *
 * 원본: assets/js/context-window.js (서버 SSoT 단일화 후 표시 전용 순수 함수).
 *  - 한도 산출/추론은 서버(model-limits.ts)가 소유. 클라이언트는 표시 라벨링만.
 *  - 본 모듈은 원본을 1:1 .ts 로 이식(순수, 무의존). ContextChart.tsx 가 소비.
 *
 * @module features/dashboard/context-window
 */

/** 서버가 window_max 를 누락했을 때만 쓰이는 안전 폴백(원본 동일). */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * 토큰 한도를 사람이 읽기 좋은 라벨로 변환("200K" / "1.0M" / "262.1K").
 * 인디케이터·풋터·툴팁 일관 표기 SSoT(원본 formatContextWindowLabel 동치).
 */
export function formatContextWindowLabel(size: number): string {
  if (size >= 1_000_000) {
    const m = size / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (size >= 1000) {
    const k = size / 1000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(size);
}
