/**
 * render/PromptExpandRow.tsx — 프롬프트/메시지 펼침 행 React 대응물.
 *
 * 원본: assets/js/render/expand.ts#togglePromptExpand (table 모드 분기) — 클릭한 행 바로 아래에
 *   `<tr class="prompt-expand-row" data-expand-for={rid}>` 를 삽입해 본문 전체를 노출한다.
 *
 * 전략(레거시 1:1):
 *  - 본문 텍스트는 재추출하지 않는다. 원본과 동일하게 `_promptCache.get(rid)` 를 읽는다 —
 *    캐시는 contextPreview(r)(RequestRow 가 msg 셀 렌더 시 호출) 가 채운다(SSoT, 재구현 금지).
 *  - 캐시 항목 형태에 따라 두 모드:
 *      string                          → 텍스트 모드. escHtml + <pre class="prompt-expand-content">.
 *      { kind:'html', html }           → HTML 모드. <div class="prompt-expand-content">{html}.
 *    복사 버튼은 두 모드 공통(다음 형제 .prompt-expand-content 의 textContent 복사).
 *  - 복사 버튼 onclick / i18n 키(ui.main.expand.copy|copied) 도 원본과 동일.
 *  - React-idiomatic: 펼침 여부는 RequestRow 로컬 useState 가 관리하고, 이 컴포넌트는
 *    "열려 있을 때" 만 마운트되는 `<tr>` 한 줄을 반환한다(원본의 명령형 insert/remove 대체).
 *
 * @module render/PromptExpandRow
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { escHtml } from '../../../assets/js/formatters.js';
import { _promptCache } from '../../../assets/js/render/extract.js';

/**
 * 펼침 행 — 원본 expand.ts#togglePromptExpand 의 table 모드 출력(boxHtml 포함)과 동치.
 *
 * @param rid   펼칠 record id (data-expand-for 와 매칭, 원본 dataset.expandFor 동일).
 * @param cols  expand td colspan (원본 RECENT_REQ_COLS=10 — feed 뷰 컬럼 수).
 */
export function PromptExpandRow({ rid, cols }: { rid: string; cols: number }): ReactElement {
  const { t } = useTranslation();
  const cached = _promptCache.get(rid);
  const isHtmlMode =
    !!cached && typeof cached === 'object' && cached.kind === 'html' && typeof cached.html === 'string';

  // 본문 — 원본과 동일 클래스/스타일. HTML 모드는 신뢰된 캐시 html 을 그대로(원본 동일).
  const contentHtml = isHtmlMode
    ? `<div class="prompt-expand-content">${(cached as { html: string }).html}</div>`
    : `<pre class="prompt-expand-content" style="margin:0;white-space:pre-wrap;word-break:break-all">${escHtml(typeof cached === 'string' ? cached : '')}</pre>`;

  // 복사 버튼 + 본문 박스 — 원본 boxHtml 1:1 (onclick 인라인·i18n 키 동일).
  const copyLabel = t('ui.main.expand.copy');
  const copiedLabel = t('ui.main.expand.copied');
  const boxHtml =
    `<div class="prompt-expand-box"><button class="expand-copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.textContent).then(()=>{this.textContent='${escHtml(copiedLabel)}';setTimeout(()=>{this.textContent='${escHtml(copyLabel)}'},1500)})">${escHtml(copyLabel)}</button>${contentHtml}</div>`;

  return (
    <tr className="prompt-expand-row" data-expand-for={rid}>
      <td colSpan={cols} dangerouslySetInnerHTML={{ __html: boxHtml }} />
    </tr>
  );
}
