/**
 * update-badge-position.test.tsx — 업데이트 뱃지 위치 정합 회귀 가드
 *
 * 배경(update-badge-position 회귀): 업데이트 뱃지가 모드별로 다른 위치/스타일로 노출됐다.
 *   - browse  : BrowseSidebar 의 .left-panel-footer(사이드바 하단 in-flow).
 *   - metadocs : MetaDocsLayout 의 aside.left-panel 이 footer 를 렌더하지 않아 AppShell 의
 *               .app-shell-update-badge(position:fixed, 좌하단) 폴백이 대신 노출 → 위치 불일치.
 *
 * 본 테스트는 browse·metadocs 두 사이드바가 "동일하게" 사이드바 footer(.left-panel-footer) 안에
 *   update-badge 를 렌더함을 SSR 마크업으로 못박는다. metadocs 가 다시 footer 를 빠뜨려
 *   fixed 폴백으로 회귀하면 이 테스트가 깨진다.
 *
 * 전략(app-shell.test / browse-sidebar.test 선례): renderToStaticMarkup — useEffect 미발화로
 *   fetch/폴링/리사이저 부착 0. version-store 기본값(view.badge='loading') → update-badge--loading.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BrowseSidebar } from '../../features/browse/BrowseSidebar';
import { MetaDocsLayout } from '../MetaDocsLayout';

// SessionRow/fmtRelative / tt 가 window.I18n 를 참조 → 테스트 스텁(선례 동일).
beforeAll(() => {
  const g = globalThis as unknown as { window?: { I18n?: unknown } };
  g.window = g.window ?? ({} as never);
  (g.window as { I18n: unknown }).I18n = {
    t: (key: string) => key,
    getLang: () => 'en',
    getCollator: () => new Intl.Collator('en'),
    onChange: () => {},
    init: () => Promise.resolve(),
  };
});
afterAll(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const labeler = {
  noData: () => 'no-data',
  liveCount: (n: number) => `live:${n}`,
  selectProject: () => 'select-project',
  sessionCount: (project: string, count: number) => `count:${project}:${count}`,
  globalRowLabel: () => 'user (global)',
  globalRowTitle: () => 'global-title',
};

function renderBrowse(): string {
  return renderToStaticMarkup(
    <BrowseSidebar
      projects={[{ project_name: 'alpha', total_tokens: 1000, active_count: 2 }]}
      sessions={[]}
      selectedProject={null}
      selectedSession={null}
      labeler={labeler}
      obsIntervalMs={0}
    />,
  );
}

function renderMetaDocs(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/meta-docs']}>
      <MetaDocsLayout />
    </MemoryRouter>,
  );
}

describe('update-badge 위치 정합 — browse·metadocs 공통 사이드바 footer', () => {
  it('browse 사이드바는 .left-panel-footer 안에 update-badge 를 렌더한다', () => {
    const html = renderBrowse();
    expect(html).toContain('class="left-panel-footer"');
    expect(html).toContain('update-badge');
  });

  it('metadocs 사이드바도 .left-panel-footer 안에 update-badge 를 렌더한다(회귀 가드)', () => {
    const html = renderMetaDocs();
    expect(html).toContain('class="left-panel-footer"');
    expect(html).toContain('update-badge');
  });

  it('metadocs footer 는 좌측 패널(aside.left-panel) 내부에 위치한다(fixed 폴백 아님)', () => {
    const html = renderMetaDocs();
    const asideIdx = html.indexOf('data-testid="meta-docs-sidebar"');
    const footerIdx = html.indexOf('class="left-panel-footer"');
    const rootIdx = html.indexOf('data-testid="meta-docs-root"');
    // footer 가 사이드바 시작 이후 & metaDocsRoot(우측 콘텐츠) 시작 이전 → aside 내부 자식.
    expect(asideIdx).toBeGreaterThanOrEqual(0);
    expect(footerIdx).toBeGreaterThan(asideIdx);
    expect(footerIdx).toBeLessThan(rootIdx);
  });

  it('두 모드 모두 동일한 update-badge 마크업(상태 클래스 동형)을 낸다', () => {
    const browse = renderBrowse();
    const meta = renderMetaDocs();
    // version-store 기본값 → 양쪽 동일하게 loading 상태 뱃지(동일 컴포넌트 단일 출처 입증).
    expect(browse).toContain('update-badge update-badge--loading');
    expect(meta).toContain('update-badge update-badge--loading');
  });
});
