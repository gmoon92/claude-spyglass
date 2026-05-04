/**
 * session-detail/state.js — 세션 상세 뷰의 모듈 수준 상태를 단일 캡슐화한다.
 *
 * 책임:
 *  - 모든 뮤터블 상태(필터/요청·턴 목록/검색어/펼침 ID/검색 박스 인스턴스/필터링 결과)를 한 모듈에 집중.
 *  - 외부 모듈은 반드시 명시적 getter/setter를 통해서만 접근 (캡슐화).
 *  - 자바의 private 필드 + getter/setter 패턴을 모방. 직접 export하지 않는다.
 *
 * 호출자: turn-views, flat-view, index (facade)
 * 의존성: 없음 (순수 상태 보관)
 */

// =============================================================================
// 필터/세션/검색 (1차 입력)
// =============================================================================

let _detailFilter      = 'all';
let _currentSessionId  = null;
let _detailAllRequests = [];
let _detailAllTurns    = [];
let _detailSearchQuery = '';
let _expandedTurnIds   = new Set();
let _detailSearchBox   = null;

// =============================================================================
// 처리 결과 캐시 (2차 — applyDetailFilter가 채우고 리스너가 읽음)
// =============================================================================

let _flatFiltered    = [];
let _flatAnomalyMap  = new Map();
let _turnFiltered    = [];
let _detailTurnAnomalyMap = new Map();

// =============================================================================
// v22 system_prompts 카탈로그 카운트 (T-11 ADR-004 옵션 D)
//  - 평면 뷰 필터 라벨의 system(N) — N = distinct system_hash (proxy_requests 카탈로그)
//  - loadSessionDetail / refreshDetailSession에서 GET /api/system-prompts 결과 size로 갱신
//  - 0이면 카탈로그 비어있음(서버 재시작 직후 또는 v22 미적용 행만)
// =============================================================================
let _systemHashCount = 0;

// ADR-001 P1: turn에 묶이지 않은 행 (session-prologue). 비면 UI 안 그림.
let _detailPrologue = [];

// =============================================================================
// 1차 입력 — getter/setter
// =============================================================================

export function getDetailFilter()       { return _detailFilter; }
export function setDetailFilter(f)      { _detailFilter = f; }
export function getCurrentSessionId()   { return _currentSessionId; }
export function setCurrentSessionId(id) { _currentSessionId = id; }
export function getDetailRequests()     { return _detailAllRequests; }
export function setDetailRequests(reqs) { _detailAllRequests = reqs; }
export function getDetailTurns()        { return _detailAllTurns; }
export function setDetailTurns(turns)   { _detailAllTurns = turns; }
export function getDetailPrologue()     { return _detailPrologue; }
export function setDetailPrologue(rows) { _detailPrologue = Array.isArray(rows) ? rows : []; }
export function getSearchQuery()        { return _detailSearchQuery; }
export function setSearchQuery(q)       { _detailSearchQuery = q; }
export function getExpandedTurnIds()    { return _expandedTurnIds; }
export function clearExpandedTurnIds()  { _expandedTurnIds.clear(); }
export function getSearchBox()          { return _detailSearchBox; }
export function setSearchBox(box)       { _detailSearchBox = box; }

// =============================================================================
// 2차 처리 결과 — getter/setter
// =============================================================================

export function getFlatFiltered()         { return _flatFiltered; }
export function setFlatFiltered(list)     { _flatFiltered = list; }
export function getFlatAnomalyMap()       { return _flatAnomalyMap; }
export function setFlatAnomalyMap(map)    { _flatAnomalyMap = map; }
export function getTurnFiltered()         { return _turnFiltered; }
export function setTurnFiltered(list)     { _turnFiltered = list; }
export function getTurnAnomalyMap()       { return _detailTurnAnomalyMap; }
export function setTurnAnomalyMap(map)    { _detailTurnAnomalyMap = map; }
export function getSystemHashCount()      { return _systemHashCount; }
export function setSystemHashCount(n)     { _systemHashCount = (typeof n === 'number' && n >= 0) ? n : 0; }
