/**
 * @module design-system/feedback
 *
 * 책임:
 *   빈 상태 / 로딩 / 에러 컨테이너(ds-state-*) 및
 *   글로벌 알림 배너(ds-banner) 패밀리의 JS 진입점.
 *
 *   현재는 placeholder — CSS 정의만 존재하며 렌더 함수는 향후 추가 예정.
 *
 * 흡수 예정 (향후 wave):
 *   - state.css :: .state-empty / .state-loading / .state-error 호출처
 *   - detail-view.css :: .detail-loading 호출처
 *   - header.css :: .error-banner / .retry-btn 호출처
 *   - default-view.css :: .scroll-lock-banner 호출처
 *
 * 의존:
 *   - feedback/state.css  — .ds-state-* 스타일
 *   - feedback/banner.css — .ds-banner 스타일
 *
 * 사용 가이드:
 *   신규 코드는 .ds-state-* / .ds-banner 클래스 사용.
 *   기존 호출처는 점진 마이그레이션 (기존 .state-*, .error-banner 제거 X).
 */

// TODO(Wave 9+): renderStateEmpty(), renderStateLoading(), renderStateError() 추가
// TODO(Wave 9+): renderBanner({ variant, message, actionLabel, onAction }) 추가
