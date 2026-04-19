// 테이블 컬럼 너비 드래그 리사이즈 + 더블클릭 Auto-fit
// Auto-fit 측정 로직은 resize-utils.js의 measureMaxWidth를 공유 (ADR-004)
import { measureMaxWidth } from './resize-utils.js';

export function initColResize(tableEl) {
  if (!tableEl) return;
  const ths  = Array.from(tableEl.querySelectorAll('thead th'));
  const cols = Array.from(tableEl.querySelectorAll('col'));

  ths.forEach((th, i) => {
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    th.appendChild(handle);

    let startX, startW;

    // 드래그 리사이즈
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startW = th.getBoundingClientRect().width;
      handle.classList.add('dragging');

      const onMove = ev => {
        const newW = Math.max(32, startW + (ev.clientX - startX));
        if (cols[i]) cols[i].style.width = newW + 'px';
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 더블클릭 Auto-fit — 해당 컬럼 셀 중 가장 긴 콘텐츠 너비에 맞춤
    handle.addEventListener('dblclick', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!cols[i] || !tableEl.tBodies[0]) return;
      const cells = [
        th,
        ...Array.from(tableEl.tBodies[0].rows).map(row => row.cells[i]),
      ].filter(Boolean);
      const maxW = measureMaxWidth(cells);
      // 셀 좌우 패딩(8px * 2) 여유
      cols[i].style.width = Math.max(32, maxW + 16) + 'px';
    });
  });
}
