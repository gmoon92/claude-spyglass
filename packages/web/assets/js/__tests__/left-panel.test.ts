import { describe, it, expect } from 'bun:test';
// 정적 import 자체가 회귀 가드다(T08 버그 A):
// left-panel.js의 top-level `document.addEventListener`가 비-DOM(bun test) 환경에서
// throw하면 이 import가 실패해 파일 전체가 로드되지 않는다. import가 성공한다는 것은
// 모듈이 DOM 부재 환경에서 안전하게 평가됨을 의미한다.
// → 이 가드가 깨지면 api.js의 transitive import도 깨져 VALID_PRESETS가 TDZ가 된다.
// (root tsconfig는 checkJs 미적용이라 .js import가 implicit-any TS7016을 내므로 억제 —
//  기존 web 테스트와 동일한 .js→.ts 경계 상황. root tsc baseline 12 보존.)
// @ts-ignore TS7016: .js 소스 모듈 선언 파일 부재(테스트 전용, 런타임 동작 무관)
import { renderBrowserSessions, getAllSessions, GLOBAL_PROJECT_KEY } from '../left-panel.js';

describe('left-panel 모듈 — 비-DOM 환경 import 안전성 (T08 버그 A)', () => {
  it('document 부재 환경에서 모듈이 평가·export된다 (api.js TDZ 연쇄 차단)', () => {
    // bun test 기본 환경에 document가 없음을 명시.
    expect(typeof globalThis.document).toBe('undefined');
    // top-level addEventListener가 가드되지 않았다면 위 정적 import에서 throw → 여기 도달 불가.
    expect(typeof renderBrowserSessions).toBe('function');
    expect(typeof getAllSessions).toBe('function');
    expect(GLOBAL_PROJECT_KEY).toBe('__global__');
  });

  it('document가 존재하면 session-anomalies-loaded 리스너를 등록한다 (브라우저 동작 보존)', async () => {
    const registered: string[] = [];
    // @ts-expect-error — 테스트용 document 스텁 주입
    globalThis.document = { addEventListener: (type: string) => { registered.push(type); } };
    try {
      // ESM 모듈 캐시 우회: 동적 specifier(런타임 계산)로 fresh 평가를 유도한다.
      // 정적 리터럴이 아니므로 tsc 모듈 해석 대상에서 제외된다(root tsc baseline 보존).
      const fresh = '../left-panel.js?domguard=' + Date.now();
      await import(/* @vite-ignore */ fresh);
      expect(registered).toContain('session-anomalies-loaded');
    } finally {
      // @ts-expect-error — 스텁 정리
      delete globalThis.document;
    }
  });
});
