/**
 * features/dashboard/version-check-logic.ts — 버전 체크 순수 로직 (P3-09)
 *
 * 원본: assets/js/version-check.js (auto-update-migration-hardening).
 *  - 배지/모달 DOM 제어·fetch·POST·localStorage 는 DOM-imperative(이식 범위 외 — 후속 라우터 계층).
 *  - 본 모듈은 "표시 판정"의 순수부만 추출: normalizeTag/isSameVersion/tSafe + 배지 상태 뷰모델.
 *    update-badge-fix ADR-001: 정규화 동일하면 표시 억제(무의미한 모달 방지) — 그 판정이 순수.
 *
 * @module features/dashboard/version-check-logic
 */

/** 버전 태그 정규화 — 표시·비교용 동일성 안전 판정. ' v1.2.3 '/'V1.2.3' → '1.2.3'. */
export function normalizeTag(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.trim().replace(/^[vV]/, '');
}

/** 현재/최신이 사실상 동일한가 — 정규화 후 비교 + 빈 문자열 매칭 제외(원본 isSameVersion). */
export function isSameVersion(currentVersion: unknown, latestTag: unknown): boolean {
  const c = normalizeTag(currentVersion);
  const l = normalizeTag(latestTag);
  return Boolean(c) && c === l;
}

/**
 * i18n 안전 번역 — 키가 그대로 반환(namespace 미로딩)되면 fallback 사용(원본 tSafe).
 * @param t window.I18n.t 와 동일 시그니처(테스트 주입).
 */
export function tSafe(
  t: ((key: string, params?: Record<string, unknown>) => string) | null | undefined,
  key: string,
  params: Record<string, unknown> | undefined,
  fallback: string,
): string {
  const translated = t?.(key, params) ?? '';
  return translated && translated !== key ? translated : fallback;
}

export type BadgeState = 'available' | 'latest' | 'loading';

/**
 * 배지 표시 상태 결정(원본 applyBadgeState 진입 전 판정 + update-badge-fix ADR-001).
 *  - updateAvailable && !isSameVersion → 'available'
 *  - currentVersion 있고 동일 → 'latest'
 *  - 그 외(정보 없음) → 'loading'
 */
export function resolveBadgeState(input: {
  currentVersion?: string;
  latestTag?: string;
  updateAvailable?: boolean;
}): BadgeState {
  const { currentVersion, latestTag, updateAvailable } = input;
  if (updateAvailable && !isSameVersion(currentVersion, latestTag)) return 'available';
  if (currentVersion && isSameVersion(currentVersion, currentVersion)) return 'latest';
  return 'loading';
}
