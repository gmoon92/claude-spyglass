/**
 * ensure-dom.ts — 라이브 DOM 테스트 공용 부트스트랩 (bun test ↔ vitest 양립)
 *
 * 배경:
 *   - vitest 는 `environment: 'jsdom'` 으로 전역 DOM(document/window/localStorage 등)을 미리 깐다.
 *   - 루트 `bun test` 는 setupFiles 가 없어 전역 DOM 이 없다(`document`/`localStorage` 미정의).
 *     이 상태에서 createRoot 마운트·dispatchEvent·querySelector 기반 단언이 불가능하다.
 *
 * 본 헬퍼는 **DOM 이 없을 때만** jsdom 인스턴스를 만들어 전역에 심는다.
 *   vitest(이미 jsdom)에서는 no-op 이라 기존 동작을 바꾸지 않고, bun test 에서는 동일한
 *   라이브 DOM 을 제공한다. requestAnimationFrame 도 없으면 setTimeout 폴리필을 깐다.
 *
 * 검증 의도는 보존된다 — 러너 간 DOM 제공 격차만 메운다(단언 약화 없음).
 */
export function ensureDom(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.document === 'undefined') {
    // 동적 require — vitest(jsdom)에서는 평가 자체가 일어나지 않는다.
    // jsdom 은 @types 미설치라 인라인 최소 타입으로 캡처(전역 타입 의존 회피).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require('jsdom') as {
      JSDOM: new (html: string, opts?: { url?: string }) => { window: unknown };
    };
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    const w = dom.window as unknown as Record<string, unknown>;
    // react-dom/client + 테스트가 참조하는 전역을 jsdom window 에서 끌어온다.
    for (const key of [
      'window', 'document', 'navigator', 'localStorage', 'sessionStorage',
      'HTMLElement', 'HTMLTableElement', 'HTMLTableSectionElement', 'HTMLDivElement',
      'Element', 'Node', 'Event', 'MouseEvent', 'CustomEvent', 'getComputedStyle',
      'requestAnimationFrame', 'cancelAnimationFrame', 'Text', 'NodeList',
    ]) {
      if (key === 'window') { g.window = w; continue; }
      if (g[key] === undefined && (w as Record<string, unknown>)[key] !== undefined) {
        g[key] = (w as Record<string, unknown>)[key];
      }
    }
  }
  // rAF 폴리필(jsdom 구버전·일부 환경에서 미제공) — 저장 비율 복원 등 rAF 콜백 경로 보장.
  if (typeof (globalThis as Record<string, unknown>).requestAnimationFrame !== 'function') {
    (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number;
    (globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
}
