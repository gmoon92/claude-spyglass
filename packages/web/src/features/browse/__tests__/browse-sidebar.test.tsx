/**
 * browse-sidebar.test.tsx — BrowseSidebar 마크업 계약 + obs 카드 조합 검증
 *
 * 원본: index.html <aside class="left-panel"> 골격 + obs-panel.js 통계카드 3종.
 *
 * 전략(sidebar.test 선례 + 무 DOM 하네스):
 *  - 마크업/셀렉터 계약: renderToStaticMarkup 으로 검증(useEffect 미발화 → fetch/resize 리스너 부착 0).
 *  - obs 카드 3종(cardBurnRate/cardCacheHealth/cardLivePulse)이 left-panel 하단에 마운트되는지.
 *  - 리사이저 핸들(.panel-resize-handle / .panel-vertical-handle)·left-panel 골격 셀렉터 보존.
 *  - obsIntervalMs=0 주입(폴링 없음) — 테스트 결정론.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrowseSidebar } from '../BrowseSidebar';

// SessionRow/fmtRelative 가 window.I18n 참조 → 테스트 스텁(sidebar.test 선례).
beforeAll(() => {
  (globalThis as unknown as { window: { I18n: { t: (k: string) => string } } }).window =
    ((globalThis as unknown as { window?: object }).window as never) ?? ({} as never);
  (globalThis as unknown as { window: { I18n: { t: (k: string) => string } } }).window.I18n = {
    t: (key: string) => key,
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

function render(): string {
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

describe('BrowseSidebar — left-panel 골격 + 리사이저 셀렉터 계약', () => {
  it('left-panel aside 와 수평 리사이저 핸들을 렌더한다', () => {
    const html = render();
    expect(html).toContain('class="left-panel"');
    expect(html).toContain('data-testid="browse-sidebar"');
    expect(html).toContain('class="panel-resize-handle"');
  });

  it('수직 분할 핸들 두 개(panelVerticalHandle / panelVerticalHandleBottom)를 렌더한다', () => {
    const html = render();
    expect(html).toContain('id="panelVerticalHandle"');
    expect(html).toContain('id="panelVerticalHandleBottom"');
    // 레거시 grid 6트랙: 핸들 클래스가 정확히 두 번.
    expect(html.match(/class="panel-vertical-handle"/g)?.length).toBe(2);
  });

  it('프로젝트 섹션과 세션 섹션을 별도 panel-section 두 벌로 분리한다', () => {
    const html = render();
    expect(html).toContain('id="browserProjectsSection"');
    expect(html).toContain('class="browser-projects-table"');
    expect(html).toContain('id="browserProjectsBody"');
    expect(html).toContain('id="browserSessionsSection"');
    expect(html).toContain('id="browserSessionsBody"');
  });

  it('세션 섹션은 panel-header(panel-label + sessionPaneHint)를 가진다', () => {
    const html = render();
    expect(html).toContain('class="panel-header"');
    expect(html).toContain('class="panel-label"');
    expect(html).toContain('id="sessionPaneHint"');
    // 미선택 프로젝트 → labeler.selectProject() 힌트.
    expect(html).toContain('select-project');
  });

  it('미선택 프로젝트일 때 세션 hint 가 selectProject 라벨이다', () => {
    const html = render();
    expect(html).toContain('>select-project<');
  });

  it('floating anomaly badge 는 hidden 으로 마운트된다(원본 ADR-006)', () => {
    const html = render();
    expect(html).toContain('id="anomalyBadge"');
    expect(html).toContain('hidden');
  });
});

describe('BrowseSidebar — left-panel-footer + update-badge', () => {
  it('footer 에 update-badge 를 마운트한다(레거시 .left-panel-footer)', () => {
    const html = render();
    expect(html).toContain('class="left-panel-footer"');
    expect(html).toContain('update-badge');
  });
});

describe('BrowseSidebar — 세션 hint(선택 프로젝트)', () => {
  it('선택 프로젝트가 있으면 sessionCount(project, n) 힌트를 표시한다', () => {
    const html = renderToStaticMarkup(
      <BrowseSidebar
        projects={[{ project_name: 'alpha', total_tokens: 1000, active_count: 2 }]}
        sessions={[
          { id: 's1', project_name: 'alpha' },
          { id: 's2', project_name: 'alpha' },
          { id: 's3', project_name: 'beta' },
        ]}
        selectedProject="alpha"
        selectedSession={null}
        labeler={labeler}
        obsIntervalMs={0}
      />,
    );
    // alpha 세션 2개만 카운트.
    expect(html).toContain('count:alpha:2');
  });
});

describe('BrowseSidebar — obs 통계카드 3종 조합', () => {
  it('panelTools/obsPanel 하단에 3 카드 컨테이너를 마운트한다', () => {
    const html = render();
    expect(html).toContain('id="panelTools"');
    expect(html).toContain('id="obsPanel"');
    // 마운트 1회 fetch 전(useEffect 미발화) payload=null → 각 카드 empty 상태로 렌더.
    expect(html).toContain('id="cardBurnRate"');
    expect(html).toContain('id="cardCacheHealth"');
    expect(html).toContain('id="cardLivePulse"');
  });
});
