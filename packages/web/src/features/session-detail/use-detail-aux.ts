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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSessionProxyList,
  fetchProxyMessages,
  fetchSystemPrompt,
  fetchSystemPromptLibrary,
  type ProxyMetaRow,
  type SysLibRowRaw,
  type SystemPromptResult,
} from './detail-aux-fetcher';
import { useSSEStore } from '../../stores/sse-store';

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
  systemMeta: SystemPromptResult['meta'];
  messages: unknown[];
  decodeError: string | null;
  proxyList: ProxyMetaRow[];
  /** 셀렉터 변경 — 다른 proxy 요청 선택(원본 renderLlmInput 재호출). 수동 선택은 LIVE 추적 해제. */
  selectProxy: (id: string) => void;
  /**
   * 세션 LIVE 추적 중 여부(payload-chat-redesign 2차). true 면 이 세션에 새 proxy 호출이 도착할 때
   * 자동으로 최신 페이로드로 점프한다(녹화 재생 메타포 폐기). selectProxy(수동) 시 false 로 해제.
   */
  isLive: boolean;
  /** 추적 해제 상태에서 아직 보지 않은 신규 proxy 도착 수(LLMInput "새 요청 N ↓" 알림). */
  pendingNewCount: number;
  /** 최신으로 복귀 — LIVE 추적 재개 + 최신 proxy 선택 + pending 리셋. */
  followLatest: () => void;
  /**
   * 대화방 "작성 중" 신호(payload-chat-redesign 3차, A안 — 프론트 hook 휴리스틱).
   * LIVE 추적 중 이 세션에 hook 활동(new_request)이 도착하면 다음 턴 생성 중으로 보고 true.
   * 다음 proxy 완료(새 페이로드 도착) 또는 무활동 타임아웃 시 false. 채팅 타이핑 버블 표시용.
   */
  typing: boolean;
}

/** proxyFeed 이벤트(느슨)에서 session_id 추출(서버 broadcastNewProxyRequest 가 동봉, 스키마 passthrough). */
function proxySessionId(p: unknown): string | undefined {
  return typeof (p as { session_id?: unknown })?.session_id === 'string'
    ? (p as { session_id: string }).session_id
    : undefined;
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
  const [systemMeta, setSystemMeta] = useState<SystemPromptResult['meta']>(null);
  const [messages, setMessages] = useState<unknown[]>([]);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  // LIVE 추적: 기본 ON(진입 시 최신 따라감). 수동 selectProxy 시 OFF, followLatest 로 재개.
  const [following, setFollowing] = useState(true);
  const [pendingNewCount, setPendingNewCount] = useState(0);
  // SSE proxyFeed 구독(전역, prepend 최신순). 세션 필터는 effect 에서.
  const proxyFeed = useSSEStore((s) => s.proxyFeed);
  // hook feed 구독(new_request, 최신순) — "작성 중" 신호용(세션 활동 = 다음 턴 생성 중).
  const hookFeed = useSSEStore((s) => s.feed);
  // 이미 반영한 신규 proxy id(중복 처리·pending 이중 증가 방지).
  const lastSeenProxyRef = useRef<string | null>(null);
  // "작성 중" 상태 + 무활동 자동 해제 타이머 + 마지막 반영 hook id(중복 방지).
  const [typing, setTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHookRef = useRef<string | null>(null);

  // 1) 세션 변경(+탭 활성) 시 proxy 목록 fetch → latest 선택. 세션 전환 시 LIVE 추적 초기화.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const controller = new AbortController();
    setFollowing(true);
    setPendingNewCount(0);
    setTyping(false);
    lastSeenProxyRef.current = null;
    lastHookRef.current = null;
    (async () => {
      const list = await fetchSessionProxyList(sessionId, controller.signal);
      if (controller.signal.aborted) return;
      setProxyList(list);
      const latest = pickLatest(list);
      setRequestId(latest ? latest.id : '');
      if (latest) lastSeenProxyRef.current = latest.id;
    })();
    return () => controller.abort();
  }, [sessionId, enabled]);

  // 1b) SSE — 이 세션에 새 proxy 호출이 도착하면 목록 merge + (추적 중이면) 최신 자동 점프.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const newest = proxyFeed.find((p) => proxySessionId(p) === sessionId);
    if (!newest || newest.id === lastSeenProxyRef.current) return;
    lastSeenProxyRef.current = newest.id;
    // ProxyMetaRow 는 { id } + passthrough — NewProxyRequestEvent 가 그대로 호환(셀렉터 칩 필드 보유).
    const row = newest as unknown as ProxyMetaRow;
    setProxyList((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
    // 새 proxy(완성 턴) 도착 = "작성 중" 종료 — 메시지가 도착했으니 타이핑 버블 해제.
    setTyping(false);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (following) {
      setRequestId(row.id); // 자동 점프(idempotent — 동일 id 면 재fetch effect 무시)
    } else {
      setPendingNewCount((c) => c + 1);
    }
  }, [proxyFeed, enabled, sessionId, following]);

  // 1c) hook 활동 → "작성 중"(A안 휴리스틱). LIVE 추적 중 이 세션의 새 new_request 가 오면 다음 턴 생성
  //     중으로 보고 typing on, 무활동 7s 후 자동 해제(마지막 턴 대비). proxy 완료(1b)가 즉시 해제 우선.
  useEffect(() => {
    if (!enabled || !sessionId || !following) return;
    const newest = hookFeed.find((r) => (r as { session_id?: string }).session_id === sessionId);
    if (!newest) return;
    const key = String((newest as { id?: string }).id ?? '');
    if (!key || key === lastHookRef.current) return;
    lastHookRef.current = key;
    setTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => setTyping(false), 7000);
  }, [hookFeed, enabled, sessionId, following]);

  // 언마운트 시 타이머 정리.
  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, []);

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

  // 수동 선택 — LIVE 추적 해제(사용자가 과거 proxy 를 보는 중엔 자동 점프 금지).
  const selectProxy = useCallback((id: string) => {
    setRequestId(id);
    setFollowing(false);
  }, []);

  // 최신으로 복귀 — 추적 재개 + pending 리셋 + 최신 proxy 선택.
  const followLatest = useCallback(() => {
    setFollowing(true);
    setPendingNewCount(0);
    setProxyList((list) => {
      const latest = pickLatest(list);
      if (latest) setRequestId(latest.id);
      return list;
    });
  }, []);

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
    isLive: following,
    pendingNewCount,
    followLatest,
    typing,
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

