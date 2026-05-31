/**
 * app-mode-route.test.ts — appMode ↔ URL 경로 브리지 순수 계약 (P4-06)
 *
 * 원본: main.js applyAppMode(:73-123) 의 body[data-app-mode] CSS 라우팅을
 *   React Router v6 useNavigate 로 전환하기 위한 순수 매핑 SSoT.
 *   appMode('browse'|'metadocs'|'settings') ↔ route path 의 양방향 변환을 검증한다.
 *
 * 순수 함수 — 라우터/effect 무의존. SSR/노드 환경에서 그대로 실행.
 */
import { describe, it, expect } from 'vitest';
import {
  ROUTE_PATHS,
  APP_MODE_PATHS,
  appModeToPath,
  pathToAppMode,
} from '../app-mode-route';
import type { AppMode } from '../../stores/app-store';

describe('app-mode-route — appMode ↔ path 매핑', () => {
  it('ROUTE_PATHS 는 3 모드의 경로 상수를 노출한다', () => {
    expect(ROUTE_PATHS.browse).toBe('/');
    expect(ROUTE_PATHS.metadocs).toBe('/meta-docs');
    expect(ROUTE_PATHS.settings).toBe('/settings');
  });

  it('appModeToPath — 각 모드를 고정 경로로 변환', () => {
    expect(appModeToPath('browse')).toBe('/');
    expect(appModeToPath('metadocs')).toBe('/meta-docs');
    expect(appModeToPath('settings')).toBe('/settings');
  });

  it('pathToAppMode — 각 경로를 모드로 역변환', () => {
    expect(pathToAppMode('/')).toBe('browse');
    expect(pathToAppMode('/meta-docs')).toBe('metadocs');
    expect(pathToAppMode('/settings')).toBe('settings');
  });

  it('pathToAppMode — 미지 경로는 browse 로 폴백(main.js applyAppMode 무효값 가드 1:1)', () => {
    expect(pathToAppMode('/unknown')).toBe('browse');
    expect(pathToAppMode('')).toBe('browse');
    // 하위 경로(트레일링 세그먼트)도 prefix 로 해석.
    expect(pathToAppMode('/meta-docs/anything')).toBe('metadocs');
    expect(pathToAppMode('/settings/diag')).toBe('settings');
  });

  it('왕복(round-trip) — 모든 유효 모드는 path→mode→path 가 보존된다', () => {
    const modes: AppMode[] = ['browse', 'metadocs', 'settings'];
    for (const m of modes) {
      expect(pathToAppMode(appModeToPath(m))).toBe(m);
    }
  });

  it('APP_MODE_PATHS 는 setAppMode 가드(browse/metadocs/settings)와 동일 키 집합', () => {
    expect(Object.keys(APP_MODE_PATHS).sort()).toEqual(['browse', 'metadocs', 'settings']);
  });
});
