// features/browse/use-obs-cards.ts — 좌측 사이드바 하단 통계카드 3종 데이터 로드 훅
//
// 원본: assets/js/api.js fetchObservability(:323-355) — burn-rate / cache-trend / sessions/active
//   3종을 Promise.all 로 모아 renderBurnRate / renderCacheHealth / renderLivePulse 에 dispatch.
//   본 훅은 그 fetch + payload 합성만 담당(렌더는 ObsPanel 카드). 사이드이펙트는 훅 내부에만.
//
// 데이터 역전(P3 동형): fetch → raw payload state. ObsPanel 카드는 이 payload 를 controlled props 로 받음.
//   - burn-rate / cache-trend 응답 data 는 BurnRatePayload / CacheHealthPayload 와 구조 동치(curl 확인).
//   - sessions/active 는 세션 배열 → LivePulsePayload 로 합성(원본 api.js:344-350 1:1):
//       active_count = 배열 길이, last_event_ts = max(last_activity_at), recent_calls = [] (Phase 2 미구현).
//
// 갱신 주기: 원본은 fetchDashboard(SSE/주기) 트리거에 편승해 fetchObservability 를 호출했다.
//   React 계층 분리상 본 훅은 마운트 1회 + 자체 interval 폴링(기본 30s)으로 동치 신선도 유지.
//   AbortController 로 in-flight 취소, 언마운트 시 interval clear.
//
// SSR 안전: useEffect 는 renderToStaticMarkup 에서 미발화 → fetch 미생성(테스트 안전, use-version-check 선례).

import { useEffect, useState } from 'react';
import type { BurnRatePayload, CacheHealthPayload, LivePulsePayload } from '../dashboard/obs-card-data';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_INTERVAL_MS = 30_000;

/** /api/sessions/active 응답 1행(LivePulse 합성 입력). 원본 api.js activeArr 요소. */
interface ActiveSessionRow {
  last_activity_at?: number | null;
}

/** envelope { success, data } unwrap — 실패(HTTP/!success/abort) 시 null(원본 safeJson 동치). */
async function safeJson<T>(path: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(path, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: T };
    if (!json.success) return null;
    return (json.data ?? null) as T | null;
  } catch {
    return null;
  }
}

/** sessions/active 배열 → LivePulsePayload 합성(원본 api.js:344-350 1:1). */
export function toLivePulse(active: ActiveSessionRow[] | null): LivePulsePayload | null {
  const arr = Array.isArray(active) ? active : [];
  const lastEventTs = arr.reduce((m, s) => Math.max(m, s.last_activity_at || 0), 0) || null;
  return { active_count: arr.length, last_event_ts: lastEventTs, recent_calls: [] };
}

export interface ObsCardsState {
  burnRate: BurnRatePayload | null;
  cacheHealth: CacheHealthPayload | null;
  livePulse: LivePulsePayload | null;
}

export interface UseObsCardsOptions {
  /** 폴링 주기(ms) — 미지정 시 30s. 0/음수면 1회만(폴링 없음). */
  intervalMs?: number;
}

/**
 * 통계카드 3종(Burn Rate / Cache Health / Live Pulse) 데이터 로드 훅.
 *  - 마운트 1회 즉시 로드 + intervalMs 주기 갱신.
 *  - 각 tick 은 AbortController 로 in-flight 취소(중첩 방지), 언마운트 시 interval clear.
 *  - 부분 실패 안전: 한 엔드포인트 실패가 다른 카드를 막지 않음(safeJson null 폴백).
 */
export function useObsCards(options: UseObsCardsOptions = {}): ObsCardsState {
  const { intervalMs = DEFAULT_INTERVAL_MS } = options;
  const [state, setState] = useState<ObsCardsState>({
    burnRate: null,
    cacheHealth: null,
    livePulse: null,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let inflight: AbortController | null = null;
    let cancelled = false;

    const load = async (): Promise<void> => {
      inflight?.abort();
      const ctrl = new AbortController();
      inflight = ctrl;
      const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]);
      const [burn, cache, active] = await Promise.all([
        safeJson<BurnRatePayload>('/api/metrics/burn-rate', signal),
        safeJson<CacheHealthPayload>('/api/metrics/cache-trend', signal),
        safeJson<ActiveSessionRow[]>('/api/sessions/active', signal),
      ]);
      if (cancelled || ctrl.signal.aborted) return;
      setState({ burnRate: burn, cacheHealth: cache, livePulse: toLivePulse(active) });
    };

    void load();
    if (intervalMs > 0) {
      timer = setInterval(() => void load(), intervalMs);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      inflight?.abort();
    };
    // 마운트 1회 시작 / 언마운트 1회 정지. intervalMs 는 안정 참조 가정(호출처 상수/useMemo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
