/**
 * session-detail.js — facade.
 *
 * 실제 구현은 ./session-detail/ 디렉토리의 5개 모듈로 분리되었다:
 *   - session-detail/state.js       : 모듈 상태 + getter/setter (단일 캡슐화)
 *   - session-detail/turn-rows.js   : 턴 내 prompt/tool/response 행 빌더 (helper)
 *   - session-detail/turn-views.js  : 테이블/카드형 turn 뷰 + 토글 액션
 *   - session-detail/flat-view.js   : 평면 요청 뷰 + 필터 적용 + 이벤트 발행/구독
 *   - session-detail/index.js       : 데이터 로드/검색 + 외부 export 통합
 *
 * 외부 호출자(main.js, views/*.js 등)의 import 경로 변경을 0으로 유지하기 위해
 * 기존 export 인터페이스를 동일 이름으로 그대로 re-export 한다.
 *
 * 분리 원칙:
 *   - state는 다른 모듈에서 직접 변수 접근하지 않고 getter/setter로만 접근.
 *   - 각 모듈은 단일 책임을 가진다 (행 빌더 / 뷰 렌더 / 필터 / 데이터 로드).
 */

export {
  API,
  detailSearchBox,
  getDetailFilter, setDetailFilter, getDetailRequests, getDetailTurns,
  renderDetailRequests, applyDetailFilter,
  setDetailView, toggleTurn, toggleCardExpand, setTurnViewMode,
  renderTurnView, renderTurnCards,
  loadSessionDetail, refreshDetailSession, initDetailSearch,
} from './session-detail/index.js';
