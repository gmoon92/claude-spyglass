/**
 * design-system/feedback/index.ts — 피드백 패밀리 진입점 (placeholder, P2-03)
 *
 * 원본: assets/js/design-system/feedback/index.js.
 *  - 원본은 **placeholder** — 빈 상태/로딩/에러 컨테이너(ds-state-*) 및 글로벌 배너(ds-banner)의
 *    CSS 정의만 존재하고 렌더 함수는 아직 없다(원본 파일에 TODO 만 있음).
 *  - 따라서 이식할 출력(컴포넌트)이 없으므로 동치 테스트 대상도 없다. 본 파일은 1:1 파일 매핑
 *    완결을 위한 placeholder 이며, 실제 컴포넌트(StateEmpty/StateLoading/StateError/Banner)는
 *    원본에 renderState 계열·renderBanner 가 추가되는 후속 wave 에서 이식한다.
 *
 * 흡수 예정(원본 TODO 와 동일):
 *  - state.css :: .state-empty / .state-loading / .state-error → renderStateEmpty/Loading/Error
 *  - header.css :: .error-banner / .retry-btn → renderBanner({ variant, message, actionLabel })
 *
 * @module design-system/feedback
 */

// TODO(후속 wave): 원본 feedback/index.js 에 renderState 계열·renderBanner 가 추가되면
//   StateEmpty.tsx / StateLoading.tsx / StateError.tsx / Banner.tsx 로 이식 후 여기서 re-export 한다.
export {};
