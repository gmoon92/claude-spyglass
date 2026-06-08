/**
 * render/ContextPreview.tsx — 메시지/프롬프트 미리보기 React 컴포넌트 (B-2)
 *
 * 원본: assets/js/render/extract(contextPreview HTML-string producer).
 *   `<span class="prompt-preview" data-expand-id title>display…<span class="tool-response-hint">hint</span></span>`.
 *
 * 정공법(SSoT 이중화 금지):
 *  - 텍스트/툴팁/힌트/_promptCache 계산은 extract.ts#contextPreviewData(순수+캐시 SSoT) 단독.
 *  - 라벨(힌트·char-count)은 useTranslation 의 t — 원본 window.I18n.t 와 동일 키.
 *  - 마크업(span class·data-expand-id·title·tool-response-hint) 1:1 재현.
 *
 * @module render/ContextPreview
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { contextPreviewData, type ContextPreviewData } from './extract';
import type { RowTextReader } from '../../lib/view-types';

interface ContextPreviewProps {
  /** 행 데이터(미지정 시 data 직접 주입). */
  r?: RowTextReader;
  maxLen?: number;
  /**
   * 사전 계산 데이터 직접 주입 — 호출 측이 빈 여부(null)를 판단하려고 이미 contextPreviewData 를
   * 호출했을 때 중복 호출(중복 _promptCache write)을 피하려는 경로. r 보다 우선.
   */
  data?: ContextPreviewData | null;
}

/**
 * 미리보기 span. 표시할 텍스트 없으면 null(호출 측이 빈 셀 처리).
 *  - 원본은 display 뒤에 ' '(공백) + hint span 을 텍스트로 두었다 — JSX 도 동일하게 공백 텍스트 노드 유지.
 */
export function ContextPreview({ r, maxLen = 60, data: dataProp }: ContextPreviewProps): ReactElement | null {
  const { t } = useTranslation();
  // data prop 우선(중복 캐시 write 회피), 없으면 r 로 계산.
  const data = dataProp !== undefined ? dataProp : r ? contextPreviewData(r, maxLen) : null;
  if (!data) return null;

  const tooltip = data.tooltipTruncated
    ? `${data.tooltipBase}… (${t('badges:renderers.extract.chars', { n: data.rawLength.toLocaleString() })})`
    : data.tooltipBase;

  const hintText = data.hint ? t(data.hint.key, data.hint.vars) : '';

  return (
    <span className="prompt-preview" data-expand-id={data.expandId} data-tip={tooltip}>
      {data.display}
      {data.ellipsis ? '…' : ''}
      {hintText ? (
        <>
          {' '}
          <span className="tool-response-hint">{hintText}</span>
        </>
      ) : null}
    </span>
  );
}
