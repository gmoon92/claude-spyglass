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
import type { ReactElement, ReactNode } from 'react';
import {
  escHtml,
  fmtToken,
  formatDuration,
  fmtTimestamp,
} from '../../../assets/js/formatters.js';
import { subTypeOf } from '../../../assets/js/request-types.js';
import { trustOf, rowTrustClass } from '../../../assets/js/render/model.js';
import {
  contextPreview,
  extractPromptText,
  extractAssistantText,
} from '../../../assets/js/render/extract.js';
import { bloatedSysBadgeMiniHtml } from '../../../assets/js/render/badges.js';
import { ActionBadge, CacheCell, targetInner } from './cells';
import { ModelCell } from './model';
import { AnomalyBadges, SlowBadge } from './badges';

declare const window: { I18n: { t: (key: string, vars?: Record<string, unknown>) => string } };

interface RowLike {
  id?: string | null;
  type?: string | null;
  session_id?: string | null;
  project_name?: string | null;
  model?: string | null;
  timestamp?: string | null;
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
  fmtTime?: (ts: string | null | undefined) => string;
}

/**
 * 검색 haystack — 원본 rows.js#buildSearchHaystack 의 합성 로직 1:1.
 * 하위 추출은 exported SSoT(extractPromptText/extractAssistantText) 재사용(재구현 아님).
 */
function buildSearchHaystack(r: RowLike): string {
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
 */
export function RequestRow({ r, opts = {} }: { r: RowLike; opts?: RequestRowOpts }): ReactElement {
  const fmtTs = opts.fmtTime || fmtTimestamp;
  const flags = opts.anomalyFlags || null;

  const msgPreviewHtml = contextPreview(r);
  const msgNode: ReactNode = msgPreviewHtml ? (
    <span dangerouslySetInnerHTML={{ __html: msgPreviewHtml }} />
  ) : (
    <span className="cell-msg-empty" aria-label={window.I18n.t('session.rows.empty-message')} />
  );

  const spikeLoopFlags = flags ? new Set([...flags].filter((f) => f !== 'slow')) : null;
  const hasSlow = !!(flags && flags.has('slow'));

  const bloatedMiniHtml = bloatedSysBadgeMiniHtml(r.bloated_sys);

  let bloatedRowCls = '';
  const bsStage = r.bloated_sys?.stage ?? r.bloated_sys?.status;
  if (bsStage === 'warn') bloatedRowCls = ' row-bloated-warn';
  else if (bsStage === 'critical') bloatedRowCls = ' row-bloated-critical';

  const trustCls = rowTrustClass(r);
  const haystack = buildSearchHaystack(r);
  const rowCls = (trustCls + bloatedRowCls).trim();

  // 원본은 spikeLoopBadges(HTML) + bloatedMini(HTML) 를 Target 셀 </td> 직전에 합류.
  const targetExtra: ReactNode = (
    <>
      <AnomalyBadges flags={spikeLoopFlags} />
      {bloatedMiniHtml ? <span dangerouslySetInnerHTML={{ __html: bloatedMiniHtml }} /> : null}
    </>
  );
  const hasExtra = (spikeLoopFlags && spikeLoopFlags.size > 0) || !!bloatedMiniHtml;

  return (
    <tr
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
      <td className="cell-msg" data-cell="msg">
        {msgNode}
      </td>
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
          >
            {r.session_id ? r.session_id.slice(0, 12) + '…' : '—'}
          </span>
        </td>
      ) : null}
    </tr>
  );
}

// escHtml 은 SSoT 재사용 명시(원본 행 속성 이스케이프와 동일 의미; React 자동 이스케이프로 동치).
export { escHtml };
