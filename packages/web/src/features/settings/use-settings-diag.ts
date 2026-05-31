/**
 * features/settings/use-settings-diag.ts — diag/logs 데이터 페칭 훅 (P2-06)
 *
 * 원본: settings-view.js 6개 렌더 함수의 try/catch + _generation 가드(:177-190 등) 중복을 1개
 *   훅으로 통합(아키텍처 §4.1 권장). in-flight 가드는 _generation 카운터 → AbortController +
 *   useEffect cleanup 로 대체(§5.1 신계약) — sub-tab 전환/언마운트 시 stale setState 차단.
 *
 * 상태: status('loading'|'ok'|'error') + data + error. refetch 로 수동 갱신(refresh 버튼 :134).
 *   stale-while-revalidate 없이 마운트/refetch 시 항상 최신 fetch(원본 디자인 :21).
 *
 * 무전역: fetcher 를 prop 으로 주입 가능(테스트/대체) — 기본 hooks-api.fetchDiag/fetchLogs.
 */
import { useCallback, useEffect, useState } from 'react';

export type AsyncStatus = 'loading' | 'ok' | 'error';

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
  /** 수동 재요청(refresh 버튼). */
  refetch: () => void;
}

/**
 * AbortSignal 수용 fetcher 를 마운트/refetch 시 호출하고 결과를 상태로 노출.
 * 언마운트/재요청 시 이전 요청 abort → stale setState 방지(§5.1).
 *
 * @param fetcher (signal) => Promise<T> — 예: (s)=>fetchDiag(s).
 */
export function useAsyncResource<T>(fetcher: (signal: AbortSignal) => Promise<T>): AsyncState<T> {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    let active = true;
    setStatus('loading');
    setError(null);
    fetcher(ctrl.signal)
      .then((d) => {
        if (!active) return; // 언마운트/재요청 후 도착한 stale 응답 무시(§5.1).
        setData(d);
        setStatus('ok');
      })
      .catch((err) => {
        if (!active || ctrl.signal.aborted) return; // abort 는 정상 cleanup — 에러 표시 안 함.
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
    return () => {
      active = false;
      ctrl.abort();
    };
    // nonce 변경 = refetch 트리거. fetcher 는 호출처가 useCallback 으로 안정화.
  }, [fetcher, nonce]);

  return { status, data, error, refetch };
}
