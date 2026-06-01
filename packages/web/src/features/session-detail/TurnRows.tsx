/**
 * features/session-detail/TurnRows.tsx — 활성 턴 로그 행 빌더 (P3-05)
 *
 * 원본: assets/js/session-detail/turn-rows.js#makeTurnLogRows (turn-rows.js:344).
 *
 * 전략(D형 골든마스터 — makeTurnLogRows 출력 동치):
 *  - prompt 행 + (turn.items[] | 폴백 시간순 머지) 본문 행을 RequestRow(P2-04) 로 1:1 위임.
 *  - 각 본문 행에 data-chip-key 주입 — 키는 **turn-rows.js#chipKeyForRequest SSoT 를 import 재사용**.
 *    chipKey/chipFromRequest/chipKeyForRequest 를 재구현하지 않는다(tasks.json P3-05 "chipKey SSoT 재구현 금지").
 *  - prompt 행은 chip-key 없음(원본 turn-rows.js:355 — prompt 에는 spine 칩이 없다).
 *
 * 폴백 머지(legacyInterleave): turn-rows.js:389 의 private 폴백과 동일한 결정론적 시간순 머지.
 *   이는 칩-키 SSoT 가 아니라 행 정렬 보정이므로(서버 items[] 미제공 구버전 전용) 동일 로직을 둔다.
 *
 * @module features/session-detail/TurnRows
 */
import { Fragment, type ReactElement } from 'react';
import { RequestRow } from '../../components/render';
// chipKey SSoT — 원본 turn-rows.js export 를 그대로 재사용(재구현 금지).
import { chipKeyForRequest } from '../../../assets/js/session-detail/turn-rows.js';

interface RowLike {
  id?: string | null;
  type?: string | null;
  // RequestRow(P2-04) 의 RowLike 와 동일하게 string|null — 폴백 머지의 산술 비교는 ts() 캐스트로 처리.
  timestamp?: string | null;
  [k: string]: unknown;
}

interface TurnItemLike {
  kind: 'tool' | 'response';
  request: RowLike;
}

interface TurnLike {
  prompt?: RowLike | null;
  items?: TurnItemLike[] | null;
  tool_calls?: RowLike[] | null;
  responses?: RowLike[] | null;
  [k: string]: unknown;
}

interface TurnRowsProps {
  turn: TurnLike | null | undefined;
  /** Map<requestId, Set<string>> — Spike/loop/slow 뱃지 부여용(원본 opts.anomalyFlags). */
  anomalyFlags?: Map<string, Set<string>> | null;
  /** 활성 턴 좁힘 정책(원본 opts.showSession 기본 false). */
  showSession?: boolean;
}

/**
 * 서버 인터리빙(turn.items)을 제공하지 않는 구버전 응답을 위한 폴백.
 * tool_calls/responses 를 timestamp 기준 머지 → `{kind, request}` 시퀀스.
 * 원본 turn-rows.js#legacyInterleave (private) 와 동일.
 */
function legacyInterleave(toolCalls: RowLike[], responses: RowLike[]): TurnItemLike[] {
  // 원본 turn-rows.js:390-401 의 비교식 `(x.timestamp || 0)` 을 그대로 보존한다.
  //   ISO 문자열 timestamp 는 산술이 NaN 이 되어 정렬은 no-op, `<=` 는 사전식 비교가 되는데
  //   서버 SSoT(items[]) 가 있는 경로에선 이 폴백을 타지 않으므로 구버전 동작을 1:1 미러한다.
  const ts = (x: RowLike) => (x.timestamp || 0) as number | string;
  const tools = toolCalls.slice().sort((a, b) => (ts(a) as number) - (ts(b) as number));
  const resps = responses.slice().sort((a, b) => (ts(a) as number) - (ts(b) as number));
  const out: TurnItemLike[] = [];
  let i = 0;
  for (const r of resps) {
    while (i < tools.length && ts(tools[i]) <= ts(r)) {
      out.push({ kind: 'tool', request: tools[i++] });
    }
    out.push({ kind: 'response', request: r });
  }
  while (i < tools.length) out.push({ kind: 'tool', request: tools[i++] });
  return out;
}

/**
 * 활성 턴의 prompt + 본문 행을 RequestRow 시퀀스로 렌더한다.
 * makeTurnLogRows(turn, {anomalyFlags, showSession}) 의 React 대응물.
 */
export function TurnRows({ turn, anomalyFlags = null, showSession = false }: TurnRowsProps): ReactElement | null {
  if (!turn) return null;

  // 세션 상세 뷰는 9컬럼(showSession=false) 또는 10컬럼(showSession=true).
  // 기본값 FEED_EXPAND_COLS=10 이 9컬럼 테이블에 걸리면 레이아웃이 깨지므로 명시 주입.
  const expandCols = showSession ? 10 : 9;

  const rowOpts = (r: RowLike) => ({
    showSession,
    anomalyFlags: anomalyFlags?.get(String(r.id)) ?? null,
    expandCols,
  });

  const rows: ReactElement[] = [];

  // 1) prompt 행 — chip-key 없음(원본 turn-rows.js:356-359).
  if (turn.prompt) {
    const promptReq: RowLike = { ...turn.prompt, type: 'prompt' };
    rows.push(<RequestRow key="prompt" r={promptReq} opts={rowOpts(promptReq)} />);
  }

  // 2) 본문 행 — 서버 items[] 우선, 미제공 시 시간순 머지 폴백(원본 turn-rows.js:362-378).
  let respSeq = 0;
  const walkItems = turn.items?.length
    ? turn.items
    : legacyInterleave(turn.tool_calls ?? [], turn.responses ?? []);

  walkItems.forEach((it, idx) => {
    if (it.kind === 'response') {
      respSeq += 1;
      const req: RowLike = { ...it.request, type: 'response' };
      const key = chipKeyForRequest(req, respSeq);
      rows.push(<RequestRow key={`body-${idx}`} r={req} opts={{ ...rowOpts(req), chipKey: key }} />);
    } else if (it.kind === 'tool') {
      const req: RowLike = { ...it.request, type: 'tool_call' };
      const key = chipKeyForRequest(req, respSeq);
      rows.push(<RequestRow key={`body-${idx}`} r={req} opts={{ ...rowOpts(req), chipKey: key }} />);
    }
  });

  return <Fragment>{rows}</Fragment>;
}
