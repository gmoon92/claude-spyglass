/**
 * features/meta-docs/MetaDocsSummaryCards.tsx — 좌측 축약 패널 요약 카드 + behavior mini-bar (vanilla→React 배선)
 *
 * 원본: assets/js/meta-docs-view.js renderLeftSummaryCards(:399) + computeRowCounts(:430).
 *   - 카드 3개(사용/미사용/orphan) — 각 카드 클릭 시 display 필터 전환(data-meta-filter="display").
 *     · used   → display='all'   (전체 보기 — 원본 카드 data-value="all")
 *     · unused → display='unused'
 *     · orphan → display='orphan'
 *   - 카운트는 meta-docs-sort.computeRowCounts(SSoT) 재사용 — 호출처(셸)가 전체 카탈로그 rows 주입.
 *     (원본도 동일 computeRowCounts SSoT 를 좌측·인라인이 공유 — DRY.)
 *
 * mini-bar(behavior별 호출수):
 *   - 원본 좌측은 카드만 있으나, 화면 확인상 카드 하단에 type(agent/skill/command)별 호출수 mini-bar 노출.
 *   - 호출수 = Σ invocations(type 그룹). 막대 폭 = 그룹 합 / 최대 그룹 합.
 *   - 마크업 SSoT 는 obs-panel.js#renderToolCategoriesCard 모드 B(Behavior Definitions Top N) 1:1:
 *       .obs-card-tools.obs-card-meta-docs > .obs-meta-row[.obs-meta-name + .obs-cat-bar(.obs-cat-bar-fill
 *       .obs-cat-bar-fill--agent .ds-bar-fill[data-tone=warn]) + .obs-cat-pct].
 *     이 클래스들은 obs-panel.css(.obs-meta-row grid / .obs-cat-bar* / .obs-cat-pct)와 design-system
 *     bar.css(.ds-bar-fill[data-tone])에 모두 존재 — 신규 클래스(meta-docs-summary-bars 등)는 CSS 부재로
 *     평문 세로 나열되던 회귀를 유발했음(본 수정의 원인). 막대 fill 의 색/그라데이션은 ds-bar-fill[data-tone]
 *     토큰(SSoT)이 결정하므로 hex 직접 지정 없음(캡슐화 원칙 충족).
 *
 * 셀렉터 계약 보존: meta-docs-summary-cards / meta-docs-summary-card(--used/--unused/--orphan) /
 *   meta-docs-summary-card-value / meta-docs-summary-card-label / data-meta-filter / data-value.
 *
 * @module features/meta-docs/MetaDocsSummaryCards
 */
import type { ReactElement } from 'react';
import { computeRowCounts, type MetaDocRow, type DisplayFilter } from './meta-docs-sort';

export type TFunc = (key: string, vars?: Record<string, unknown>) => string;

export interface MetaDocsSummaryCardsProps {
  /** 전체 카탈로그 행(type 필터 전 — 원본 probe rows 동치). 카운트/mini-bar 파생 입력. */
  rows: ReadonlyArray<MetaDocRow>;
  /** 카드 클릭 → display 필터 전환 통지(호출처가 셸 상태 반영). */
  onSelectDisplay: (display: DisplayFilter) => void;
  /** i18n t(필수 — DI). 호출처가 react-i18next t 주입, 테스트가 stub 주입. */
  t: TFunc;
}

const TYPE_ORDER: ReadonlyArray<string> = ['agent', 'skill', 'command'];

/** type 그룹별 invocations 합 — 단일 책임(순수). 미지정 type 은 제외(좌측 mini-bar 는 known type 만). */
function groupInvocationsByType(rows: ReadonlyArray<MetaDocRow>): Array<{ type: string; calls: number }> {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const type = String(r.type ?? '');
    if (!TYPE_ORDER.includes(type)) continue;
    sums.set(type, (sums.get(type) ?? 0) + (r.invocations ?? 0));
  }
  return TYPE_ORDER.filter((type) => sums.has(type)).map((type) => ({ type, calls: sums.get(type) ?? 0 }));
}

/**
 * 좌측 요약 카드 3개(사용/미사용/orphan) — 레거시 #metaDocsSummaryCards(index.html :266) 1:1.
 *   - 3 카드는 컨테이너의 **직계 자식**이어야 한다. meta-docs.css 의 .meta-docs-summary-cards{flex-direction:row}
 *     + .meta-docs-summary-card{flex:1 1 0} 이 가로 균등 분배를 하므로, 중간 wrapper(.meta-docs-summary-cards-row)
 *     를 끼우면 flex 분배가 깨져 카드가 세로로 눌리던 회귀가 발생했다(본 수정의 원인). wrapper 제거.
 *   - behavior mini-bar 는 레거시에서 별도 #metaDocsToolStats 트랙(grid row4)에 위치하므로, 본 컴포넌트가 아닌
 *     MetaDocsBehaviorBars 로 분리됐다(그 둘을 한 flex-row 컨테이너에 같이 두면 카드 옆에 바가 붙어 눌린다).
 */
