/**
 * meta-docs-layout-scope.test.tsx — metadocs 좌측 프로젝트 클릭이 "카탈로그 스코프 필터"로
 *   작동함을 입증(요구 2). browse 의 onSelectSession→detail 과 분리됨을 함께 검증.
 *
 * 원본 정답(spyglass-legacy-ref):
 *   - main.js selectProject(:256) — metadocs 모드에서 프로젝트 행 클릭 시 setSelectedProject +
 *     setMetaScopeMode('selected') 후 카탈로그만 재로드(세션/detail 이동 없음). __global__ 행은
 *     scopeMode='all' 로 전체 카탈로그.
 *   - meta-docs-view.js loadMetaDocsLibrary(:448) — project = scopeMode==='selected'? selectedProject : null.
 *
 * React 정합:
 *   - MetaDocsLayout 의 onSelectProject={(p)=>setSelectedProject(p)} → 카탈로그 useEffect 가
 *     fetchMetaDocs({ project: selectedProject }) 재실행. 실제 fetchMetaDocs 가 __global__ →
 *     project 쿼리 생략(scope='all' 동치)을 책임진다.
 *
 * 전략: 실제 fetchers(목 아님) + global.fetch 만 목 처리 → 요청 URL 의 ?project= 유무로
 *   스코프 전환을 입증한다. react-dom client createRoot + act 로 jsdom 에 마운트해 useEffect 실행.
 *   클릭은 실제 DOM 행(data-project)에 dispatch — 라이브 DOM 배선 검증.
 */
import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MetaDocsLayout } from '../MetaDocsLayout';
import { useAppStore } from '../../stores/app-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 요청 URL 캡처 — fetch 목. /api/meta-docs 호출만 추적(대시보드/tool-stats 등은 빈 봉투).
const metaDocsUrls: string[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { window?: { I18n?: unknown } }).window ??= {};
  (globalThis as { window: { I18n?: unknown } }).window.I18n = {
    t: (k: string) => k,
    getLang: () => 'en',
    getCollator: () => new Intl.Collator('en'),
  };
});

beforeEach(() => {
  metaDocsUrls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/meta-docs')) {
      metaDocsUrls.push(url);
      return jsonResponse({ data: [] });
    }
    if (url.includes('/api/dashboard')) {
      // DashboardEnvelopeSchema 형태 — { data: { summary, requests, projects, types, active } }.
      return jsonResponse({
        data: {
          summary: {
            totalSessions: 0, totalRequests: 0, totalTokens: 0, activeSessions: 0,
            avgDurationMs: null, p95DurationMs: null, errorRate: null,
          },
          requests: null,
          projects: [
            { project_name: 'alpha', total_tokens: 100, active_count: 0 },
            { project_name: 'beta', total_tokens: 50, active_count: 0 },
          ],
          types: [],
          active: [],
        },
      });
    }
    // tool-stats 등 기타 — 빈 배열 봉투.
    return jsonResponse({ data: [] });
  }));
  useAppStore.setState({
    selectedProject: null,
    selectedSession: null,
    rightView: 'default',
    metaSubTab: 'docs',
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mountLayout(): Promise<void> {
  await act(async () => {
    root.render(<MetaDocsLayout />);
  });
  // 카탈로그/대시보드 fetch 의 async 체인(Promise.all → setState) flush — 여러 microtask 라운드.
  for (let i = 0; i < 5; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

function clickProjectRow(project: string): void {
  const row = container.querySelector<HTMLElement>(`tr[data-project="${project}"]`);
  if (!row) throw new Error(`row not found: ${project}`);
  act(() => {
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** /api/meta-docs URL 의 project 쿼리값(없으면 null). */
function projectQuery(url: string): string | null {
  return new URL(url, 'http://localhost').searchParams.get('project');
}

describe('MetaDocsLayout — metadocs 프로젝트 클릭 = 카탈로그 스코프 필터', () => {
  it('마운트 시 카탈로그를 project 쿼리 없이(전체) fetch(초기 미선택)', async () => {
    await mountLayout();
    expect(metaDocsUrls.length).toBeGreaterThanOrEqual(1);
    expect(projectQuery(metaDocsUrls[0])).toBeNull();
  });

  it('좌측이 metadocs 분기 — 가상 __global__ 행 + meta 카운트 셀(세션/토큰 셀 아님)', async () => {
    await mountLayout();
    expect(container.querySelector('tr[data-project="__global__"]')).not.toBeNull();
    expect(container.querySelector('.cell-proj-global')).not.toBeNull();
    expect(container.querySelector('.cell-proj-meta-count')).not.toBeNull();
    // browse 전용 셀(활성 세션 / 토큰 바)은 부재 — 분기 정합 입증.
    expect(container.querySelector('.cell-proj-sess')).toBeNull();
    expect(container.querySelector('.bar-fill')).toBeNull();
  });

  it('프로젝트 행 클릭 → selectedProject 갱신 + 카탈로그를 ?project=alpha 로 재fetch(세션/detail 이동 없음)', async () => {
    await mountLayout();
    const before = metaDocsUrls.length;

    clickProjectRow('alpha');
    expect(useAppStore.getState().selectedProject).toBe('alpha');
    for (let i = 0; i < 5; i++) { await act(async () => { await Promise.resolve(); }); }

    const newUrls = metaDocsUrls.slice(before);
    expect(newUrls.length).toBeGreaterThanOrEqual(1);
    expect(projectQuery(newUrls.at(-1)!)).toBe('alpha'); // 카탈로그가 해당 프로젝트로 좁혀짐

    // browse 의 세션/detail 흐름으로 새지 않음(요구 2).
    expect(useAppStore.getState().selectedSession).toBeNull();
    expect(useAppStore.getState().rightView).toBe('default');
  });

  it('__global__ 행 클릭 → 카탈로그를 project 쿼리 없이 재fetch(scope=all 동치)', async () => {
    useAppStore.setState({ selectedProject: 'alpha' });
    await mountLayout();
    const before = metaDocsUrls.length;

    clickProjectRow('__global__');
    expect(useAppStore.getState().selectedProject).toBe('__global__');
    for (let i = 0; i < 5; i++) { await act(async () => { await Promise.resolve(); }); }

    const newUrls = metaDocsUrls.slice(before);
    expect(newUrls.length).toBeGreaterThanOrEqual(1);
    // fetchMetaDocs 가 __global__ → project 쿼리 생략(전체 카탈로그).
    expect(projectQuery(newUrls.at(-1)!)).toBeNull();
  });
});
