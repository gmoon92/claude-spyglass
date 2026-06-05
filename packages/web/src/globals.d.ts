/**
 * src/globals.d.ts — web 빌드리스 ESM 번들의 ambient(전역) 타입 선언 SSoT.
 *
 * 런타임 코드는 변경하지 않는다. 이 파일은 tsc(@ts-check) 전용 타입 표면이며
 * 브라우저 전역에 대한 컴파일 타임 계약만 기술한다.
 *
 * 정책 (R5): 표준 DOM 인터페이스(Element/EventTarget/HTMLElement 등)는 절대
 * augmentation하지 않는다 — 전역 오염은 타입 안전을 붕괴시킨다. DOM narrowing은
 * 호출 지점에서 인라인 캐스팅으로 처리한다.
 *
 * NOTE: 과거 `window.I18n`(레거시 assets/js/i18n.js 전역) 타입 계약이 여기 있었으나,
 *   react-i18next 단일화로 전역과 그 타입 선언을 모두 제거했다. i18n SSoT 는 lib/i18n.ts(i18next).
 */

export {};

declare global {
  interface Window {
    /** 메타 문서 스캔 진입점 cwd (선택적 전역). meta-docs-view.js buildRefreshBody가 참조. */
    __SPYGLASS_CWD__?: string;
  }

  /**
   * 테스트 전용 i18n 헬퍼 — vitest.setup.ts 가 설치(런타임 무존재). 테스트가 i18next.t/useTranslation 의
   * 출력을 커스텀 번역/보간으로 주입(__setTestT)하거나 기본 passthrough 로 복원(__resetTestT)한다.
   */
  // eslint-disable-next-line no-var
  var __setTestT: ((fn: (key: string, vars?: Record<string, unknown>) => string) => void) | undefined;
  // eslint-disable-next-line no-var
  var __resetTestT: (() => void) | undefined;
}
