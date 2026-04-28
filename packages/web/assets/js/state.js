// state.js — 라우팅/뷰 상태 SSoT (ADR-003 라우팅 로직 단순화)

let _rightView       = 'default';
let _detailTab       = 'flat';
let _selectedProject = null;
let _selectedSession = null;

export function getRightView()        { return _rightView; }
export function setRightView(v)       { _rightView = v; }

export function getDetailTab()        { return _detailTab; }
export function setDetailTab(t)       { _detailTab = t; }

export function getSelectedProject()  { return _selectedProject; }
export function setSelectedProject(p) { _selectedProject = p; }

export function getSelectedSession()  { return _selectedSession; }
export function setSelectedSession(s) { _selectedSession = s; }
