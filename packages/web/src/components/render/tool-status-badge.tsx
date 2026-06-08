/**
 * render/tool-status-badge.tsx — tool 상태(오류) 배지 React 컴포넌트 (B-2)
 *
 * 원본: assets/js/render/badges.js#toolStatusBadge (오류만 표시 — Signal over Noise).
 *
 * 정공법(SSoT 이중화 금지):
 *  - 오류 판정은 lib/tool-response-field.ts#toolHasError(순수 SSoT) 단독.
 *  - 라벨은 useTranslation 의 t('badges:renderers.tool-status.error') — 원본 window.I18n.t 와 동일 키.
 *  - 마크업(span class/data-tone) 1:1 재현.
 *
 * @module render/tool-status-badge
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { toolHasError } from '../../lib/tool-response-field';

interface RowLike {
  payload?: unknown;
  tool_name?: string | null;
}

/** 오류 배지 — tool_response 에 오류 없으면 null(원본 빈 문자열 동치). */
export function ToolStatusBadge({ r }: { r: RowLike }): ReactElement | null {
  const { t } = useTranslation();
  if (!toolHasError(r)) return null;
  return (
    <span className="mini-badge badge-error ds-badge" data-tone="error">
      {t('badges:renderers.tool-status.error')}
    </span>
  );
}
