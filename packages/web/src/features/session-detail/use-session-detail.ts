/**
 * features/session-detail/use-session-detail.ts — 세션 상세 turns 로드 + 파생 훅 (P3-07 데이터 배선)
 *
 * 원본 부수효과: assets/js/session-detail/index.js#loadSessionDetail(turns fetch, :87-98) +
 *   assets/js/session-detail/turn-views.js#renderTurnCards 의 *명령형 파생*(turn-views.js:918-941):
 *     - 활성 턴 결정: 명시 activeTurnId 가 현재 turns 안에 있으면 유지, 없으면 최신 턴(turn_index 최대).
 *     - activeReminders: computeNewRemindersByTurn(turns).get(activeTurn.turn_id).
 *     - agentSpike: activeTurn.agent_spike (allRequests 인덱스는 본 데이터 배선 범위 밖 — turn 폴백 사용).
 *     - spikeSamples: agentSpike.samples → tool_calls 토큰 시계열 폴백(turn-views.js:934-940).
 *
 * 이식 형태(detail-view.ts#useSessionLoad 패턴 동형):
 *   - turns fetch 는 fetchSessionTurns(colocated) — AbortController 로 세션 변경 시 직전 요청 abort.
 *   - 활성 턴은 컨테이너 로컬 state(useState) — 칩/마커 클릭 시 setActiveTurnId(원본 setActiveTurnId 대응).
 *   - 파생값(activeTurn/activeReminders/agentSpike/spikeSamples)은 useMemo 로 turns·activeTurnId 에서 계산.
 *
 * 비책임: anomaly 단건 fetch(헤더 뱃지)는 detail-view.ts#useSessionLoad 가 별도 소유 — 본 훅은 turns 만.
 *
 * @module features/session-detail/use-session-detail
 * @see packages/web/assets/js/session-detail/turn-views.js#renderTurnCards (원본 파생, :918-941)
 * @see packages/web/src/features/session-detail/detail-view.ts (useSessionLoad — AbortController 패턴)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeNewRemindersByTurn, type ReminderTurn } from '../../lib/system-reminder';
import { fetchSessionTurns, fetchTurnPayloads, type TurnRow, type PrologueRow } from './turns-fetcher';
import { useSSEStore } from '../../stores/sse-store';

/** useSessionDetail 반환 — DetailView 가 필요한 props 묶음. */
export interface UseSessionDetailResult {
  /** turns 본문(turn_index 내림차순 — 서버 응답 순서 그대로). */
  turns: TurnRow[];
  /** 프롤로그 행(turn_id NULL). */
  prologue: PrologueRow[];
  /** 현재 활성 턴 ID(없으면 null). */
  activeTurnId: string | null;
  /** 칩/마커 클릭 등에서 활성 턴 전환(원본 setActiveTurnId 대응). */
  setActiveTurnId: (turnId: string | null) => void;
  /** 활성 턴 객체(turns 에서 activeTurnId 로 탐색). */
  activeTurn: TurnRow | null;
  /** 활성 턴 신규 reminder 본문(computeNewRemindersByTurn). */
  activeReminders: string[];
  /** 활성 턴 agent_spike(turn 폴백). */
  agentSpike: unknown;
  /** spike sparkline 샘플(자식 토큰 시계열). */
  spikeSamples: number[];
  /** turns 도착 전 로딩 표시(첫 fetch 미완료). */
  loading: boolean;
}

/**
 * 최신 턴(turn_index 최대) 1개를 활성 기본값으로 — turn-views.js:923-925 동작 복제.
 *   명시 activeTurnId 가 현재 turns 안에 있으면 유지, 아니면 최신 턴으로 폴백.
 */
function resolveActiveTurnId(turns: TurnRow[], current: string | null): string | null {
  const ids = new Set(turns.map((t) => t.turn_id));
  if (current && ids.has(current)) return current;
  if (turns.length === 0) return null;
  const latest = turns.slice().sort((a, b) => b.turn_index - a.turn_index)[0];
  return latest ? latest.turn_id : null;
}

/** 한 행(prompt/tool_call/response)에 payload 가 채워져 있는지. */
function rowHasPayload(r: unknown): boolean {
  return !!r && (r as { payload?: unknown }).payload != null;
}

/** turn 의 어느 행이라도 payload 를 가졌는지(on-demand 로드 필요 판정). */
function turnHasPayload(turn: TurnRow | null | undefined): boolean {
  if (!turn) return false;
  const t = turn as { prompt?: unknown; tool_calls?: unknown[]; responses?: unknown[] };
  if (rowHasPayload(t.prompt)) return true;
  if (Array.isArray(t.tool_calls) && t.tool_calls.some(rowHasPayload)) return true;
  if (Array.isArray(t.responses) && t.responses.some(rowHasPayload)) return true;
  return false;
}

/** 행 배열에 id→payload 맵을 적용(가진 id 만 payload 채움). 불변 갱신. */
function applyPayloads<T extends { id?: string }>(rows: T[] | undefined, byId: Map<string, string | null>): T[] | undefined {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => (r.id != null && byId.has(r.id) ? { ...r, payload: byId.get(r.id) ?? null } : r));
}

