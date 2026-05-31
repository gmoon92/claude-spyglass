/**
 * version-check-controller.test.ts — 버전 폴링 컨트롤러 순수 결선 (P4-09)
 *
 * 원본: version-check.js refreshBadge(:347-387) — /api/version fetch → 배지 상태 결정.
 *   use-sse.ts createSSEController 선례(주입형 클로저)로 fetch·interval 을 React 무의존 컨트롤러로 추출.
 *   순수 상태 결정(resolveBadgeState)은 version-check-logic 이 SSoT — 본 테스트는 응답→상태 매핑 + cache 결선만 검증.
 *
 * 전략: fetchVersion 을 주입(가짜)해 타이머/네트워크 없이 결정적 검증. start() 1회 호출 시 onState 통지.
 */
import { describe, it, expect } from 'bun:test';
import { createVersionCheckController, type VersionPayload } from '../version-check-controller';

function makeFetch(payload: VersionPayload | null) {
  return async (): Promise<VersionPayload | null> => payload;
}

describe('version-check-controller — 응답 → 배지 상태', () => {
  it('updateAvailable && 다른 버전 → available + cache 보관', async () => {
    const states: string[] = [];
    let cache: VersionPayload | null = null;
    const ctrl = createVersionCheckController({
      fetchVersion: makeFetch({ currentVersion: '1.0.0', latestTag: '1.1.0', updateAvailable: true }),
      onState: (s) => states.push(s.badge),
      onCache: (c) => { cache = c; },
    });
    await ctrl.refresh();
    expect(states).toEqual(['available']);
    expect(cache).toEqual({ currentVersion: '1.0.0', latestTag: '1.1.0', updateAvailable: true });
    ctrl.stop();
  });

  it('동일 버전(updateAvailable=true 라도) → latest(ADR-001 억제)', async () => {
    const states: string[] = [];
    const ctrl = createVersionCheckController({
      fetchVersion: makeFetch({ currentVersion: '1.0.0', latestTag: 'v1.0.0', updateAvailable: true }),
      onState: (s) => states.push(s.badge),
    });
    await ctrl.refresh();
    expect(states).toEqual(['latest']);
    ctrl.stop();
  });

  it('fetch 실패(null) + cache 없음 → loading 유지', async () => {
    const states: string[] = [];
    const ctrl = createVersionCheckController({
      fetchVersion: makeFetch(null),
      onState: (s) => states.push(s.badge),
    });
    await ctrl.refresh();
    expect(states).toEqual(['loading']);
    ctrl.stop();
  });

  it('shallow 플래그를 onShallow 로 통지한다(applyShallowWarning 결선)', async () => {
    const shallowCalls: boolean[] = [];
    const ctrl = createVersionCheckController({
      fetchVersion: makeFetch({ currentVersion: '1.0.0', latestTag: '1.0.0', isShallowRepository: true }),
      onState: () => {},
      onShallow: (s) => shallowCalls.push(s),
    });
    await ctrl.refresh();
    expect(shallowCalls).toEqual([true]);
    ctrl.stop();
  });

  it('stop() 후 refresh 는 no-op(언마운트 가드)', async () => {
    const states: string[] = [];
    const ctrl = createVersionCheckController({
      fetchVersion: makeFetch({ currentVersion: '1.0.0', latestTag: '1.1.0', updateAvailable: true }),
      onState: (s) => states.push(s.badge),
    });
    ctrl.stop();
    await ctrl.refresh();
    expect(states).toEqual([]); // stop 후 통지 없음
  });
});
