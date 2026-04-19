// 왼쪽 패널 너비 리사이즈 — 드래그 + 더블클릭 Auto-fit
// ADR-001: CSS 변수 방식 / ADR-002: 신규 파일 분리 / ADR-003: scrollWidth 측정
import { measureMaxWidth } from './resize-utils.js';

const STORAGE_KEY = 'spyglass:panel-width';

function getMinMax() {
  const style = getComputedStyle(document.documentElement);
  return {
    min: parseInt(style.getPropertyValue('--panel-resize-min')) || 180,
    max: parseInt(style.getPropertyValue('--panel-resize-max')) || 480,
  };
}

function setPanelWidth(px) {
  const { min, max } = getMinMax();
  const clamped = Math.max(min, Math.min(max, px));
  document.documentElement.style.setProperty('--left-panel-width', clamped + 'px');
  return clamped;
}

export function initPanelResize(panelEl, handleEl) {
  // 저장된 너비 복원
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) setPanelWidth(parseInt(saved, 10));

  // 드래그 리사이즈
  handleEl.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelEl.getBoundingClientRect().width;
    document.body.style.userSelect = 'none';
    handleEl.classList.add('dragging');

    const onMove = ev => setPanelWidth(startW + (ev.clientX - startX));

    const onUp = () => {
      document.body.style.userSelect = '';
      handleEl.classList.remove('dragging');
      localStorage.setItem(STORAGE_KEY, panelEl.getBoundingClientRect().width);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // 더블클릭 Auto-fit — 패널 내 가장 긴 콘텐츠 너비에 맞춤
  handleEl.addEventListener('dblclick', e => {
    e.preventDefault();
    // 콘텐츠 측정 대상: 셀, 세션 미리보기, 툴명 등 텍스트 요소
    const targets = panelEl.querySelectorAll('td, .sess-row-preview, .tool-main, .panel-label');
    const maxW = measureMaxWidth(targets);
    // 패널 좌우 패딩(12px * 2) + 핸들 너비(4px) 여유
    const fitted = setPanelWidth(maxW + 28);
    localStorage.setItem(STORAGE_KEY, fitted);
  });
}