/** 특정 turn 에 배치 payload(id→payload)를 병합한다(다른 turn 은 그대로). */
function mergeTurnPayloads(turns: TurnRow[], turnId: string, byId: Map<string, string | null>): TurnRow[] {
  return turns.map((turn) => {
    if (turn.turn_id !== turnId) return turn;
    const t = turn as TurnRow & { prompt?: { id?: string } | null; tool_calls?: { id?: string }[]; responses?: { id?: string }[] };
    const prompt = t.prompt && t.prompt.id != null && byId.has(t.prompt.id)
      ? { ...t.prompt, payload: byId.get(t.prompt.id) ?? null }
      : t.prompt;
    return { ...t, prompt, tool_calls: applyPayloads(t.tool_calls, byId), responses: applyPayloads(t.responses, byId) } as TurnRow;
  });
}

/**
 * 새 turns(payload 없음, 라이브 재fetch)에 이전 turns 의 행 payload 를 id 기준 보존 병합.
 *   라이브 갱신 시 이미 on-demand 로 로드된 활성 turn 의 펼침 본문이 깜빡이지 않게 한다.
 */
function carryPayloads(next: TurnRow[], prev: TurnRow[]): TurnRow[] {
  const byId = new Map<string, string | null>();
  const collect = (turn: TurnRow): void => {
    const t = turn as { prompt?: { id?: string; payload?: string | null } | null; tool_calls?: { id?: string; payload?: string | null }[]; responses?: { id?: string; payload?: string | null }[] };
    const add = (r?: { id?: string; payload?: string | null } | null): void => { if (r && r.id != null && r.payload != null) byId.set(r.id, r.payload); };
    add(t.prompt);
    (t.tool_calls ?? []).forEach(add);
    (t.responses ?? []).forEach(add);
  };
  prev.forEach(collect);
  if (byId.size === 0) return next;
  return next.map((turn) => {
    const t = turn as TurnRow & { prompt?: { id?: string } | null; tool_calls?: { id?: string }[]; responses?: { id?: string }[] };
    const prompt = t.prompt && t.prompt.id != null && byId.has(t.prompt.id)
      ? { ...t.prompt, payload: byId.get(t.prompt.id) ?? null }
      : t.prompt;
    return { ...t, prompt, tool_calls: applyPayloads(t.tool_calls, byId), responses: applyPayloads(t.responses, byId) } as TurnRow;
  });
}

/**
 * useSessionDetail — 선택 세션의 turns 를 로드하고 활성 턴·파생 메타를 제공.
 *  - sessionId 변경 시 직전 fetch abort + 활성 턴/turns 초기화(원본 loadSessionDetail 의 상태 리셋).
 *  - 활성 턴은 turns 도착 후 최신 턴으로 기본 선택(원본 turn-views.js:923-925).
 *
 * @param sessionId 현재 선택 세션(falsy 면 빈 상태).
 */
