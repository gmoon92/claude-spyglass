/**
 * render/PromptExpandRow.tsx — 프롬프트/메시지 펼침 행 React 대응물.
 *
 * 원본: assets/js/render/expand.ts#togglePromptExpand (table 모드 분기) — 클릭한 행 바로 아래에
 *   `<tr class="prompt-expand-row" data-expand-for={rid}>` 를 삽입해 본문 전체를 노출한다.
 *
 * 전략(B-2: dangerouslySetInnerHTML 제거 + 레거시 마크업 동치):
 *  - 본문 텍스트는 재추출하지 않는다. 원본과 동일하게 `_promptCache.get(rid)` 를 읽는다 —
 *    캐시는 contextPreviewData(r)(ContextPreview 가 msg 셀 렌더 시 호출) 가 채운다(SSoT, 재구현 금지).
 *  - 캐시 항목 형태에 따라 두 모드:
 *      string                          → 텍스트 모드. <pre class="prompt-expand-content">{text}.
 *      { kind:'askq', questions }       → 구조화 모드. AskUserQuestionCard(JSX) 를 div 안에 렌더.
 *  - 복사 버튼: 원본 인라인 onclick(navigator.clipboard) 을 React onClick + ref 로 대체 —
 *    nextElementSibling.textContent(=본문 박스 textContent) 복사 + 1.5s "copied" 토글 동치.
 *  - React-idiomatic: 펼침 여부는 RequestRow 로컬 useState 가 관리하고, 이 컴포넌트는
 *    "열려 있을 때" 만 마운트되는 `<tr>` 한 줄을 반환한다(원본의 명령형 insert/remove 대체).
 *
 * @module render/PromptExpandRow
 */
import { useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { _promptCache, type AskQuestion } from './extract';
import { AskUserQuestionCard } from './AskUserQuestionCard';

/**
 * 펼침 행 — 원본 expand.ts#togglePromptExpand 의 table 모드 출력(boxHtml 포함)과 동치.
 *
 * @param rid   펼칠 record id (data-expand-for 와 매칭, 원본 dataset.expandFor 동일).
 * @param cols  expand td colspan (원본 RECENT_REQ_COLS=10 — feed 뷰 컬럼 수).
 */
export function PromptExpandRow({ rid, cols }: { rid: string; cols: number }): ReactElement {
  const { t } = useTranslation();
  const cached = _promptCache.get(rid);
  const isAskq =
    !!cached && typeof cached === 'object' && cached.kind === 'askq' && Array.isArray(cached.questions);

  const copyLabel = t('ui:main.expand.copy');
  const copiedLabel = t('ui:main.expand.copied');

  // 복사 버튼 — 원본은 this.nextElementSibling.textContent 를 복사했다. React 는 본문 박스에 ref 를 달아
  //   동일하게 textContent 를 읽는다(텍스트/구조화 모드 공통, AskUserQuestionCard 의 가시 텍스트 포함).
  const contentRef = useRef<HTMLElement | null>(null);
  const [label, setLabel] = useState(copyLabel);
  const onCopy = (): void => {
    const text = contentRef.current?.textContent ?? '';
    void navigator.clipboard.writeText(text).then(() => {
      setLabel(copiedLabel);
      setTimeout(() => setLabel(copyLabel), 1500);
    });
  };

  return (
    <tr className="prompt-expand-row" data-expand-for={rid}>
      <td colSpan={cols}>
        <div className="prompt-expand-box">
          <button className="expand-copy-btn" onClick={onCopy}>
            {label}
          </button>
          {isAskq ? (
            <div
              className="prompt-expand-content"
              ref={(el) => {
                contentRef.current = el;
              }}
            >
              <AskUserQuestionCard questions={(cached as { questions: AskQuestion[] }).questions} />
            </div>
          ) : (
            <pre
              className="prompt-expand-content"
              style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
              ref={(el) => {
                contentRef.current = el;
              }}
            >
              {typeof cached === 'string' ? cached : ''}
            </pre>
          )}
        </div>
      </td>
    </tr>
  );
}
