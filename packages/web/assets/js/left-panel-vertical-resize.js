// 좌측 패널 프로젝트/세션 섹션 상하 분할 핸들 — 드래그 + localStorage 비율 저장
// ADR-002: CSS 변수 --projects-panel-height px 갱신, 저장은 비율(0..1)로 → 화면 크기 무관
// ADR패턴: panel-resize.js 동일 설계 원칙 (CSS 변수 + spyglass: prefix localStorage)

const STORAGE_KEY        = 'spyglass:panel-split';
const STORAGE_KEY_BOTTOM = 'spyglass:panel-split-bottom';
const MIN_PX             = 80;  // 각 섹션 최소 높이

/**
 * 비율(0..1)을 읽어 topEl 실제 높이(px)를 지정된 CSS 변수에 적용.
 * 가용 높이 = topEl + bottomEl의 현재 합산.
 */
function applyRatioCssVar(ratio, topEl, bottomEl, cssVar) {
  const available = topEl.getBoundingClientRect().height
    + bottomEl.getBoundingClientRect().height;
  if (available <= 0) return;

  const clamped = Math.max(MIN_PX, Math.min(available - MIN_PX, ratio * available));
  document.documentElement.style.setProperty(cssVar, clamped + 'px');
}

/**
 * 두 섹션 요소의 현재 높이 비율을 반환 (저장 단위).
 * 렌더 이후 DOM 크기를 읽으므로 항상 최신 비율.
 */
function currentRatio(topEl, bottomEl) {
  const topH  = topEl.getBoundingClientRect().height;
  const total = topH + bottomEl.getBoundingClientRect().height;
  return total > 0 ? topH / total : 0.35;
}

/**
 * 공통 드래그 핸들 초기화.
 *
 * @param {HTMLElement} handleEl  — .panel-vertical-handle 드래그 요소
 * @param {HTMLElement} topEl     — 위쪽 섹션
 * @param {HTMLElement} bottomEl  — 아래쪽 섹션
 * @param {string}      cssVar    — 갱신할 CSS 변수명 (e.g. '--projects-panel-height')
 * @param {string}      storageKey — localStorage 키
 */
function initResize(handleEl, topEl, bottomEl, cssVar, storageKey) {
  if (!handleEl || !topEl || !bottomEl) return;

  // 저장된 비율 복원 — rAF로 DOM 크기가 확정된 뒤 적용
  const saved = localStorage.getItem(storageKey);
  if (saved != null) {
    const ratio = parseFloat(saved);
    if (Number.isFinite(ratio) && ratio > 0 && ratio < 1) {
      requestAnimationFrame(() => applyRatioCssVar(ratio, topEl, bottomEl, cssVar));
    }
  }

  handleEl.addEventListener('mousedown', e => {
    e.preventDefault();

    const startY    = e.clientY;
    const startTopH = topEl.getBoundingClientRect().height;
    const available = startTopH + bottomEl.getBoundingClientRect().height;

    document.body.style.userSelect = 'none';
    handleEl.classList.add('dragging');

    const onMove = ev => {
      const delta   = ev.clientY - startY;
      const newTopH = startTopH + delta;
      const ratio   = newTopH / available;
      applyRatioCssVar(ratio, topEl, bottomEl, cssVar);
    };

    const onUp = () => {
      document.body.style.userSelect = '';
      handleEl.classList.remove('dragging');
      localStorage.setItem(storageKey, currentRatio(topEl, bottomEl));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/**
 * initPanelVerticalResize(handleEl, topEl, bottomEl)
 * 프로젝트 섹션 / 세션 섹션 상하 분할.
 *
 * @param {HTMLElement} handleEl   — .panel-vertical-handle 드래그 요소
 * @param {HTMLElement} topEl      — 프로젝트 패널 섹션
 * @param {HTMLElement} bottomEl   — 세션 패널 섹션
 */
export function initPanelVerticalResize(handleEl, topEl, bottomEl) {
  initResize(handleEl, topEl, bottomEl, '--projects-panel-height', STORAGE_KEY);
}

/**
 * initPanelBottomResize(handleEl, topEl, bottomEl)
 * 세션 섹션 / 옵저빌리티(Tool Categories) 섹션 상하 분할.
 *
 * @param {HTMLElement} handleEl   — .panel-vertical-handle 드래그 요소
 * @param {HTMLElement} topEl      — 세션 패널 섹션
 * @param {HTMLElement} bottomEl   — panelTools(obs-panel) 섹션
 */
export function initPanelBottomResize(handleEl, topEl, bottomEl) {
  initResize(handleEl, topEl, bottomEl, '--sessions-panel-height', STORAGE_KEY_BOTTOM);
}
