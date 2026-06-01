/**
 * features/session-detail/SessionLog.tsx — 통합 "로그" 뷰 컨테이너 (P3-05)
 *
 * 원본: assets/js/session-detail/flat-view.js(필터 결과 소비) +
 *       turn-views.js:1001-1023(log-pane <table>/<colgroup>/<thead> 골격).
 *
 * 소유 범위(P3-04 §2.1):
 *  - 필터 파생값: filter-result.ts#computeDetailFilterResult (집계 → selector, 재구현 금지).
 *  - LogPane: 9컬럼 <table> 골격 + tbody = TurnRows(활성 턴).
 * 비소유(슬롯/위임):
 *  - FlowPane(turn-spine/flow-head/chip) → P3-06.  flowPane prop 으로 주입받는다.
 *  - 차트/캐시 패널 갱신(chart-mode-detail) → P3-01 Chart.tsx.
 *  - DETAIL_FILTER_CHANGED CustomEvent → 레거시 flat-view.js 병존(이식 대상 아님).
 *
 * ★col-resize 회귀 가드(P3-04 §4.2, 최대 위험)★:
 *  - <colgroup>/<thead> 는 **안정 노드**로 유지 — tbody(TurnRows)만 props 로 갱신.
 *  - <col> 너비는 모듈 상수(LOG_TABLE_COLS) 로 **초기값만** JSX 에 둔다. col-resize 가
 *    드래그로 변경한 너비를 매 렌더에서 인라인 style 로 덮어쓰지 않도록, 너비 소유권은
 *    DOM(col-resize ref) 이 갖고 JSX 는 재조정 시 col 을 건드리지 않는다(원본 멱등 주입과 동일 시맨틱).
 *  - col-resize 부착은 useRef(table)+useEffect(mount 1회) — 원본 "골격 1회 부착"(turn-views.js:1023).
 *
 * @module features/session-detail/SessionLog
 */
import { useEffect, useRef, type ReactNode, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { initColResize } from '../../../assets/js/col-resize.js';
import { TurnRows } from './TurnRows';

interface RowLike {
  id?: string | null;
  [k: string]: unknown;
}
interface TurnLike {
  prompt?: RowLike | null;
  items?: { kind: 'tool' | 'response'; request: RowLike }[] | null;
  tool_calls?: RowLike[] | null;
  responses?: RowLike[] | null;
  [k: string]: unknown;
}

/**
 * 9컬럼 col 너비 SSoT — 원본 turn-views.js:1004-1009 와 byte 동치.
 * 빈 width 는 가변 컬럼(Message). col-resize 가 드래그 후 이 값을 덮어쓴다.
 */
export const LOG_TABLE_COLS: ReadonlyArray<string | null> = [
  '100px', // Time
  '88px', // Action
  '120px', // Target
  '130px', // Model
  null, // Message (가변)
  '48px', // in
  '48px', // out
  '52px', // Cache
  '68px', // Duration
];

interface SessionLogProps {
  /** 활성 턴(LogPane tbody 에 행으로 렌더). 없으면 빈 tbody. */
  activeTurn?: TurnLike | null;
  /** 턴 단위 anomaly flags(filter-result.ts turnAnomalyMap 의 활성 턴 분). */
  anomalyFlags?: Map<string, Set<string>> | null;
  showSession?: boolean;
  /** FlowPane(turn-spine/flow-head) 슬롯 — P3-06 이 채운다. 미지정이면 미렌더. */
  flowPane?: ReactNode;
}

/**
 * 통합 로그 뷰. flow-pane(슬롯) + log-pane(9컬럼 표).
 * 표 골격은 안정 노드(col-resize 보존), tbody 만 TurnRows 로 갱신.
 */
export function SessionLog({
  activeTurn = null,
  anomalyFlags = null,
  showSession = false,
  flowPane,
}: SessionLogProps): ReactElement {
  const { t } = useTranslation();
  const tableRef = useRef<HTMLTableElement | null>(null);

  // col-resize 핸들 부착 — mount 1회(원본 turn-views.js:1023 "골격 1회 부착").
  useEffect(() => {
    if (tableRef.current) initColResize(tableRef.current);
  }, []);

  return (
    <>
      {flowPane}
      <section
        className="log-pane"
        aria-label={t('session.session-detail.turn-views.active-turn-log-aria')}
        data-region="log"
      >
        <div className="log-table-wrap">
          <table className="requests-table" id="turnLogTable" ref={tableRef}>
            {/* 안정 노드 — 재조정 시 React 가 col 너비를 건드리지 않도록 key 없이 1회 구성. */}
            <colgroup>
              {LOG_TABLE_COLS.map((w, i) =>
                w ? <col key={i} style={{ width: w }} /> : <col key={i} />,
              )}
            </colgroup>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Target</th>
                <th>Model</th>
                <th>Message</th>
                <th style={{ textAlign: 'right' }}>in</th>
                <th style={{ textAlign: 'right' }}>out</th>
                <th style={{ textAlign: 'right' }}>Cache</th>
                <th style={{ textAlign: 'right' }}>Duration</th>
              </tr>
            </thead>
            <tbody id="turnLogBody">
              <TurnRows turn={activeTurn} anomalyFlags={anomalyFlags} showSession={showSession} />
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
