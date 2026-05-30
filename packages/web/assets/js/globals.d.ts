/**
 * globals.d.ts — web 빌드리스 ESM 번들의 ambient(전역) 타입 선언 SSoT.
 *
 * 런타임 코드는 변경하지 않는다. 이 파일은 tsc(@ts-check) 전용 타입 표면이며
 * 브라우저 전역(`window.I18n` 등)에 대한 컴파일 타임 계약만 기술한다.
 *
 * 정책 (R5): 표준 DOM 인터페이스(Element/EventTarget/HTMLElement 등)는 절대
 * augmentation하지 않는다 — 전역 오염은 타입 안전을 붕괴시킨다. DOM narrowing은
 * 호출 지점에서 assets/js/dom.js 헬퍼 또는 인라인 캐스팅으로 처리한다.
 *
 * I18n 실제 구현/SSoT: assets/js/i18n.js (`const I18n = { ... }; window.I18n = I18n;`)
 * 본 선언은 그 public API 표면(init/t/setLang/getLang/getSupportedLangs/onChange)만 미러링한다.
 */

export {};

/** i18n 전역 객체 (i18n.js가 `window.I18n`에 노출). API 표면은 i18n.js의 SSoT를 미러링. */
interface SpyglassI18n {
  /** 언어 결정 + 모든 namespace 비동기 로딩. */
  init(opts?: { lang?: string }): Promise<void>;
  /** 번역 조회. `<ns>.<path>` dot 키. 미스 시 key 자체 반환. */
  t(key: string, vars?: Record<string, string | number>): string;
  /** 언어 변경 → localStorage 저장 + 리스너 호출. */
  setLang(lang: string): Promise<void>;
  /** 현재 언어 코드 반환. */
  getLang(): string;
  /** 지원 언어 목록 반환. */
  getSupportedLangs(): string[];
  /** 언어 변경 리스너 등록. unsubscribe 함수 반환. */
  onChange(fn: (lang: string) => void): () => void;
}

declare global {
  interface Window {
    /** i18n 전역 (i18n.js 로드 후 존재). 일부 호출부는 `window.I18n?.t` 옵셔널 가드 사용. */
    I18n: SpyglassI18n;
    /** 메타 문서 스캔 진입점 cwd (선택적 전역). meta-docs-view.js buildRefreshBody가 참조. */
    __SPYGLASS_CWD__?: string;
  }
}
