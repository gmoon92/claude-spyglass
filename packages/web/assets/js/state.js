// state.js — 라우팅/뷰 상태 SSoT (ADR-003 라우팅 로직 단순화 + ADR-003 left-rail-meta-docs)
//
// 앱 모드 (ADR-003 left-rail-meta-docs + settings-page 2026-05-26):
//   - 'browse'   : 기본. 좌측 패널(프로젝트/세션/obs) + 우측 default/detail-view 정상 동작.
//   - 'metadocs' : 메인 영역 전체가 Behavior Definitions 카탈로그. 좌측은 축약 패널(프로젝트 + 요약 카드).
//   - 'settings' : 메인 영역 전체가 진단/Hook/Graph DB/Proxy 설정 패널. 좌측은 sub-tab 메뉴.
//   - sessionStorage('spyglass.appMode') 영속화 — 새로고침 시 마지막 모드 복원.
//   - _prevState: 'metadocs'/'settings' 진입 직전의 browse 스냅샷(view/tab/sessionId). ESC 복귀용.

const SS_APP_MODE     = 'spyglass.appMode';
const SS_META_SUB_TAB = 'spyglass.metaSubTab'; // ADR-004 meta-docs-tool-stats

let _appMode          = 'browse';
// meta-docs-flow ego-graph (2026-05-21 rev): 'flow' 서브 탭 폐기, 메타 문서 탭 상단 영역으로 흡수.
// 'docs' | 'tools' 2-way만 유효. 과거 'flow' 값이 sessionStorage에 남아 있으면 'docs'로 폴백.
let _metaSubTab       = 'docs';        // 'docs' | 'tools' (ADR-004 meta-docs-tool-stats)
let _prevState        = null;          // { rightView, detailTab, sessionId } | null
let _rightView        = 'default';
// ADR-turn-view-revamp-004: '턴 뷰' + '요청' 두 탭을 단일 '로그' 탭으로 통합.
// 'log'는 turn-spine(상단) + log-pane(하단 표) 한 패널로 노출되는 단일 detail 모드.
// 'llm' / 'syslib'은 기존 그대로 — deeplink·sub-filter 자동 전환에서 계속 사용.
let _detailTab        = 'log';
let _selectedProject  = null;
let _selectedSession  = null;
let _feedFilterBar    = null;
let _detailFilterBar  = null;

// sessionStorage 복원 — 모듈 로드 시 1회. 실패 시(접근 거부 등) 기본값 유지.
try {
  const saved = sessionStorage.getItem(SS_APP_MODE);
  if (saved === 'browse' || saved === 'metadocs' || saved === 'settings') _appMode = saved;
  const savedSub = sessionStorage.getItem(SS_META_SUB_TAB);
  if (savedSub === 'docs' || savedSub === 'tools') _metaSubTab = savedSub;
} catch { /* sessionStorage 미지원/거부 시 silent fallback */ }

// ── appMode (ADR-003 + settings-page) ──
export function getAppMode()          { return _appMode; }
export function setAppMode(m) {
  if (m !== 'browse' && m !== 'metadocs' && m !== 'settings') return;
  _appMode = m;
  try { sessionStorage.setItem(SS_APP_MODE, m); } catch { /* silent */ }
}

// ── meta sub-tab (ADR-004 meta-docs-tool-stats) ──
//   'docs'  : 메타 문서 카탈로그 + 상단 ego-flow 영역 (기본)
//   'tools' : 프로젝트 단위 도구별 성능 매트릭스
//   sessionStorage 영속화 — 새로고침 시 마지막 서브 탭 복원. metadocs 모드에서만 의미 있음.
//   meta-docs-flow ego-graph (2026-05-21 rev): 별도 'flow' 탭 폐기.
//     흐름은 'docs' 탭 상단 영역(#metaDocsFlowRegion)에서 표 첫 행 기준으로 자동 렌더된다.
export function getMetaSubTab()       { return _metaSubTab; }
export function setMetaSubTab(t) {
  if (t !== 'docs' && t !== 'tools') return;
  _metaSubTab = t;
  try { sessionStorage.setItem(SS_META_SUB_TAB, t); } catch { /* silent */ }
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
