/**
 * render/RequestRow.tsx — 요청 행 React 대응물 (P2-04)
 *
 * 원본: assets/js/render/rows.js#makeRequestRow (+ 내부 makeTargetCellWithBadges / buildSearchHaystack).
 *
 * 전략(D형 골든마스터 — makeRequestRow 9종 snapshot 동치):
 *  - 행 컬럼 구성·순서·뷰 변형(showSession)을 JSX 로 1:1 이식.
 *  - 셀은 SSoT 컴포넌트 재사용: ActionBadge(TypeBadge) / Target(targetInner) / ModelCell / CacheCell.
 *  - 라벨/포맷/판정은 원본 SSoT 재사용: fmtToken/formatDuration/fmtTimestamp/escHtml,
 *    trustOf/rowTrustClass(model.js), subTypeOf(request-types.js),
 *    contextPreview(extract.js), anomaly/bloated 배지 producer(badges.js) — 재구현 금지.
 *  - search-haystack 은 원본 private buildSearchHaystack 와 동일하게 exported SSoT(extract*)로 합성.
 *
 * @module render/RequestRow
 */
import { Fragment, memo, useMemo, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  escHtml,
  fmtToken,
  formatDuration,
  fmtTimestamp,
} from '../../lib/formatters';
import { subTypeOf } from '../../../assets/js/request-types.js';
import { trustOf, rowTrustClass } from './model-classify';
import {
  contextPreviewData,
  extractPromptText,
  extractAssistantText,
} from './extract';
import { ContextPreview } from './ContextPreview';
import { ActionBadge, CacheCell, targetInner } from './cells';
import { ModelCell } from './model';
import { AnomalyBadges, SlowBadge } from './badges';
import { BloatedSysBadge } from './anomaly-badges';
import { bloatedSysInfo } from '../../lib/anomaly-field';
import { PromptExpandRow } from './PromptExpandRow';

/** feed 뷰 expand td colspan — 원본 expand.ts#RECENT_REQ_COLS(10: + Session). */
const FEED_EXPAND_COLS = 10;


interface RowLike {
  id?: string | null;
  type?: string | null;
  session_id?: string | null;
  project_name?: string | null;
  model?: string | null;
  // SSoT(RequestRow.timestamp)=number(epoch ms). 과거 ISO string wire 호환도 수용(fmtTs 는 둘 다 처리).
  timestamp?: string | number | null;
  tokens_input?: number;
  tokens_output?: number;
  duration_ms?: number;
  preview?: string | null;
  tool_name?: string | null;
  tool_detail?: string | null;
  bloated_sys?: { stage?: string; status?: string } | null;
  [k: string]: unknown;
}

interface RequestRowOpts {
  showSession?: boolean;
  anomalyFlags?: Set<string> | null;
  fmtTime?: (ts: string | number | null | undefined) => string;
  /**
   * data-chip-key 주입 (P3-05 TurnRows 전용). 빈/미지정이면 속성 미부여 —
   * 원본 turn-rows.js#injectChipKey 와 동일(키 없으면 속성 생략).
   * 원본은 `<tr `의 첫 속성 위치에 삽입하므로 JSX 도 className 보다 앞에 둔다(속성 순서 동치).
   */
  chipKey?: string;
  /**
   * 세션 이동 콜백 (기능 1) — Session 셀(`sess-id-link`) 클릭 시 호출.
   * 원본 feed-interactions.js#wireDefaultViewClicks 의 위임 핸들러를 props 콜백으로 승격.
   *   - 미주입이면 셀은 일반 텍스트처럼 동작(무동작) — 안전(원본 위임 미등록 상태와 동치).
   *   - lead 가 BrowseLayout 에서 주입(setSelectedProject + setSelectedSession + detail 전환).
   * @param sessionId   data-goto-session (r.session_id).
   * @param projectName data-goto-project (r.project_name) — 프로젝트 전환 판단은 호출 측 책임.
   */
  onGotoSession?: (sessionId: string, projectName: string) => void;
  /**
   * 펼침 행 colspan(기능 2) — 미지정이면 feed 뷰 기본 10(원본 RECENT_REQ_COLS).
   * 컬럼 수가 다른 변형(예: showSession=false flat 뷰 9컬럼)에서 상위가 조정 주입.
   */
  expandCols?: number;
}

