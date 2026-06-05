/**
 * _dom-stub.ts — 최소 document/window 전역 스텁 (P3-06 테스트 전용)
 *
 * 목적:
 *  - turn-views.js 를 oracle 로 import 하면 §5 모듈 순환(turn-views → detail-view → 루트 facade →
 *    index → flat-view) 을 따라 flat-view.js 의 **모듈 최상위** `document.addEventListener`
 *    (flat-view.js:142) 가 평가된다. happy-dom 미설치 환경(bun test 기본)에서는 `document` 가
 *    없어 ReferenceError 로 모듈 로드가 깨진다.
 *  - 본 모듈은 oracle import 보다 **먼저** 평가되도록 테스트 파일 최상단에서 import 해
 *    addEventListener no-op 만 갖춘 최소 document/window 를 전역에 심는다.
 *  - oracle 함수(renderSpine/turnLineHtml 등)는 순수 직렬화라 실제 DOM 을 쓰지 않으므로
 *    no-op 스텁으로 충분하다(렌더 동치 비교에 영향 없음).
 *
 * 주의: ESM import 는 hoisting 되므로 이 파일을 oracle 보다 **앞 줄**에 import 해야 효과가 있다.
 */
const g = globalThis as unknown as {
  document?: unknown;
  window?: object;
};

if (!g.document) {
  g.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } }),
    body: { appendChild: () => {} },
  };
}

g.window = g.window ?? {};
// i18n 은 vitest.setup 의 기본 t(passthrough)가 담당 — window.I18n 전역 스텁 제거(react-i18next 단일화).

export {};