/** 행 클릭으로 연 본문 상세(원본 showDetailModal 의 fetch+표시 상태). */
export interface SysLibDetail {
  hash: string;
  content?: string | null;
  byte_size?: number | null;
  segment_count?: number | null;
  ref_count?: number | null;
}

/** useSysLibDetail 반환 — SystemPromptDetailModal props 묶음. */
export interface UseSysLibDetailResult {
  /** 열린 hash(null = 모달 닫힘). */
  openHash: string | null;
  loading: boolean;
  detail: SysLibDetail | null;
  error: string | null;
  /** 행 클릭(원본 .syslib-row 클릭 → showDetailModal(hash)). */
  open: (hash: string) => void;
  /** ×/backdrop/ESC 닫기(원본 close()). */
  close: () => void;
}

/**
 * useSysLibDetail — System 라이브러리 행 클릭 시 본문 lazy-fetch(원본 showDetailModal).
 *  - open(hash) → /api/system-prompts/:hash 로 content+meta fetch → 모달 본문.
 *  - 새 hash 로 다시 열면 이전 fetch 는 AbortController 로 취소(잔여 응답 혼입 방지).
 *  - 실패는 error 로, 응답 없음은 detail=null(원본 not-found 분기).
 */
export function useSysLibDetail(): UseSysLibDetailResult {
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<SysLibDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!openHash) {
      setLoading(false);
      setDetail(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setDetail(null);
    setError(null);
    (async () => {
      try {
        const res = await fetchSystemPrompt(openHash, controller.signal);
        if (controller.signal.aborted) return;
        if (!res.meta && res.content == null) {
          setDetail(null); // 원본 not-found
        } else {
          const m = (res.meta ?? {}) as {
            byte_size?: number | null;
            segment_count?: number | null;
            ref_count?: number | null;
          };
          setDetail({
            hash: openHash,
            content: res.content,
            byte_size: m.byte_size ?? null,
            segment_count: m.segment_count ?? null,
            ref_count: m.ref_count ?? null,
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(String((err as { message?: string })?.message ?? err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [openHash]);

  const open = useCallback((hash: string) => setOpenHash(hash), []);
  const close = useCallback(() => setOpenHash(null), []);

  return { openHash, loading, detail, error, open, close };
}
