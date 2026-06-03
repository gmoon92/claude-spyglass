/**
 * features/meta-docs/MetaDocsToolStats.tsx — meta-docs tools 탭 도구 통계 패널 (P4-03)
 *
 * 원본: assets/js/meta-docs-view.js applyMetaSubTab(PANELS) + loadProjectToolStats 진입(view.js:309-330,40).
 *  - arch §2.2: P4-03 은 tool-stats 컴포넌트를 *재구현하지 않고* P3-09 ToolStatsMatrix 를 mount/표시만.
 *    셸이 docs/tools 탭 분기로 mount(원본 body.hidden 토글 → React 조건부 렌더). 본 컴포넌트는 위임 어댑터.
 *  - ToolIcon 슬롯 주입(원본 toolIconHtml SSoT) — P3-09 ToolStatsMatrix renderIcon 계약(badges.tsx:50).
 *  - 정렬 상태는 컨트롤드 prop(원본 모듈 전역 폐기) — 호출처(셸)가 nextSort 전이. 미주입 시 P3-09 기본(tokens desc).
 *
 * @module features/meta-docs/MetaDocsToolStats
 */
import type { ReactElement } from 'react';
import { ToolIcon } from '../../components/render/badges';
import {
  ToolStatsMatrix,
  type ToolStatsMatrixProps,
  type TFunc,
} from '../dashboard/ToolStatsMatrix';
import type { ToolStatRow, ToolStatsSortKey, SortDir } from '../dashboard/tool-stats-sort';

export interface MetaDocsToolStatsProps {
  /** 프로젝트 도구별 성능 행(원본 loadProjectToolStats fetch 결과). null = 미로드. */
  stats: ToolStatRow[] | null;
  /** 정렬 상태(컨트롤드). 미지정 → P3-09 기본(tokens desc). */
  sort?: { key: ToolStatsSortKey; dir: SortDir };
  /** 헤더 클릭 → 정렬 전이 통지(호출처가 nextSort 적용). */
  onSort?: (key: ToolStatsSortKey) => void;
  /** i18n t(필수 — DI). 호출처가 react-i18next t 주입, 테스트가 stub 주입. */
  t: TFunc;
  /** fetch 대기 중 여부 — 미로드 시 스켈레톤(빈 상태 오해 방지). */
  loading?: boolean;
}

/** 원본 toolIconHtml 위임 — ToolStatsMatrix renderIcon 슬롯에 ToolIcon(badges) 주입. */
const renderIcon: ToolStatsMatrixProps['renderIcon'] = (toolName) => <ToolIcon toolName={toolName} />;

export function MetaDocsToolStats({ stats, sort, onSort, t, loading }: MetaDocsToolStatsProps): ReactElement {
  return <ToolStatsMatrix stats={stats} sort={sort} onSort={onSort} t={t} renderIcon={renderIcon} loading={loading} />;
}