/**
 * 검색 haystack — 원본 rows.js#buildSearchHaystack 의 합성 로직 1:1.
 * 하위 추출은 exported SSoT(extractPromptText/extractAssistantText) 재사용(재구현 아님).
 * BrowseLayout 피드 검색 필터도 동일 haystack 을 SSoT 로 소비(분기 중복 방지) → export.
 */
export function buildSearchHaystack(r: RowLike): string {
  const parts: string[] = [];
  if (r.tool_name) parts.push(r.tool_name);
  if (r.tool_detail) parts.push(r.tool_detail);
  if (r.model) parts.push(r.model);
  if (r.type) parts.push(r.type);
  const body = r.type === 'response' ? extractAssistantText(r) : extractPromptText(r);
  if (body) parts.push(body);
  if (r.preview && body !== r.preview) parts.push(r.preview);
  return parts.join(' ').toLowerCase().slice(0, 8000);
}

/** Target 셀 + 추가 배지(spike/loop + bloated mini) — 원본 makeTargetCellWithBadges 와 동치. */
function TargetCellWithBadges({ r, extra }: { r: RowLike; extra: ReactNode }): ReactElement {
  const { node, empty } = targetInner(r);
  // 원본: 추가 배지가 있으면 항상 '<td class="cell-target">...badges</td>' (empty 분기는 배지 없을 때만 의미).
  // makeTargetCellWithBadges 는 extraBadges 가 truthy 일 때 base(=makeTargetCell)의 </td> 직전에 삽입.
  // base 가 cell-empty('—') 여도 그대로 치환되므로 동일 분기 보존.
  const cls = empty ? 'cell-target cell-empty' : 'cell-target';
  return (
    <td className={cls} data-cell="target">
      {node}
      {extra}
    </td>
  );
}

/**
 * 단일 요청 행 — 원본 rows.js#makeRequestRow.
 * 전체 피드 + 세션 flat 뷰 공용. 모든 td 에 data-cell 부여.
 * memo: feed 200행이 SSE 이벤트마다 재렌더되는 비용을 props 안정 시 생략.
 */
