/**
 * update-badge-i18n.test.tsx — 업데이트 뱃지 로케일 정합 회귀 가드
 *
 * 배경(update-badge-i18n 회귀): browse·metadocs 가 같은 SidebarVersionFooter 를 쓰는데도 같은 로케일에서
 *   라벨이 갈렸다 — browse 는 영어("v · Up to date"), metadocs 는 한국어("v · 최신").
 *   원인은 footer 가 라벨러(t)를 "호출처 주입"에 의존했고, BrowseLayout 이 그 주입을 빠뜨려 browse 는
 *   key-passthrough 폴백(=tSafe 영문 fallback)으로 떨어진 반면 metadocs 는 실제 번역기를 넘겼기 때문.
 *
 * 수정: SidebarVersionFooter 가 useTranslation 으로 라벨을 스스로 해석(호출처 주입 제거). 따라서 두 모드는
 *   동일 i18next 경로를 타 같은 로케일에서 반드시 같은 라벨을 낸다.
 *
 * 전략: 클라이언트 렌더(createRoot + act)로 라이브 DOM 에 마운트한다(zustand SSR getServerSnapshot 은 초기
 *   스냅샷을 읽어 store 주입이 반영되지 않으므로 라이브 렌더가 필요 — meta-docs-layout-scope.test 선례).
 *   vitest.setup.ts 가 i18next.t/getFixedT 를 테스트 t(__setTestT)로 위임하므로, 버전 키를 한국어로
 *   돌려주는 테스트 t 를 주입하면 useTranslation 경로도 한국어로 해석된다. version-store 를 latest 로 고정한 뒤
 *   두 모드를 렌더해 (1) 한국어 라벨 (2) 두 모드 byte-identical 을 단정한다. 회귀(browse 가 주입 누락으로
 *   key-passthrough 로 떨어짐)가 재발하면 browse 는 영문 fallback 이 되어 (1)/(2) 가 깨진다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useVersionStore } from '../../stores/version-store';
import { useAppStore } from '../../stores/app-store';
import { BrowseSidebar } from '../../features/browse/BrowseSidebar';
import { MetaDocsLayout } from '../MetaDocsLayout';
import { ensureDom } from '../../test-support/ensure-dom';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 버전 키만 한국어로 돌려주는 테스트 t — vitest.setup.ts 의 i18next 위임이 __setTestT 로 조회한다.
const KO: Record<string, string> = {
  'ui.version-check.latest': '__KO_최신__',
  'ui.version-check.available': '__KO_업데이트__',
  'ui.version-check.loading': '__KO_확인중__',
};

const realFetch = globalThis.fetch;

const labeler = {
  noData: () => 'no-data',
  liveCount: (n: number) => `live:${n}`,
  selectProject: () => 'select-project',
  sessionCount: (project: string, count: number) => `count:${project}:${count}`,
  globalRowLabel: () => 'user (global)',
  globalRowTitle: () => 'global-title',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // 버전 키를 한국어로 해석하는 테스트 t 주입(afterEach 자동 복원 대응으로 매 테스트 재주입).
  globalThis.__setTestT?.((key) => KO[key] ?? key);
  // metadocs 마운트 fetch(meta-docs/dashboard)는 빈 봉투로 — 라벨만 검증하므로 데이터 불요.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  useAppStore.setState({ selectedProject: null, metaSubTab: 'docs' });
  // 단일 폴러(AppShell) 없는 단위 렌더 — version-store 를 latest 로 직접 고정.
  useVersionStore.setState({
    view: { badge: 'latest', currentVersion: '4.2.2', latestTag: '4.2.2' },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = realFetch;
});

/** 라이브 DOM 에서 .update-badge-text 본문 추출. */
function badgeText(): string | null {
  return container.querySelector('.update-badge-text')?.textContent ?? null;
}

function mountBrowse(): void {
  act(() => {
    root.render(
      <BrowseSidebar
        projects={[]}
        sessions={[]}
        selectedProject={null}
        selectedSession={null}
        labeler={labeler}
        obsIntervalMs={0}
      />,
    );
  });
}

function mountMetaDocs(): void {
  act(() => {
    root.render(<MetaDocsLayout />);
  });
}

describe('update-badge 로케일 정합 — browse·metadocs 동일 라벨', () => {
  it('한국어 로케일에서 browse 뱃지가 한국어 라벨로 해석된다(영문 fallback 아님)', () => {
    mountBrowse();
    const text = badgeText();
    expect(text).toContain('__KO_최신__');
    expect(text).not.toContain('Up to date');
  });

  it('한국어 로케일에서 metadocs 뱃지가 한국어 라벨로 해석된다', () => {
    mountMetaDocs();
    expect(badgeText()).toContain('__KO_최신__');
  });

  it('두 모드의 뱃지 라벨이 byte-identical(공유 i18n 경로 — 호출처 주입 비의존)', () => {
    mountBrowse();
    const a = badgeText();
    act(() => root.unmount());
    root = createRoot(container);
    mountMetaDocs();
    const b = badgeText();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });
});
