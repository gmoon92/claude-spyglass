// features/dashboard/version-check-controller.ts — 버전 폴링 컨트롤러 (P4-09)
//
// 원본: version-check.js refreshBadge(:347-387) + setInterval(refreshBadge, 10min)(:595).
//   use-sse.ts createSSEController 선례 — fetch·interval 을 React 무의존 주입형 클로저로 추출한다.
//   순수 상태 결정(resolveBadgeState)은 version-check-logic SSoT 재사용(재구현 금지).
//
// 신규 계약(원본 대비):
//   - fetchVersion 주입 — /api/version 호출을 외부에서 주입(테스트 시 가짜 주입, 타이머/네트워크 무의존).
//   - onState/onCache/onShallow 콜백 — DOM-imperative 배지/모달/경고 토글을 호출처(React)가 결선.
//   - stop() 가드 — 언마운트 후 refresh/interval 통지 차단(원본 미보장 cleanup, use-sse stop 패턴 1:1).
//
// 레이어: features leaf(주입형, 무전역). useVersionCheck(React)가 이 컨트롤러를 effect 로 감싼다.

import { resolveBadgeState, type BadgeState } from './version-check-logic';

/** /api/version 응답 data 형태(version-check.js cache 1:1, 모두 옵셔널 — 트랙 A 미적용 호환). */
export interface VersionPayload {
  currentVersion?: string;
  latestTag?: string;
  updateAvailable?: boolean;
  isShallowRepository?: boolean;
  updateChannel?: string;
}

/** 배지 뷰모델 — 상태 + 표시용 버전(컴포넌트 controlled props 로 전달). */
export interface VersionViewState {
  badge: BadgeState;
  currentVersion?: string;
  latestTag?: string;
}

export interface VersionCheckDeps {
  /** /api/version 호출 — 실패/비정상 응답은 null 반환(호출처 폴백). */
  fetchVersion: () => Promise<VersionPayload | null>;
  /** 배지 상태 통지(applyBadgeState 결선). */
  onState: (s: VersionViewState) => void;
  /** 응답 payload 보관 통지(원본 cache 결선) — 모달이 버전 비교에 사용. */
  onCache?: (c: VersionPayload) => void;
  /** shallow clone 표지 통지(applyShallowWarning 결선). */
  onShallow?: (isShallow: boolean) => void;
  /** 폴링 주기(ms) — 기본 10분(원본 :595). */
  intervalMs?: number;
}

export interface VersionCheckController {
  /** 1회 갱신 — fetchVersion → resolveBadgeState → onState/onCache/onShallow. stop 후 no-op. */
  refresh: () => Promise<void>;
  /** 폴링 시작 — 즉시 1회 + intervalMs 마다 refresh. */
  start: () => void;
  /** 정지 — interval clear + 이후 통지 차단(언마운트 cleanup). */
  stop: () => void;
}

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 버전 폴링 컨트롤러 — fetchVersion 결과를 배지/캐시/shallow 통지로 결선한다.
 * refreshBadge(:347-387) 의 분기를 1:1 보존:
 *   - 응답 null → cache 있으면 latest, 없으면 loading 유지.
 *   - updateChannel !== 'git' → 배지/경고 비활성(loading, shallow=false).
 *   - 정상 → resolveBadgeState(currentVersion/latestTag/updateAvailable) + shallow 토글.
 */
export function createVersionCheckController(deps: VersionCheckDeps): VersionCheckController {
  const { fetchVersion, onState, onCache, onShallow, intervalMs = DEFAULT_INTERVAL_MS } = deps;

  let cache: VersionPayload | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function refresh(): Promise<void> {
    if (stopped) return;
    let payload: VersionPayload | null;
    try {
      payload = await fetchVersion();
    } catch {
      payload = null;
    }
    if (stopped) return;

    if (!payload) {
      // 응답 없음 — cache 있으면 latest, 없으면 loading(원본 catch/!ok 분기 1:1).
      if (cache?.currentVersion) {
        onState({ badge: 'latest', currentVersion: cache.currentVersion, latestTag: cache.latestTag });
      } else {
        onState({ badge: 'loading' });
      }
      return;
    }

    cache = payload;
    onCache?.(payload);

    // 'git' 이외 채널 — in-place 업데이트 무의미 → 배지/경고 비활성(원본 :367-372 1:1).
    if (payload.updateChannel && payload.updateChannel !== 'git') {
      onState({ badge: 'loading' });
      onShallow?.(false);
      return;
    }

    const badge = resolveBadgeState({
      currentVersion: payload.currentVersion,
      latestTag: payload.latestTag,
      updateAvailable: payload.updateAvailable,
    });
    onState({ badge, currentVersion: payload.currentVersion, latestTag: payload.latestTag });
    onShallow?.(Boolean(payload.isShallowRepository));
  }

  function start(): void {
    if (stopped) return;
    void refresh();
    timer = setInterval(() => { void refresh(); }, intervalMs);
  }

  function stop(): void {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { refresh, start, stop };
}
