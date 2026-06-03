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
// 배경(update-badge-i18n 회귀): 위 회귀를 공유 컴포넌트로 묶었으나, 라벨러(t)를 호출처가 주입하는 계약이라
//   BrowseLayout 이 versionT 를 빠뜨려 browse 뱃지가 key-passthrough 폴백(영어 "Up to date")으로 떨어졌다
//   — metadocs 는 실제 번역기를 주입해 한국어("최신")로 떠 같은 로케일인데 두 페이지 라벨이 갈렸다.
//   번역 해석은 본 컴포넌트의 책임(단일 출처)으로 끌어와 useTranslation 으로 스스로 해석한다. 호출처는
//   라벨러를 주입하지 않으며(주입 누락으로 인한 회귀 원천 차단), 언어 변경 시 useTranslation 구독으로 갱신된다.
//
// 본 컴포넌트는 footer(.left-panel-footer + UpdateBadge + version-store 구독 + i18n 해석)를 단일 출처로
//   캡슐화한다. browse·metadocs 두 사이드바가 동일 컴포넌트를 같은 grid 위치(마지막 트랙)에서 렌더 →
//   위치/스타일/로케일 정합 보장. 사이드바가 없는 settings 모드만 AppShell 의 fixed 폴백 뱃지를 쓴다.

import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { UpdateBadge } from './UpdateBadge';
import type { BadgeLabeler } from './UpdateBadge';
import { useVersionStore } from '../../stores/version-store';

/**
 * 좌측 패널 하단 update-badge footer — 레거시 .left-panel-footer 1:1.
 *   version-store(단일 폴러 결과, 버그 #6) 를 구독해 controlled 뱃지를 렌더하고,
 *   available 클릭 시 store.openModal 로 AppShell 의 단일 UpdateModal 을 연다(트리거만 보유).
 *   라벨은 react-i18next(useTranslation)로 스스로 해석 — 호출처 주입 불요(update-badge-i18n 회귀 해소).
 */
export function SidebarVersionFooter(): ReactElement {
  // i18n — react-i18next 단일 경로. 언어 변경 시 useTranslation 구독으로 재렌더 → 라벨 재평가.
  //   UpdateBadge 의 BadgeLabeler((key,vars)=>string) 계약으로 래핑(react-i18next t 는 TFunction).
  const { t: tBase } = useTranslation();
  const t: BadgeLabeler = (key, vars) => tBase(key, vars) as unknown as string;
  const view = useVersionStore((s) => s.view);
  const openModal = useVersionStore((s) => s.openModal);
  return (
    <div className="left-panel-footer">
      <UpdateBadge
        state={view.badge}
        currentVersion={view.currentVersion}
        latestTag={view.latestTag}
        onOpen={openModal}
        t={t}
      />
    </div>
  );
}
