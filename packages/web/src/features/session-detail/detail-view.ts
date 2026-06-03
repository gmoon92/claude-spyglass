/**
 * features/session-detail/detail-view.ts — 세션 로드 오케스트레이션 로직 (P3-07)
 *
 * 원본: assets/js/views/detail-view.js#loadSession (detail-view.js:24) 의 *네트워크/부수효과* 부.
 * 이식 형태(§2.3 + hooks-api 패턴):
 *  - parseAnomaliesResponse: 단건 /api/sessions/:id envelope → {bloatedSys, ctxSat, turnCount} 순수 추출
 *    (원본 detail-view.js:83-85). DOM·fetch 무관 → 단위 테스트 가능.
 *  - useSessionLoad: AbortController + 단건 anomaly fetch + anomaly-store 갱신(원본 loadSession 비동기
 *    IIFE :78-99). 세션 변경/언마운트 시 abort.
 *
 * A-2(CustomEvent 제거): 과거 'session-anomalies-loaded' document CustomEvent + assets anomaly-cache
 *  Map 으로 사이드바·헤더를 동기화하던 경로를 stores/anomaly-store(Zustand) 단일 SSoT 로 일원화한다.
 *  store.setBloatedSysFor 갱신이 곧 구독 소비처(사이드바 dot)의 재렌더 신호다(전역 이벤트버스 폐기).
 *
 * ★순환 가드(§5)★: 본 모듈은 turn-views.js / 루트 session-detail.js facade 를 import 하지 않는다.
 *
 * @module features/session-detail/detail-view
 */
import { useEffect } from 'react';
import { useAnomalyStore } from '../../stores/anomaly-store';

/** 단건 응답에서 추출한 anomaly 묶음. */
export interface SessionAnomalies {
  bloatedSys: unknown;
  contextSaturation: unknown;
  turnCount: number | null;
}

/**
 * 단건 /api/sessions/:id envelope → anomaly 추출(원본 detail-view.js:83-85).
 *  - anomalies.bloated_sys 우선, 없으면 data.bloated_sys 평면 폴백.
 *  - turn_count 는 유한수일 때만 채택.
 */
export function parseAnomaliesResponse(json: unknown): SessionAnomalies {
  const data = (json as { data?: Record<string, unknown> } | null)?.data ?? null;
  if (!data) return { bloatedSys: null, contextSaturation: null, turnCount: null };
  const anomalies = (data.anomalies as Record<string, unknown> | undefined) ?? undefined;
  const bloatedSys = anomalies?.bloated_sys ?? data.bloated_sys ?? null;
  const contextSaturation = anomalies?.context_saturation ?? null;
  const tc = data.turn_count;
  const turnCount = typeof tc === 'number' && Number.isFinite(tc) ? tc : null;
  return { bloatedSys, contextSaturation, turnCount };
}

/** useSessionLoad 콜백 — anomaly 도착 시 헤더 갱신 위임(순환 차단: store/detail 측이 주입). */
export interface UseSessionLoadOptions {
  /** anomaly 단건 fetch 완료 시 호출(파싱 결과 전달). */
  onAnomalies?: (a: SessionAnomalies) => void;
}

/**
 * useSessionLoad — 선택 세션의 단건 anomaly 를 비동기 로드해 캐시·이벤트·콜백으로 전파.
 *  - 원본 loadSession 의 비동기 IIFE(:78-99) 대응. 세션 id 변경/언마운트 시 직전 요청 abort.
 *  - 초기(요청 전): anomaly-store 를 null 로 갱신해 이전 세션 잔재 제거(원본 :75-77).
 *  - 성공: anomaly-store.setBloatedSysFor + onAnomalies 콜백(store 갱신이 사이드바 dot 재렌더 신호).
 *
 * @param sessionId 현재 선택 세션(falsy 면 no-op).
 * @param opts onAnomalies 콜백.
 */
export function useSessionLoad(sessionId: string | null | undefined, opts: UseSessionLoadOptions = {}): void {
  const { onAnomalies } = opts;
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    const { signal } = controller;
    const setBloatedSysFor = useAnomalyStore.getState().setBloatedSysFor;

    // 이전 세션 잔재 제거 — 단건 fetch 도착 전까지 빈 상태(원본 :75-77).
    setBloatedSysFor(sessionId, null);

    (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { signal });
        if (!res.ok) return;
        const json = await res.json();
        if (signal.aborted) return;
        const a = parseAnomaliesResponse(json);
        // SSoT 갱신 → 사이드바·차트·헤더 동일 데이터 참조(원본 :88). store 갱신이 곧 재렌더 신호.
        setBloatedSysFor(sessionId, a.bloatedSys);
        onAnomalies?.(a);
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
      }
    })();

    return () => controller.abort();
  }, [sessionId, onAnomalies]);
}
