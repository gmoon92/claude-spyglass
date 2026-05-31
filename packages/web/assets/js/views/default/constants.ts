// views/default/constants.js — DefaultView 모듈 공유 상수
//
// 변경 이유: localStorage 네임스페이스, KBD 모달 DOM id, timeline-meta 라벨
// 매핑처럼 "여러 모듈이 동시에 같은 값을 참조해야 하는" 상수만 둔다.
// 단일 모듈 내부 상수(예: feed-live의 200행 cap, 600ms flash)는 해당 파일
// 상단에 둔다 — 이쪽으로 끌어오지 마라.

export const STORAGE_KEY         = 'spyglass:lastProject';
export const CHART_COLLAPSED_KEY = 'spyglass:chart-collapsed';
export const PANEL_HIDDEN_KEY    = 'spyglass:left-panel-hidden';
export const KBD_HELP_BACKDROP_ID = 'kbdHelpBackdrop';

// ── chart-section-filter-sync ADR-001/003 + date-range-filter ADR-007 ──────
// timeline-meta 두 그룹 라벨의 SSoT (default 모드 전용).
// date-filter ↔ timeline-meta 라벨 매핑은 RANGE_LABELS 한 곳에서만 관리하고,
// 호출처는 applyRangeLabels(range) 한 함수만 호출한다.
// SSoT 통합 (ADR-007): ui.main.date-filter.<key>.label을 직접 참조 — 이중 트리 폐기.
export const RANGE_LABELS = {
  get '1h'()       { return window.I18n.t('ui.main.date-filter.1h.label'); },
  get today()      { return window.I18n.t('ui.main.date-filter.today.label'); },
  get yesterday()  { return window.I18n.t('ui.main.date-filter.yesterday.label'); },
  get '7d'()       { return window.I18n.t('ui.main.date-filter.7d.label'); },
  get '30d'()      { return window.I18n.t('ui.main.date-filter.30d.label'); },
  get custom()     { return window.I18n.t('ui.main.date-filter.custom.label'); },
  get all()        { return window.I18n.t('ui.main.date-filter.all.label'); },
};

// 그룹 본질(고정 정체성) — DOM 순서 기반 매핑.
// idx 0: 품질 그룹 (평균 · P95 · 오류율)
// idx 1: 누적 볼륨 그룹 (세션 · 요청 · 토큰)
export const TIMELINE_META_PREFIXES = {
  get 0() { return window.I18n.t('ui.default-view.timeline-meta.prefix-quality'); },
  get 1() { return window.I18n.t('ui.default-view.timeline-meta.prefix-volume'); },
};
export const TIMELINE_META_ARIA_PREFIXES = {
  get 0() { return window.I18n.t('ui.default-view.timeline-meta.aria-quality'); },
  get 1() { return window.I18n.t('ui.default-view.timeline-meta.aria-volume'); },
};
