// state/anomaly-cache.js — 세션 단위 anomaly 객체 SSoT 캐시.
//
// 목적:
//   /api/sessions 목록 응답엔 bloated_sys / agent_spike 메타가 없다(서버 SSoT는 단건 /api/sessions/:id).
//   detail-view.js의 단건 fetch 결과를 다른 UI 영역(사이드바 dot, 차트 baseline, 헤더 full 뱃지)이
//   재참조하기 위한 모듈 수준 캐시. 별도 모듈로 분리한 이유는 render/rows.js가 detail-view.js를
//   import하면 순환 의존성이 생기기 때문 (views/detail-view → left-panel → renderers → render/rows).
//
// 사용:
//   detail-view.js의 단건 fetch가 끝나면 setBloatedSysFor(sessionId, bs)로 저장.
//   render/rows.js의 makeSessionRow가 s.bloated_sys || getBloatedSysFor(s.id)로 폴백 참조.
//
// 라이프사이클:
//   세션 ID 키로 누적. 명시 초기화는 별도 호출 없음 — 모듈 수준 메모리는 페이지 새로고침으로 리셋.

const _bloatedSysCache = new Map();

export function getBloatedSysFor(sessionId: any) {
  return _bloatedSysCache.get(sessionId) || null;
}

export function setBloatedSysFor(sessionId: any, bloatedSys: any) {
  _bloatedSysCache.set(sessionId, bloatedSys || null);
}
