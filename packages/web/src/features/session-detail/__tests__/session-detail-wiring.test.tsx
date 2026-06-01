/**
 * session-detail-wiring.test.tsx — turns fetcher + 상세 탭바 데이터 배선 (P3-07)
 *
 * 검증 범위:
 *  - fetchSessionTurns: /api/sessions/:id/turns envelope → {turns, prologue} 파싱(Zod passthrough).
 *    실패(HTTP !ok / 스키마 미스 / falsy id)는 throw 없이 빈 결과 폴백(api/fetchers.ts silent catch 동형).
 *  - SessionDetailContainer: detailTab 별 본문 스위치(로그=DetailView turn-spine / llm=#detailLlmInputView /
 *    syslib=#detailSysLibView) + 탭바 3종(view-tab) 마크업. 원본 turn-views.js#setDetailView 동치.
 *
 * @see packages/web/src/features/session-detail/turns-fetcher.ts
 * @see packages/web/src/features/session-detail/SessionDetailContainer.tsx
 */
import './_dom-stub';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fetchSessionTurns } from '../turns-fetcher';
import { SessionDetailContainer } from '../SessionDetailContainer';
import { useAppStore } from '../../../stores/app-store';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = { t: (key: string) => key };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch,
  );
}

// ── fetchSessionTurns (turns-fetcher.ts) ─────────────────────────────────────
describe('fetchSessionTurns — turns/prologue 파싱', () => {
  it('data + prologue 형제 키를 raw 반환(passthrough 보존)', async () => {
    mockFetch(200, {
      success: true,
      data: [
        { turn_id: 'S-T1', turn_index: 1, prompt: { preview: 'hi' } },
        { turn_id: 'S-T2', turn_index: 2, summary: { total_tokens: 5 } },
      ],
      prologue: [{ kind: 'response', foo: 'bar' }],
      meta: { total: 2 },
    });
    const out = await fetchSessionTurns('sess-1');
    expect(out.turns).toHaveLength(2);
    expect(out.turns[0].turn_id).toBe('S-T1');
    // passthrough — prompt/summary 비계약 필드 보존.
    expect((out.turns[0] as any).prompt.preview).toBe('hi');
    expect(out.prologue).toEqual([{ kind: 'response', foo: 'bar' }]);
  });

  it('prologue 누락 시 빈 배열 폴백', async () => {
    mockFetch(200, { data: [{ turn_id: 'X', turn_index: 0 }] });
    const out = await fetchSessionTurns('sess-2');
    expect(out.prologue).toEqual([]);
    expect(out.turns).toHaveLength(1);
  });

  it('falsy sessionId → fetch 미호출, 빈 결과', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    const out = await fetchSessionTurns('');
    expect(out).toEqual({ turns: [], prologue: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it('HTTP !ok → 빈 결과(throw 없음)', async () => {
    mockFetch(500, { data: [] });
    const out = await fetchSessionTurns('sess-3');
    expect(out).toEqual({ turns: [], prologue: [] });
  });

  it('스키마 미스(turn_id 누락) → 빈 결과(throw 없음)', async () => {
    mockFetch(200, { data: [{ turn_index: 1 }] });
    const out = await fetchSessionTurns('sess-4');
    expect(out).toEqual({ turns: [], prologue: [] });
  });
});

// ── SessionDetailContainer — 탭바 + 본문 스위치 ──────────────────────────────
//   주의: zustand react 바인딩의 SSR 스냅샷은 getInitialState() 를 읽으므로(react.mjs:9),
//   renderToStaticMarkup 은 항상 store 초기값(detailTab='log')을 본다. 따라서 SSR 로는 기본 탭
//   본문 + 탭바 마크업 계약만 고정하고, 탭별 본문 스위치 분기는 renderBody 의 detailTab 비교
//   로직(소스) + setDetailTab 액션(app-store 테스트)으로 보장한다.
describe('SessionDetailContainer — 상세 탭바 + 기본 본문', () => {
  it('탭바 3종(view-tab) + i18n 라벨 + 기본 탭(log)=DetailView(turn-spine) 렌더', () => {
    useAppStore.setState({ detailTab: 'log' });
    const html = r(<SessionDetailContainer sessionId="sess-A" projectName="proj" />);
    // 탭바 셀렉터 계약(원본 index.html:646-657).
    expect(html).toContain('class="view-tab-bar"');
    expect(html).toContain('id="viewTabGroup"');
    expect(html).toContain('id="detailSearchContainer"');
    // 탭 3종 — value/i18n 키(원본 initDetailTabBar TABS).
    expect((html.match(/class="ds-tab view-tab/g) ?? []).length).toBe(3);
    expect(html).toContain('data-tab-value="log"');
    expect(html).toContain('data-tab-value="llm"');
    expect(html).toContain('data-tab-value="syslib"');
    expect(html).toContain('tab-llm-title'); // llm 탭 title 속성.
    // 기본 탭(log) 본문 = DetailView(turn-spine 골격).
    //   #detailView(.right-view) switcher 슬롯은 BrowseLayout 소유 — 본 컨테이너는 그 직계 자식
    //   (tab-bar + #turnUnifiedBody 본문)만 렌더한다(중첩 .right-view 가 opacity:0 으로 본문을 가리던 회귀 수정).
    //   본문 래퍼는 레거시 #turnUnifiedBody(turn-view.css flex column SSoT) — 과거 phantom `.detail-view`
    //   래퍼는 매칭 CSS 가 없어 flow-pane/log-pane flex 축을 끊어 로그 영역 스크롤이 사라졌었다(legacy 정합).
    expect(html).toContain('id="turnUnifiedBody"');
    expect(html).not.toContain('id="detailView"');
    expect(html).toContain('turn-spine');
  });

  it('default-export 컨테이너가 활성 탭 버튼을 aria-selected=true 로 표기', () => {
    useAppStore.setState({ detailTab: 'log' });
    const html = r(<SessionDetailContainer sessionId="sess-B" />);
    // 활성 탭(log)만 active + aria-selected=true(원본 setDetailView _syncTab 동치).
    expect(html).toContain(
      '<button class="ds-tab view-tab active" type="button" role="tab" aria-selected="true" data-tab-value="log">',
    );
  });
});
