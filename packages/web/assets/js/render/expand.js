// 펼침/expand 인터랙션 — 행/박스 토글, 복사 버튼.
//
// 변경 이유: 펼침 UX 정책(table/grid 모드, 복사 동작, 텍스트/HTML 모드 분기) 변경 시 묶여서 손이 가는 묶음.

import { escHtml } from '../formatters.js';
import { _promptCache } from './extract.js';

export const FLAT_VIEW_COLS  = 9;  // Time Action Target Model Message in out Cache Duration
export const RECENT_REQ_COLS = 10; // + Session

/**
 * 펼침 행/박스를 토글한다 (web-design-balance-pass ADR-004).
 *
 * _promptCache 항목 형태에 따라 두 모드로 렌더:
 *  - string                          → 텍스트 모드 (기본). escHtml + <pre>로 안전 렌더.
 *  - { kind: 'html', html: string }  → HTML 모드. AskUserQuestion 등 구조화 데이터를 그대로 노출.
 *
 * 두 모드 모두 복사 버튼은 동일하게 동작 — 다음 형제(.prompt-expand-content)의
 * textContent를 클립보드로 복사하므로 HTML/텍스트 무관.
 *
 * @param {string} rid        펼칠 record id (data-expand-id와 매칭).
 * @param {HTMLElement} container  소스 요소(.prompt-preview)의 컨테이너 (tr 또는 div).
 * @param {number} [cols]     테이블 모드 폴백 colspan.
 */
export function togglePromptExpand(rid, container, cols) {
  document.querySelectorAll('[data-expand-for]').forEach(el => el.remove());
  if (container.dataset.expanded === rid) { delete container.dataset.expanded; return; }
  container.dataset.expanded = rid;

  const cached = _promptCache.get(rid);
  const isHtmlMode = cached && typeof cached === 'object' && cached.kind === 'html'
    && typeof cached.html === 'string';

  // 본문 영역 — HTML/텍스트 모드 모두 .prompt-expand-content로 통일하여
  // 복사 버튼이 동일한 next sibling 참조를 쓰도록 한다 (textContent 복사로 양쪽 동작).
  const contentHtml = isHtmlMode
    ? `<div class="prompt-expand-content">${cached.html}</div>`
    : `<pre class="prompt-expand-content" style="margin:0;white-space:pre-wrap;word-break:break-all">${escHtml(typeof cached === 'string' ? cached : '')}</pre>`;
  const boxHtml = `<div class="prompt-expand-box"><button class="expand-copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.textContent).then(()=>{this.textContent='✓복사됨';setTimeout(()=>{this.textContent='복사'},1500)})">복사</button>${contentHtml}</div>`;

  if (container.closest('table')) {
    const colCount  = cols ?? container.closest('table')?.querySelector('thead tr')?.children?.length ?? FLAT_VIEW_COLS;
    const expandTr  = document.createElement('tr');
    expandTr.dataset.expandFor = rid;
    expandTr.className = 'prompt-expand-row';
    expandTr.innerHTML = `<td colspan="${colCount}">${boxHtml}</td>`;
    container.after(expandTr);
  } else {
    const expandDiv = document.createElement('div');
    expandDiv.dataset.expandFor = rid;
    expandDiv.style.cssText = 'grid-column:1/-1;border-bottom:1px solid var(--border);padding:0;';
    expandDiv.innerHTML = boxHtml;
    container.after(expandDiv);
  }
}
