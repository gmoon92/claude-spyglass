/**
 * features/session-detail/use-detail-aux.ts — 상세 보조 탭(LLM Input·System 라이브러리) 데이터 오케스트레이션 훅
 *
 * 원본 부수효과:
 *  - turn-views.js#setDetailView('llm')  → showLatestLlmInput()(llm-input-view.js:154):
 *      세션 proxy 목록 fetch → 활성(latest) 선택 → renderLlmInput(messages + system 본문 lazy).
 *  - turn-views.js#setDetailView('syslib') → loadSystemPromptLibrary()(system-prompt-library.js:75):
 *      /api/system-prompts 목록 fetch(1회 캐시, 정렬은 클라이언트).
 *
 * 이식 형태(use-session-detail.ts 패턴 동형):
 *  - LLM Input: 세션 변경 시 proxy 목록 fetch → latest(timestamp 최대) 자동 선택 → 사용자가
 *    셀렉터로 다른 proxy 선택 시 messages/system 재fetch. AbortController 로 세션·요청 전환 시 abort.
 *  - SysLib: 세션과 무관한 카탈로그라 1회 fetch(컴포넌트 마운트 시) — 정렬은 SystemPromptLibrary 가 담당.
 *
 * 비책임(presentation 소유 아님): 본 훅은 fetch·상태만, 렌더는 LLMInput / SystemPromptLibrary 가 담당.
 *
 * @module features/session-detail/use-detail-aux
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSessionProxyList,
  fetchProxyMessages,
  fetchSystemPrompt,
  fetchSystemPromptLibrary,
  type ProxyMetaRow,
  type SysLibRowRaw,
} from './detail-aux-fetcher';

/** latest proxy 선택 — timestamp 최대(원본 list[list.length-1] 가정 + 안전 비교). */
function pickLatest(list: ProxyMetaRow[]): ProxyMetaRow | null {
  if (list.length === 0) return null;
  return list.reduce((a, b) => {
    const ta = Number((a as { timestamp?: number }).timestamp ?? 0);
    const tb = Number((b as { timestamp?: number }).timestamp ?? 0);
    return tb >= ta ? b : a;
  });
}

/** useLlmInput 반환 — LLMInput 컴포넌트 props 묶음. */
export interface UseLlmInputResult {
  requestId: string;
  systemHash: string | null;
  systemSize: number | null;
  systemContent: string | null;
  systemMeta: Record<string, unknown> | null;
  messages: unknown[];
  decodeError: string | null;
  proxyList: ProxyMetaRow[];
  /** 셀렉터 변경 — 다른 proxy 요청 선택(원본 renderLlmInput 재호출). */
  selectProxy: (id: string) => void;
}

/**
 * useLlmInput — 세션 LLM Input 탭 데이터. enabled(탭 활성) 일 때만 fetch(lazy, 원본 setDetailView 진입 시).
 *  - 세션 변경 시 proxy 목록 fetch → latest 자동 선택.
 *  - 선택 proxy 의 messages + system 본문(hash 있을 때)을 fetch.
 */
export function useLlmInput(
  sessionId: string | null | undefined,
  enabled: boolean,
): UseLlmInputResult {
  const [proxyList, setProxyList] = useState<ProxyMetaRow[]>([]);
  const [requestId, setRequestId] = useState<string>('');
  const [systemHash, setSystemHash] = useState<string | null>(null);
  const [systemSize, setSystemSize] = useState<number | null>(null);
  const [systemContent, setSystemContent] = useState<string | null>(null);
  const [systemMeta, setSystemMeta] = useState<Record<string, unknown> | null>(null);
  const [messages, setMessages] = useState<unknown[]>([]);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  // 1) 세션 변경(+탭 활성) 시 proxy 목록 fetch → latest 선택.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const controller = new AbortController();
    (async () => {
      const list = await fetchSessionProxyList(sessionId, controller.signal);
      if (controller.signal.aborted) return;
      setProxyList(list);
      const latest = pickLatest(list);
      setRequestId(latest ? latest.id : '');
    })();
    return () => controller.abort();
  }, [sessionId, enabled]);

  // 2) 선택 proxy 의 messages + system 본문 fetch(원본 renderLlmInput 2단계).
  useEffect(() => {
    if (!enabled || !requestId) {
      setMessages([]);
      setSystemHash(null);
      setSystemSize(null);
      setSystemContent(null);
      setSystemMeta(null);
      setDecodeError(null);
      return;
    }
    const controller = new AbortController();
    (async () => {
      const m = await fetchProxyMessages(requestId, controller.signal);
      if (controller.signal.aborted) return;
      setMessages(m.messages);
      setSystemHash(m.systemHash);
      setSystemSize(m.systemSize);
      setDecodeError(m.decodeError);
      if (m.systemHash) {
        const sys = await fetchSystemPrompt(m.systemHash, controller.signal);
        if (controller.signal.aborted) return;
        setSystemContent(sys.content);
        setSystemMeta(sys.meta);
      } else {
        setSystemContent(null);
        setSystemMeta(null);
      }
    })();
    return () => controller.abort();
  }, [requestId, enabled]);

  const selectProxy = useCallback((id: string) => setRequestId(id), []);

  return {
    requestId,
    systemHash,
    systemSize,
    systemContent,
    systemMeta,
    messages,
    decodeError,
    proxyList,
    selectProxy,
  };
}

/** useSystemPromptLibrary 반환. */
export interface UseSystemPromptLibraryResult {
  /** null = 아직 로드 안 됨(빈 상태 vs 로딩 구분은 컴포넌트가 rows===null 로 처리). */
  rows: SysLibRowRaw[] | null;
}

/**
 * useSystemPromptLibrary — System 라이브러리 카탈로그(세션 무관). enabled(탭 활성) 일 때 1회 fetch.
 * 원본 loadSystemPromptLibrary: 서버 정렬 1회 + 클라이언트 재정렬(정렬은 SystemPromptLibrary 소유).
 */
export function useSystemPromptLibrary(enabled: boolean): UseSystemPromptLibraryResult {
  const [rows, setRows] = useState<SysLibRowRaw[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    (async () => {
      const list = await fetchSystemPromptLibrary(controller.signal);
      if (controller.signal.aborted) return;
      setRows(list);
    })();
    return () => controller.abort();
  }, [enabled]);

  return useMemo(() => ({ rows }), [rows]);
}
