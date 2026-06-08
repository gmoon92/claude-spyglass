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
 * mini-bar(behavior 문서별 호출수 랭킹):
 *   - 카드 하단에 선택 프로젝트의 실제 문서 invocations 랭킹(Top N)을 노출(과거 type 고정 합산 폐기).
 *   - 정렬 = invocations desc(카탈로그 DEFAULT_SORT 동치). 막대 폭 = calls / 최대 calls.
 *   - 각 행 선행에 카탈로그와 동일한 서클(눈알) ToolIcon(metaDocIconName) + 문서명.
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
import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { computeRowCounts, isRegistered, type MetaDocRow, type DisplayFilter } from './meta-docs-sort';
import { ToolIcon } from '../../components/render/badges';
import { metaDocIconName } from './MetaDocTypeBadge';

export interface MetaDocsSummaryCardsProps {
  /** 전체 카탈로그 행(type 필터 전 — 원본 probe rows 동치). 카운트/mini-bar 파생 입력. */
  rows: ReadonlyArray<MetaDocRow>;
  /** 카드 클릭 → display 필터 전환 통지(호출처가 셸 상태 반영). */
  onSelectDisplay: (display: DisplayFilter) => void;
}

/** 랭킹 mini-bar 기본 노출 개수 — 카탈로그 스켈레톤(8행, MetaDocsCatalog) 과 정합. */
const DEFAULT_TOP_N = 8;

/** 랭킹 행(문서 1건) — 카탈로그 invocations 정렬(meta-docs-sort DEFAULT_SORT)과 동일 기준. */
interface RankedDoc {
  key: string;
  name: string;
  type: string;
  calls: number;
}

/**
 * behavior 문서별 invocations 랭킹 Top N — 단일 책임(순수).
 *  - 미등록(orphan, id==null) 행은 제외 — 카탈로그에 정의가 없는 호출 잔재(빌트인/외부/삭제된 정의)는
 *    "어떤 behavior 인지" 가 불명확해 랭킹 노이즈다. 등록 판정은 meta-docs-sort.isRegistered SSoT 재사용.
 *  - 호출 0건(unused) · 무명 행도 제외(랭킹은 "실제 사용된 등록 문서"만).
 *  - 정렬: invocations desc, 동률 시 name asc(결정적). 카탈로그 기본 정렬과 동치.
 *  - type 고정 합산을 폐기 — agent/skill/command 구분 없이 실제 호출 순위를 노출한다.
 */
