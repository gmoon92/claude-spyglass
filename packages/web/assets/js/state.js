// state.js — 라우팅/뷰 상태 SSoT (ADR-003 라우팅 로직 단순화 + ADR-003 left-rail-meta-docs)
//
// 앱 모드 (ADR-003 left-rail-meta-docs):
//   - 'browse'   : 기본. 좌측 패널(프로젝트/세션/obs) + 우측 default/detail-view 정상 동작.
//   - 'metadocs' : 메인 영역 전체가 메타 문서 카탈로그. 좌측은 축약 패널(프로젝트 + 요약 카드).
//   - sessionStorage('spyglass.appMode') 영속화 — 새로고침 시 마지막 모드 복원.
//   - _prevState: 'metadocs' 진입 직전의 browse 스냅샷(view/tab/sessionId). ESC 복귀용. in-memory only.

const SS_APP_MODE = 'spyglass.appMode';

let _appMode          = 'browse';
let _prevState        = null;          // { rightView, detailTab, sessionId } | null
let _rightView        = 'default';
let _detailTab        = 'turn';
let _selectedProject  = null;
let _selectedSession  = null;
let _feedFilterBar    = null;
let _detailFilterBar  = null;

// sessionStorage 복원 — 모듈 로드 시 1회. 실패 시(접근 거부 등) 기본값 유지.
try {
  const saved = sessionStorage.getItem(SS_APP_MODE);
  if (saved === 'browse' || saved === 'metadocs') _appMode = saved;
} catch { /* sessionStorage 미지원/거부 시 silent fallback */ }

// ── appMode (ADR-003) ──
export function getAppMode()          { return _appMode; }
export function setAppMode(m) {
  if (m !== 'browse' && m !== 'metadocs') return;
  _appMode = m;
  try { sessionStorage.setItem(SS_APP_MODE, m); } catch { /* silent */ }
}

// ── prevState (ESC 복귀용) ──
export function getPrevState()        { return _prevState; }
export function setPrevState(s)       { _prevState = s; }
export function clearPrevState()      { _prevState = null; }

// ── 기존 라우팅 상태 ──
export function getRightView()        { return _rightView; }
export function setRightView(v)       { _rightView = v; }

export function getDetailTab()        { return _detailTab; }
export function setDetailTab(t)       { _detailTab = t; }

export function getSelectedProject()  { return _selectedProject; }
export function setSelectedProject(p) { _selectedProject = p; }

export function getSelectedSession()  { return _selectedSession; }
export function setSelectedSession(s) { _selectedSession = s; }

export function getFeedFilterBar()    { return _feedFilterBar; }
export function setFeedFilterBar(b)   { _feedFilterBar = b; }

export function getDetailFilterBar()  { return _detailFilterBar; }
export function setDetailFilterBar(b) { _detailFilterBar = b; }
