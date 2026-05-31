// app/app-mode-route.ts — appMode ↔ URL 경로 브리지 SSoT (P4-06)
//
// 원본: main.js applyAppMode(:73-123) 는 body[data-app-mode] 속성 + CSS 룰로 모드별 가시성을
//   선언적으로 결정했다. React Router v6 전환에서는 "모드 = URL 경로"가 SSoT 가 된다.
//   본 모듈은 appMode('browse'|'metadocs'|'settings') ↔ route path 의 양방향 변환만 담는
//   순수 함수 집합이다(라우터/effect/스토어 무참조 — lib 성격 leaf).
//
// 레이어(architecture.md §1.3): app 내부 순수 매핑. stores 의 AppMode 타입만 import(정방향).
//   AppModeSync(useNavigate)·App(Routes) 가 이 함수를 호출해 라우팅을 결선한다.
//
// 무효값 가드(main.js applyAppMode:74 1:1): 미지 경로는 'browse' 로 폴백한다(앱 진입 기본 모드).

import type { AppMode } from '../stores/app-store';

/**
 * 모드별 라우트 경로 상수 — 라우터 <Route path> 와 useNavigate 가 공유하는 SSoT.
 *   browse   → '/'           (기본. 좌측 패널 + 우측 default/detail)
 *   metadocs → '/meta-docs'  (메타 문서 카탈로그/flow/tool-stats)
 *   settings → '/settings'   (진단/Hook/Graph/SQLite/Proxy 6 패널)
 */
export const ROUTE_PATHS = {
  browse: '/',
  metadocs: '/meta-docs',
  settings: '/settings',
} as const;

/**
 * appMode → path 매핑(키 집합 = setAppMode 가드와 동일: browse/metadocs/settings).
 * ROUTE_PATHS 와 동일 SSoT 를 모드 키 기준으로 재노출 — appModeToPath 가 이 맵을 조회.
 */
export const APP_MODE_PATHS: Record<AppMode, string> = {
  browse: ROUTE_PATHS.browse,
  metadocs: ROUTE_PATHS.metadocs,
  settings: ROUTE_PATHS.settings,
};

/** appMode → 고정 경로. (AppModeSync 가 store.appMode 변화를 navigate 로 반영) */
export function appModeToPath(mode: AppMode): string {
  return APP_MODE_PATHS[mode];
}

/**
 * 경로 → appMode 역변환. prefix 기준으로 하위 세그먼트도 흡수한다.
 *   '/meta-docs', '/meta-docs/x' → 'metadocs'
 *   '/settings',  '/settings/diag' → 'settings'
 *   그 외(미지/빈 문자열) → 'browse' 폴백(main.js applyAppMode 무효값 가드 1:1).
 */
export function pathToAppMode(path: string): AppMode {
  if (path === ROUTE_PATHS.metadocs || path.startsWith(`${ROUTE_PATHS.metadocs}/`)) {
    return 'metadocs';
  }
  if (path === ROUTE_PATHS.settings || path.startsWith(`${ROUTE_PATHS.settings}/`)) {
    return 'settings';
  }
  return 'browse';
}