function rankDocsByInvocations(rows: ReadonlyArray<MetaDocRow>, topN: number): RankedDoc[] {
  return rows
    .filter((r) => isRegistered(r) && (r.invocations ?? 0) > 0 && r.name)
    .map((r) => ({
      key: r.id != null ? `id:${r.id}` : `name:${String(r.name)}`,
      name: String(r.name),
      type: String(r.type ?? ''),
      calls: r.invocations ?? 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    .slice(0, topN);
}

/**
 * 좌측 요약 카드 3개(사용/미사용/orphan) — 레거시 #metaDocsSummaryCards(index.html :266) 1:1.
 *   - 3 카드는 컨테이너의 **직계 자식**이어야 한다. meta-docs.css 의 .meta-docs-summary-cards{flex-direction:row}
 *     + .meta-docs-summary-card{flex:1 1 0} 이 가로 균등 분배를 하므로, 중간 wrapper(.meta-docs-summary-cards-row)
 *     를 끼우면 flex 분배가 깨져 카드가 세로로 눌리던 회귀가 발생했다(본 수정의 원인). wrapper 제거.
 *   - behavior mini-bar 는 레거시에서 별도 #metaDocsToolStats 트랙(grid row4)에 위치하므로, 본 컴포넌트가 아닌
 *     MetaDocsBehaviorBars 로 분리됐다(그 둘을 한 flex-row 컨테이너에 같이 두면 카드 옆에 바가 붙어 눌린다).
 */
// memo: rows 불변(검색 입력 등 부모 재렌더) 시 computeRowCounts 재계산·카드 재렌더를 건너뛴다.
export const MetaDocsSummaryCards = memo(function MetaDocsSummaryCards({ rows, onSelectDisplay }: MetaDocsSummaryCardsProps): ReactElement {
  const { t } = useTranslation();
  const counts = computeRowCounts(rows);

  return (
    <div className="meta-docs-summary-cards" id="metaDocsSummaryCards" data-testid="meta-docs-summary-cards">
      <button
        type="button"
        className="meta-docs-summary-card meta-docs-summary-card--used"
        data-meta-filter="display"
        data-value="all"
        data-tip={t('ui:meta-docs-view.card-used-title')}
        onClick={() => onSelectDisplay('all')}
      >
        <span className="meta-docs-summary-card-value">{counts.used}</span>
        <span className="meta-docs-summary-card-label">{t('ui:meta-docs-view.card-used-label')}</span>
      </button>
      <button
        type="button"
        className="meta-docs-summary-card meta-docs-summary-card--unused"
        data-meta-filter="display"
        data-value="unused"
        data-tip={t('ui:meta-docs-view.card-unused-title')}
        onClick={() => onSelectDisplay('unused')}
      >
        <span className="meta-docs-summary-card-value">{counts.unused}</span>
        <span className="meta-docs-summary-card-label">{t('ui:meta-docs-view.card-unused-label')}</span>
      </button>
      <button
        type="button"
        className="meta-docs-summary-card meta-docs-summary-card--orphan"
        data-meta-filter="display"
        data-value="orphan"
        data-tip={t('ui:meta-docs-view.card-orphan-title')}
        onClick={() => onSelectDisplay('orphan')}
      >
        <span className="meta-docs-summary-card-value">{counts.orphan}</span>
        <span className="meta-docs-summary-card-label">orphan</span>
      </button>
    </div>
  );
});

export interface MetaDocsBehaviorBarsProps {
  /** 프로젝트 스코프 카탈로그 행 — invocations 기준 문서별 랭킹 mini-bar 파생 입력(호출처가 projectFiltered 주입). */
  rows: ReadonlyArray<MetaDocRow>;
  /** 랭킹 노출 상한(기본 DEFAULT_TOP_N=8). */
  topN?: number;
}

/**
 * behavior 문서별 호출수 랭킹 mini-bar — 레거시 좌측 #metaDocsToolStats(index.html :274) 트랙.
 *   metadocs grid row4(auto) 의 단독 컨테이너로, 요약 카드(row3)와 분리돼야 가로폭 전체를 써 막대가 보인다.
 *
 *   계약 변경: 과거 agent/skill/command **고정 3행 type 합산**을 폐기하고, 선택 프로젝트의 실제 문서
 *   invocations 랭킹(Top N)으로 전환한다(rankDocsByInvocations SSoT). 각 행은:
 *     - 선행 서클(눈알) 글리프 — 카탈로그 배지와 동일한 ToolIcon(metaDocIconName) 재사용(아이콘 SSoT).
 *     - 문서명(obs-meta-name) — 어떤 behavior 인지 명시.
 *     - 막대(obs-cat-bar) — calls/max 상대 폭. + 호출수(obs-cat-pct).
 *   막대 마크업/클래스(obs-card-meta-docs / obs-cat-bar / ds-bar-fill[data-tone]) 는 obs-panel.css·design-system
 *   bar.css 에 존재하는 SSoT 를 그대로 유지 — 신규 클래스 도입 시 CSS 부재로 평문 세로 나열 회귀가 발생했던 이력.
 *
 *   외곽 컨테이너는 레거시 .meta-docs-tool-stats(#metaDocsToolStats) — meta-docs.css 가 metadocs 모드에서
 *   display:block 으로 노출하고 내부 .obs-panel padding 을 제공. 사용 문서 0건이면 미렌더(grid 트랙만 0px).
 */
export function MetaDocsBehaviorBars({ rows, topN = DEFAULT_TOP_N }: MetaDocsBehaviorBarsProps): ReactElement | null {
  const ranked = rankDocsByInvocations(rows, topN);
  if (ranked.length === 0) return null;
  const maxCalls = Math.max(...ranked.map((b) => b.calls), 1);
  return (
    <div className="meta-docs-tool-stats" id="metaDocsToolStats" data-testid="meta-docs-tool-stats">
      <div className="obs-panel">
        <div className="obs-card-tools obs-card-meta-docs" role="list" aria-label="top behaviors by invocations">
          {ranked.map((b) => {
            const pct = Math.round((b.calls / maxCalls) * 100);
            return (
              <div className="obs-meta-row" role="listitem" key={b.key}>
                <span className="obs-meta-name" data-tip={b.name}>
                  <ToolIcon toolName={metaDocIconName(b.type)} />
                  {b.name}
                </span>
                <div className="obs-cat-bar">
                  <span
                    className="obs-cat-bar-fill obs-cat-bar-fill--agent ds-bar-fill"
                    data-tone="warn"
                    style={{ width: `${pct}%` }}
                    aria-label={`${b.name} ${b.calls}`}
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