export function useSessionDetail(sessionId: string | null | undefined): UseSessionDetailResult {
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [prologue, setPrologue] = useState<PrologueRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  // 명시 활성 턴(사용자 칩/마커 클릭). null 이면 최신 턴 자동 폴백(resolveActiveTurnId).
  const [explicitTurnId, setExplicitTurnId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setTurns([]);
      setPrologue([]);
      setExplicitTurnId(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    // 세션 전환 시 이전 세션 잔재 제거(원본 loadSessionDetail clearExpandedTurnIds/setSearchQuery 대응).
    setExplicitTurnId(null);
    setLoading(true);
    (async () => {
      // turns-payload-lazy-load: payload BLOB 없이 즉시 받아 렌더한다(세션 전환 cold I/O 회피).
      //   스파인은 payload 불요(비활성 turn=마커만), 활성 turn 행/펼침은 preview/tool_detail 폴백으로
      //   기능적으로 렌더된다. payload 는 활성 turn 으로 전환될 때만 on-demand 로 채운다(아래 effect) —
      //   세션 전체를 background 로 당기던 낭비 제거. 본 turn 만 로드하므로 세션 크기와 무관하게 일정.
      const fast = await fetchSessionTurns(sessionId, signal, { includePayload: false });
      if (signal.aborted) return;
      setTurns(fast.turns);
      setPrologue(fast.prologue);
      setLoading(false);
    })();
    return () => controller.abort();
  }, [sessionId]);


  // ── SSE 라이브 갱신(레거시 refreshDetailSession 등가, React 포트 미이식분 복원) ──
  //   진행 중 세션 상세를 보는 동안 새 요청이 SSE 로 도착하면(sse-store.feed 에 prepend), 그 세션의
  //   turns 를 디바운스 재fetch 해 턴 스파인·로그·파생 차트(ContextChart/도넛)가 라이브로 갱신되게 한다.
  //   turns 자체를 SSE 로 패치하는 채널은 없으므로(turns 는 단건 fetch SSoT), 재fetch 가 정공법이다.
  //   새 turns 배열은 useMemo([turns])/React.memo(TurnLine) 를 정상 무효화한다.
  const feed = useSSEStore((s) => s.feed);
  // 현재 세션 head(최신) feed 이벤트 id — 새 요청 prepend 시 변함(라이브 신호).
  const liveSignal = useMemo(() => {
    if (!sessionId) return '';
    const head = feed.find((r) => (r as { session_id?: string }).session_id === sessionId);
    return head ? String((head as { id?: unknown }).id ?? '') : '';
  }, [feed, sessionId]);

  // 세션 진입/전환 run 은 초기 fetch effect 가 담당하므로 라이브 재fetch 를 건너뛰고, 같은 세션에서
  //   liveSignal 이 변할 때(새 요청)만 디바운스 재fetch 한다(초기 중복 fetch 방지).
  const liveSessionRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!sessionId) {
      liveSessionRef.current = sessionId;
      return;
    }
    if (liveSessionRef.current !== sessionId) {
      liveSessionRef.current = sessionId; // 세션 진입/전환 — 초기 fetch effect 가 처리. skip.
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      // 라이브 재fetch 도 payload=0(낭비 회피). 이미 on-demand 로 로드된 활성 turn 의 payload 는
      //   carryPayloads 로 보존 병합해 펼침 본문이 깜빡이지 않게 한다 — 빠진 turn 은 on-demand effect 가 채움.
      fetchSessionTurns(sessionId, ctrl.signal, { includePayload: false })
        .then((result) => {
          if (ctrl.signal.aborted) return;
          setTurns((prev) => carryPayloads(result.turns, prev));
          setPrologue(result.prologue);
        })
        .catch(() => { /* silent — 레거시 refreshDetailSession catch 동치 */ });
    }, 400);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [sessionId, liveSignal]);

  // 활성 턴 ID — 명시값 우선, 없으면 최신 턴(turn-views.js:923-925).
  const activeTurnId = useMemo(() => resolveActiveTurnId(turns, explicitTurnId), [turns, explicitTurnId]);

  const activeTurn = useMemo(
    () => turns.find((t) => t.turn_id === activeTurnId) ?? null,
    [turns, activeTurnId],
  );

  // 활성 turn payload on-demand 로드 — 활성 turn 이 payload 를 아직 안 가졌으면 그 turn 의 행 payload 만
  //   배치로 가져와 병합한다. hasPayload 로 가드하므로 (1) 병합 후 재실행 시 skip 되어 루프가 없고,
  //   (2) 라이브 재fetch(payload=0)로 payload 가 비워지면 자동 재로드된다. 빈 응답이면 setTurns 미호출.
  useEffect(() => {
    if (!sessionId || !activeTurnId || !activeTurn) return;
    if (turnHasPayload(activeTurn)) return;
    const ctrl = new AbortController();
    fetchTurnPayloads(sessionId, activeTurnId, ctrl.signal)
      .then((rows) => {
        if (ctrl.signal.aborted || rows.length === 0) return;
        const byId = new Map(rows.map((r) => [r.id, r.payload]));
        setTurns((prev) => mergeTurnPayloads(prev, activeTurnId, byId));
      })
      .catch(() => { /* silent — preview/tool_detail 폴백 유지 */ });
    return () => ctrl.abort();
  }, [sessionId, activeTurnId, activeTurn]);

  // 신규 reminder by turn — computeNewRemindersByTurn(turns) (turn-views.js:929).
  const remindersByTurn = useMemo(
    () => computeNewRemindersByTurn(turns as unknown as ReminderTurn[]),
    [turns],
  );

  const activeReminders = useMemo(
    () => (activeTurn ? (remindersByTurn.get(activeTurn.turn_id) ?? []) : []),
    [activeTurn, remindersByTurn],
  );

  // agent_spike — turn 폴백(allRequests 인덱스는 데이터 배선 범위 밖, turn-views.js:933).
  const agentSpike = useMemo(
    () => (activeTurn ? ((activeTurn as { agent_spike?: unknown }).agent_spike ?? null) : null),
    [activeTurn],
  );

  // spike sparkline 샘플 — agentSpike.samples → tool_calls 토큰 시계열 폴백(turn-views.js:934-940).
  const spikeSamples = useMemo<number[]>(() => {
    if (!activeTurn) return [];
    const fromSpike = (agentSpike as { samples?: unknown } | null)?.samples;
    if (Array.isArray(fromSpike)) return fromSpike as number[];
    const toolCalls = (activeTurn as { tool_calls?: { tokens_input?: number; tokens_output?: number }[] }).tool_calls;
    return (toolCalls ?? [])
      .map((tc) => (tc.tokens_input ?? 0) + (tc.tokens_output ?? 0))
      .filter((v) => v > 0);
  }, [activeTurn, agentSpike]);

  return {
    turns,
    prologue,
    activeTurnId,
    setActiveTurnId: setExplicitTurnId,
    activeTurn,
    activeReminders,
    agentSpike,
    spikeSamples,
    loading,
  };
}
