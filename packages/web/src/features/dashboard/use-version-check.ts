// features/dashboard/use-version-check.ts — 버전 폴링 React 훅 (P4-09)
//
// 원본: version-check.js initVersionCheck(:586-623) 의 refreshBadge + setInterval(10min) 결선.
//   use-sse.ts useSSE 선례 — createVersionCheckController(주입형 클로저)를 useEffect 로 감싼다.
//   마운트 시 start()(즉시 1회 + 10분 폴링), 언마운트 시 stop()(interval clear + 통지 차단).
//
// SSR 안전: useEffect 는 renderToStaticMarkup 에서 미발화 → fetch/EventSource 미생성(테스트 안전).
//   fetchVersion 기본 구현은 /api/version GET(5초 timeout). 비정상 응답·예외는 null 반환(컨트롤러 폴백).

import { useEffect, useState } from 'react';
import {
  createVersionCheckController,
  type VersionPayload,
  type VersionViewState,
} from './version-check-controller';

/** /api/version 기본 fetch — version-check.js refreshBadge(:348-360) 1:1(성공 data 만 반환, 그 외 null). */
async function defaultFetchVersion(): Promise<VersionPayload | null> {
  try {
    const res = await fetch('/api/version', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: VersionPayload };
    if (!json.success || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

export interface UseVersionCheckResult {
  /** 배지 뷰모델(상태 + 버전) — UpdateBadge controlled props. */
  view: VersionViewState;
  /** 최신 응답 payload(모달 버전 비교용). */
  cache: VersionPayload | null;
  /** shallow clone 표지(DashboardWarning 결선). */
  isShallow: boolean;
}

export interface UseVersionCheckOptions {
  /** fetch 주입(테스트용) — 미지정 시 /api/version GET. */
  fetchVersion?: () => Promise<VersionPayload | null>;
  /** 폴링 주기(ms) — 미지정 시 10분. */
  intervalMs?: number;
}

/**
 * 버전 폴링 훅 — 마운트 시 폴링 시작, 언마운트 시 정지. 배지/캐시/shallow 를 state 로 노출.
 */
export function useVersionCheck(options: UseVersionCheckOptions = {}): UseVersionCheckResult {
  const { fetchVersion = defaultFetchVersion, intervalMs } = options;
  const [view, setView] = useState<VersionViewState>({ badge: 'loading' });
  const [cache, setCache] = useState<VersionPayload | null>(null);
  const [isShallow, setIsShallow] = useState(false);

  useEffect(() => {
    const ctrl = createVersionCheckController({
      fetchVersion,
      onState: setView,
      onCache: setCache,
      onShallow: setIsShallow,
      intervalMs,
    });
    ctrl.start();
    return () => ctrl.stop();
    // 마운트 1회 시작 / 언마운트 1회 정지. fetchVersion/intervalMs 는 안정 참조 가정(호출처 useMemo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { view, cache, isShallow };
}