export const RequestRow = memo(function RequestRow({ r, opts = {} }: { r: RowLike; opts?: RequestRowOpts }): ReactElement {
  const { t } = useTranslation();
  const fmtTs = opts.fmtTime || fmtTimestamp;
  const flags = opts.anomalyFlags || null;
  const rid = r.id ?? '';

  // 기능 2 — 프롬프트/메시지 펼침 상태(행 단위 로컬). 원본 togglePromptExpand 의
  //   container.dataset.expanded 를 React state 로 대체. 같은 preview 재클릭 시 닫힘(토글) 보존.
  const [expanded, setExpanded] = useState(false);

  // msg 셀 클릭 위임 — 원본 resolveExpandTarget(expand.ts) 와 동치:
  //   클릭 타깃이 [data-expand-id] 를 (자신 또는 조상으로) 가지면 토글.
  //   ContextPreview(React JSX) 가 .prompt-preview[data-expand-id] 를 렌더하므로 onClick 을 직접
  //   달 수도 있으나, 위임 한 곳으로 통일(원본 closest 위임)해 회귀를 줄인다.
  const onMsgCellClick = (e: MouseEvent<HTMLTableCellElement>): void => {
    if (!rid) return;
    const el = (e.target as HTMLElement).closest('[data-expand-id]');
    if (!el) return;
    setExpanded((v) => !v);
  };

  // 기능 1 — Session 셀 클릭 → onGotoSession. 미주입이면 핸들러 자체를 달지 않아 무동작(안전).
  const gotoSession = opts.onGotoSession;
  const onSessClick = gotoSession
    ? (e: MouseEvent<HTMLSpanElement>): void => {
        e.stopPropagation();
        gotoSession(r.session_id || '', r.project_name || '');
      }
    : undefined;

  // 미리보기 데이터 한 번 계산(SSoT + _promptCache write 1회). null 이면 빈 셀(cell-msg-empty).
  //   원본 makeRequestRow 는 prompt-preview span 을 td 에 래퍼 없이 직접 삽입했다 — ContextPreview 도
  //   래퍼 없이 .prompt-preview 를 직접 렌더(이중 span 회귀 방지).
  const previewData = contextPreviewData(r);

  const spikeLoopFlags = flags ? new Set([...flags].filter((f) => f !== 'slow')) : null;
  const hasSlow = !!(flags && flags.has('slow'));

  // bloated mini 노출 여부 SSoT — anomaly-field 판정(warn/critical 이면 info 객체).
  const bloatedInfo = bloatedSysInfo(r.bloated_sys);
  let bloatedRowCls = '';
  if (bloatedInfo?.stage === 'warn') bloatedRowCls = ' row-bloated-warn';
  else if (bloatedInfo?.stage === 'critical') bloatedRowCls = ' row-bloated-critical';

  const trustCls = rowTrustClass(r);
  // r 객체 참조가 바뀌어도 실제 검색 관련 필드가 변하지 않으면 재연산 생략.
  const haystack = useMemo(
    () => buildSearchHaystack(r),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r.id, r.type, r.model, r.tool_name, r.tool_detail, r.preview],
  );
  const rowCls = (trustCls + bloatedRowCls).trim();

  // 원본은 spikeLoopBadges(HTML) + bloatedMini(HTML) 를 Target 셀 </td> 직전에 합류.
  const targetExtra: ReactNode = (
    <>
      <AnomalyBadges flags={spikeLoopFlags} />
      <BloatedSysBadge bloatedSys={r.bloated_sys} variant="mini" />
    </>
  );
  const hasExtra = (spikeLoopFlags && spikeLoopFlags.size > 0) || !!bloatedInfo;

  // data-chip-key 는 원본 injectChipKey 와 동일하게 `<tr ` 첫 속성 위치(className 앞)에 둔다.
  // 빈 문자열/미지정이면 undefined → React 가 속성을 출력하지 않음(원본 "키 없으면 속성 생략"과 동치).
  const chipKeyAttr = opts.chipKey ? opts.chipKey : undefined;

  return (
    <Fragment>
    <tr
      data-chip-key={chipKeyAttr}
      className={rowCls}
      data-type={r.type ?? ''}
      data-sub-type={subTypeOf(r)}
      data-trust={trustOf(r)}
      data-request-id={r.id ?? ''}
      data-search-haystack={haystack}
    >
      <td className="cell-time num" data-cell="time">
        {fmtTs(r.timestamp)}
      </td>
      <td className="cell-action" data-cell="action">
        <ActionBadge type={r.type} />
      </td>
      {hasExtra ? (
        <TargetCellWithBadges r={r} extra={targetExtra} />
      ) : (
        <TargetCellWithBadges r={r} extra={null} />
      )}
      <ModelCell r={r} />
      {previewData ? (
        <td className="cell-msg" data-cell="msg" onClick={onMsgCellClick}>
          <ContextPreview data={previewData} />
        </td>
      ) : (
        <td className="cell-msg" data-cell="msg">
          <span className="cell-msg-empty" aria-label={t('session.rows.empty-message')} />
        </td>
      )}
      <td className="cell-token num" data-cell="in">
        {(r.tokens_input ?? 0) > 0 ? fmtToken(r.tokens_input) : '—'}
      </td>
      <td className="cell-token num" data-cell="out">
        {(r.tokens_output ?? 0) > 0 ? fmtToken(r.tokens_output) : '—'}
      </td>
      <CacheCell r={r} />
      <td className="cell-token num" data-cell="duration">
        {formatDuration(r.duration_ms)}
        {hasSlow ? <SlowBadge /> : null}
      </td>
      {opts.showSession ? (
        <td className="cell-sess" data-cell="sess">
          <span
            className="sess-id sess-id-link"
            data-goto-session={r.session_id || ''}
            data-goto-project={r.project_name || ''}
            title={r.session_id || ''}
            onClick={onSessClick}
          >
            {r.session_id ? r.session_id.slice(0, 12) + '…' : '—'}
          </span>
        </td>
      ) : null}
    </tr>
    {expanded && rid ? <PromptExpandRow rid={rid} cols={opts.expandCols ?? FEED_EXPAND_COLS} /> : null}
    </Fragment>
  );
});

// escHtml 은 SSoT 재사용 명시(원본 행 속성 이스케이프와 동일 의미; React 자동 이스케이프로 동치).
export { escHtml };
