// features/dashboard/SidebarVersionFooter.tsx — 좌측 패널 footer 업데이트 뱃지 단일 출처
//
// 배경(update-badge-position 회귀): 업데이트 뱃지가 모드별로 다른 위치/스타일로 노출됐다.
//   - browse  : BrowseSidebar 가 .left-panel-footer 안에 UpdateBadge 를 렌더 → 사이드바 하단 in-flow
//               (border-top, 사이드바 전체폭, grid row6).
//   - metadocs : MetaDocsLayout 의 aside.left-panel 이 footer 를 렌더하지 않아, AppShell 의
//               .app-shell-update-badge(position:fixed, 좌하단, 컴팩트) 폴백이 대신 노출 → 위치/모양 불일치.
//   metadocs left-panel grid(meta-docs.css)는 6번째 트랙을 .left-panel-footer 용으로 이미 예약해뒀으나
//   React 컴포넌트가 그 자식을 렌더하지 않은 것이 원인이었다.
//
// 본 컴포넌트는 그 footer(.left-panel-footer + UpdateBadge + version-store 구독)를 단일 출처로 캡슐화한다.
//   browse·metadocs 두 사이드바가 동일 컴포넌트를 같은 grid 위치(마지막 트랙)에서 렌더 → 위치/스타일 정합 보장.
//   사이드바가 없는 settings 모드만 AppShell 의 fixed 폴백 뱃지를 쓴다.
//
// 캡슐화 원칙(CLAUDE 지침): 호출처는 version-store 를 다시 읽거나 footer 마크업을 직접 작성하지 않는다.
//   버전 SSoT 구독 + footer 골격 + UpdateBadge 결선(트리거→AppShell 모달)을 전부 본 컴포넌트가 책임진다.

import { type ReactElement } from 'react';
import { UpdateBadge } from './UpdateBadge';
import type { BadgeLabeler } from './UpdateBadge';
import { useVersionStore } from '../../stores/version-store';

export interface SidebarVersionFooterProps {
  /** UpdateBadge i18n 라벨러 — 미지정 시 key passthrough(레거시 영문 폴백 동치). */
  t?: BadgeLabeler;
}

const DEFAULT_T: BadgeLabeler = (key) => key;

/**
 * 좌측 패널 하단 update-badge footer — 레거시 .left-panel-footer 1:1.
 *   version-store(단일 폴러 결과, 버그 #6) 를 구독해 controlled 뱃지를 렌더하고,
 *   available 클릭 시 store.openModal 로 AppShell 의 단일 UpdateModal 을 연다(트리거만 보유).
 */
export function SidebarVersionFooter({ t }: SidebarVersionFooterProps): ReactElement {
  const view = useVersionStore((s) => s.view);
  const openModal = useVersionStore((s) => s.openModal);
  return (
    <div className="left-panel-footer">
      <UpdateBadge
        state={view.badge}
        currentVersion={view.currentVersion}
        latestTag={view.latestTag}
        onOpen={openModal}
        t={t ?? DEFAULT_T}
      />
    </div>
  );
}