export function MetaDocsSummaryCards({ rows, onSelectDisplay, t }: MetaDocsSummaryCardsProps): ReactElement {
  const counts = computeRowCounts(rows);

  return (
    <div className="meta-docs-summary-cards" id="metaDocsSummaryCards" data-testid="meta-docs-summary-cards">
      <button
        type="button"
        className="meta-docs-summary-card meta-docs-summary-card--used"
        data-meta-filter="display"
        data-value="all"
        title={t('ui.meta-docs-view.card-used-title')}
        onClick={() => onSelectDisplay('all')}
      >
        <span className="meta-docs-summary-card-value">{counts.used}</span>
        <span className="meta-docs-summary-card-label">{t('ui.meta-docs-view.card-used-label')}</span>
      </button>
      <button
        type="button"
        className="meta-docs-summary-card meta-docs-summary-card--unused"
        data-meta-filter="display"
        data-value="unused"
        title={t('ui.meta-docs-view.card-unused-title')}
        onClick={() => onSelectDisplay('unused')}
      >
        <span className="meta-docs-summary-card-value">{counts.unused}</span>
        <span className="meta-docs-summary-card-label">{t('ui.meta-docs-view.card-unused-label')}</span>
      </button>
      <button
        type="button"
        className="meta-docs-summary-card meta-docs-summary-card--orphan"
        data-meta-filter="display"
        data-value="orphan"
        title={t('ui.meta-docs-view.card-orphan-title')}
        onClick={() => onSelectDisplay('orphan')}
      >
        <span className="meta-docs-summary-card-value">{counts.orphan}</span>
        <span className="meta-docs-summary-card-label">orphan</span>
      </button>
    </div>
  );
}

export interface MetaDocsBehaviorBarsProps {
  /** 전체 카탈로그 행 — type별 invocations 합 mini-bar 파생 입력. */
  rows: ReadonlyArray<MetaDocRow>;
}

/**
 * behavior별(agent/skill/command) 호출수 mini-bar — 레거시 좌측 #metaDocsToolStats(index.html :274) 트랙.
 *   metadocs grid row4(auto) 의 단독 컨테이너로, 요약 카드(row3)와 분리돼야 가로폭 전체를 써 막대가 보인다.
 *   마크업 SSoT 는 obs-panel.js#renderToolCategoriesCard 모드 B 1:1 — .obs-card-tools.obs-card-meta-docs >
 *   .obs-meta-row[.obs-meta-name + .obs-cat-bar(.obs-cat-bar-fill--agent ds-bar-fill[data-tone=warn]) + .obs-cat-pct].
 *   외곽 컨테이너는 레거시 .meta-docs-tool-stats(#metaDocsToolStats) — meta-docs.css 가 metadocs 모드에서
 *   display:block 으로 노출하고 내부 .obs-panel padding 을 제공. rows 가 비면 미렌더(grid 트랙만 0px).
 */
export function MetaDocsBehaviorBars({ rows }: MetaDocsBehaviorBarsProps): ReactElement | null {
  const bars = groupInvocationsByType(rows);
  if (bars.length === 0) return null;
  const maxCalls = Math.max(...bars.map((b) => b.calls), 1);
  return (
    <div className="meta-docs-tool-stats" id="metaDocsToolStats" data-testid="meta-docs-tool-stats">
      <div className="obs-panel">
        <div className="obs-card-tools obs-card-meta-docs" role="list" aria-label="behavior calls by type">
          {bars.map((b) => {
            const pct = Math.round((b.calls / maxCalls) * 100);
            return (
              <div className="obs-meta-row" role="listitem" key={b.type}>
                <span className="obs-meta-name" title={b.type}>
                  {b.type}
                </span>
                <div className="obs-cat-bar">
                  <span
                    className="obs-cat-bar-fill obs-cat-bar-fill--agent ds-bar-fill"
                    data-tone="warn"
                    style={{ width: `${pct}%` }}
                    aria-label={`${b.type} ${b.calls}`}
                  />
                </div>
                <span className="obs-cat-pct">{b.calls}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
