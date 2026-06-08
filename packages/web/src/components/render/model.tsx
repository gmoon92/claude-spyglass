/**
 * render/model.tsx — 모델 칩/셀 React 대응물 (P2-04)
 *
 * 원본: assets/js/render/model.js (modelChipHtml / makeModelCell).
 *
 * 전략:
 *  - 분류·라벨 SSoT(modelClassOf / modelChipLabel / trustOf / rowTrustClass)는 원본 JS 를
 *    그대로 재사용(import) — 재구현 금지. 칩/셀의 HTML 구조만 JSX 로 이식.
 *  - i18n 라벨(모델불명·SDK 합성)도 원본 modelChipLabel 경유 → window.I18n.t 동일 결과.
 *
 * @module render/model
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
// SSoT 재사용 — 분류/라벨/신뢰도 판정 로직은 원본 JS 단일 출처.
import { modelClassOf, modelChipLabel } from './model-classify';

interface RowLike {
  model?: string | null;
  type?: string | null;
  tokens_source?: string | null;
}

/**
 * 모델 칩 — 원본 model.js#modelChipHtml 의 마크업 1:1.
 *  title 은 r.model || 'badges:renderers.model.no-info'.
 */
export function ModelChip({ r, mini = false }: { r: RowLike; mini?: boolean }): ReactElement {
  const { t } = useTranslation();
  const cls = modelClassOf(r?.model ?? null);
  const label = modelChipLabel(r?.model ?? null, cls);
  const title = r?.model || t('badges:renderers.model.no-info');
  const sizeCls = mini ? ' model-chip-mini' : '';
  return (
    <span className={`model-chip model-chip-${cls}${sizeCls} ds-chip`} data-tone={cls} data-tip={title}>
      {label}
    </span>
  );
}

/**
 * 모델 셀 — 원본 model.js#makeModelCell.
 *  model 없으면 cell-empty + '—', 있으면 ModelChip.
 */
export function ModelCell({ r }: { r: RowLike }): ReactElement {
  if (!r?.model) {
    return (
      <td className="cell-model cell-empty" data-cell="model">
        —
      </td>
    );
  }
  return (
    <td className="cell-model" data-cell="model">
      <ModelChip r={r} />
    </td>
  );
}
