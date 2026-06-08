// features/dashboard/UpdateBadge.tsx — 버전 상태 배지 (P4-09)
//
// 원본: index.html #updateBadge(:356-375, available/latest/loading 3 아이콘 동시 마크업 + 모디파이어 분기) +
//   version-check.js applyBadgeState(:96-129, 모디파이어 클래스 + 라벨 + ARIA).
//   controlled `state` prop 으로 모디파이어 클래스를 선언적으로 도출(명령적 classList.toggle 대체).
//
// 신규 계약: state(resolveBadgeState 결과) + 버전 props 주입. available 일 때만 onOpen 발화(openModal 가드 1:1).
//   3 아이콘은 원본대로 동시 마크업 — CSS 가 모디파이어별 1종만 노출(SSoT 유지).

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeTag, tSafe, type BadgeState } from './version-check-logic';

/** i18n 해석 함수 시그니처(tSafe 호환) — useTranslation t 를 래핑해 전달. */
type TFn = (key: string, vars?: Record<string, unknown>) => string;

export interface UpdateBadgeProps {
  /** 배지 상태(resolveBadgeState 결과) — 모디파이어 클래스 분기. */
  state: BadgeState;
  /** 표시용 현재/최신 버전(라벨·ARIA 결정). */
  currentVersion?: string;
  latestTag?: string;
  /** available 클릭 시 모달 진입(openModal 결선) — available 이 아니면 no-op. */
  onOpen: () => void;
}

/** 상태별 라벨/ARIA 결정 — applyBadgeState(:106-124) 1:1(tSafe fallback 포함). */
function resolveLabel(
  state: BadgeState,
  currentVersion: string | undefined,
  latestTag: string | undefined,
  t: TFn,
): { label: string; aria: string } {
  if (state === 'available') {
    const tag = latestTag ?? '';
    return {
      label: tSafe(t, 'ui:version-check.available', { tag }, `${tag} available`),
      aria: tSafe(t, 'ui:html.chart-section.update-badge-aria-available', { tag: normalizeTag(tag) }, `Update available — v${normalizeTag(tag)}`),
    };
  }
  if (state === 'latest') {
    const tag = currentVersion ?? latestTag ?? '';
    const tagN = normalizeTag(tag);
    return {
      label: tSafe(t, 'ui:version-check.latest', { tag: `v${tagN}` }, `v${tagN} · Up to date`),
      aria: tSafe(t, 'ui:html.chart-section.update-badge-aria-latest', { tag: tagN }, `Up to date — v${tagN}`),
    };
  }
  return {
    label: tSafe(t, 'ui:version-check.loading', undefined, 'Checking…'),
    aria: tSafe(t, 'ui:html.chart-section.update-badge-aria-loading', undefined, 'Checking for updates'),
  };
}

/**
 * 버전 상태 배지 — #updateBadge 1:1. available 클릭 시에만 onOpen.
 * memo: AppShell 로컬 state(connected/leftPanelHidden/modalOpen) 변화로부터 격리 — 폴링 결과(state/version)
 *   불변 시 재렌더 생략(props 안정 전제: 호출처가 onOpen/t 를 안정 참조로 주입).
 */
export const UpdateBadge = memo(function UpdateBadge({ state, currentVersion, latestTag, onOpen }: UpdateBadgeProps): ReactElement {
  const { t: tBase } = useTranslation();
  const t: TFn = (key, vars) => tBase(key, vars) as unknown as string;
  const { label, aria } = resolveLabel(state, currentVersion, latestTag, t);
  const className = `update-badge update-badge--${state}`;
  return (
    <button
      type="button"
      className={className}
      aria-label={aria}
      onClick={() => { if (state === 'available') onOpen(); }}
    >
      {/* available — 패키지 박스 + 위로 가는 흐름 */}
      <svg className="update-badge-icon update-badge-icon--available" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 1L12.5 3.5V10.5L7 13L1.5 10.5V3.5L7 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M1.5 3.5L7 6L12.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M7 6V13" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {/* latest — 체크 마크 */}
      <svg className="update-badge-icon update-badge-icon--latest" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.25" fill="none" />
        <path d="M4.5 7.25L6.25 9L9.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {/* loading — 작은 도트 */}
      <svg className="update-badge-icon update-badge-icon--loading" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="2" fill="currentColor" />
      </svg>
      <span className="update-badge-text">{label}</span>
    </button>
  );
});
