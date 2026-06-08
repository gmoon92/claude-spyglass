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

// SessionRow/fmtRelative 가 i18next.t 참조 → 기본 t(passthrough)는 vitest.setup 가 담당.
beforeAll(() => {
  (globalThis as unknown as { window?: object }).window =
    ((globalThis as unknown as { window?: object }).window as never) ?? ({} as never);
});
afterAll(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

// i18n 은 BrowseSidebar 가 useTranslation 으로 직접 구독(무전역 labeler 폐기). vitest.setup 기본 t 는
//   key passthrough → 힌트/세션카운트 단언은 ui.left-panel.* 키로(보간 검증은 __setTestT 주입 케이스).

function render(): string {
  return renderToStaticMarkup(
    <BrowseSidebar
      projects={[{ project_name: 'alpha', total_tokens: 1000, active_count: 2 }]}
      sessions={[]}
      selectedProject={null}
      selectedSession={null}
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
    // 미선택 프로젝트 → ui.left-panel.select-project 힌트(useTranslation 직접 구독).
    expect(html).toContain('ui:left-panel.select-project');
  });

  it('미선택 프로젝트일 때 세션 hint 가 selectProject 라벨이다', () => {
    const html = render();
    expect(html).toContain('>ui:left-panel.select-project<');
  });

  it('floating anomaly badge 는 hidden 으로 마운트된다(원본 ADR-006)', () => {
    const html = render();
    expect(html).toContain('id="anomalyBadge"');
    expect(html).toContain('hidden');
  });
});

describe('BrowseSidebar — 프로젝트 테이블 thead-browse(colgroup + 3컬럼 헤더)', () => {
  it('browser-projects-table 에 colgroup + thead.thead-browse 를 렌더한다(레거시 골격)', () => {
    const html = render();
    // colgroup 3컬럼 + thead-browse 1행.
    expect(html).toContain('<colgroup>');
    expect(html).toContain('class="thead-browse"');
    // thead 가 tbody(browserProjectsBody) 보다 먼저 등장(헤더 → 행 순서).
    expect(html.indexOf('thead-browse')).toBeLessThan(html.indexOf('id="browserProjectsBody"'));
  });

  it('thead-browse 라벨이 i18n 키(ui.html.left-panel.th-*)로 해석된다', () => {
    // 테스트 스텁 I18n.t 는 key passthrough → tt() 가 키를 그대로 반환하는지로 i18n 경로 입증.
    const html = render();
    expect(html).toContain('ui:html.left-panel.th-project');
    expect(html).toContain('ui:html.left-panel.th-session');
    expect(html).toContain('ui:html.left-panel.th-token');
  });

  it('세션 panel-label 이 i18n 키(ui.html.session-panel.label)로 해석된다', () => {
    const html = render();
    expect(html).toContain('ui:html.session-panel.label');
  });

  it('i18next.t 가 번역값을 주면 thead/panel-label 이 그 값으로 렌더된다', () => {
    // 로케일 해석 입증: 임시로 테스트 t 를 한국어 값 반환으로 교체(vitest.setup __setTestT).
    const dict: Record<string, string> = {
      'ui:html.left-panel.th-project': '프로젝트',
      'ui:html.left-panel.th-session': '세션',
      'ui:html.left-panel.th-token': '토큰',
      'ui:html.session-panel.label': '세션',
    };
    globalThis.__setTestT?.((key) => dict[key] ?? key);
    try {
      const html = render();
      expect(html).toContain('>프로젝트</th>');
      expect(html).toContain('>토큰</th>');
      expect(html).toContain('class="panel-label">세션</span>');
    } finally {
      globalThis.__resetTestT?.();
    }
  });

  it('chromeLabels prop 이 주어지면 i18n 해석보다 우선한다(호출처 override 계약)', () => {
    const html = renderToStaticMarkup(
      <BrowseSidebar
        projects={[{ project_name: 'alpha', total_tokens: 1000, active_count: 2 }]}
        sessions={[]}
        selectedProject={null}
        selectedSession={null}
        obsIntervalMs={0}
        chromeLabels={{ thProject: 'P!', thSession: 'S!', thToken: 'T!', sessionPanelLabel: 'SP!' }}
      />,
    );
    expect(html).toContain('>P!</th>');
    expect(html).toContain('>S!</th>');
    expect(html).toContain('>T!</th>');
    expect(html).toContain('class="panel-label">SP!</span>');
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
    // 보간 vars(project/count) 전달을 검증 — __setTestT 로 키→`count:{project}:{count}` 매핑 주입.
    globalThis.__setTestT?.((key, vars) =>
      key === 'ui:left-panel.session-count' ? `count:${vars?.project}:${vars?.count}` : key,
    );
    try {
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
          obsIntervalMs={0}
        />,
      );
      // alpha 세션 2개만 카운트.
      expect(html).toContain('count:alpha:2');
    } finally {
      globalThis.__resetTestT?.();
    }
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
