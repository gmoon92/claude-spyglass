/**
 * features/session-detail/Chip.tsx — turn-spine chip 직렬화 leaf 컴포넌트 (P3-06)
 *
 * 원본: assets/js/session-detail/turn-views.js
 *   - fmtActionLabel (turn-views.js:109)
 *   - CHIP_ARROW_SVG / SPINE_ARROW_SVG 상수 (turn-views.js:97/100)
 *   - chipAccessibilityAttrs (turn-views.js:207)
 *   - chipHtml (turn-views.js:130) — response/group/agent/mcp/plain 6분기.
 *
 * SSoT 재사용(재구현 금지, P3-04 §2.1·§3):
 *  - chipFromRequest / chipKey  → assets/js/session-detail/turn-rows.js (P3-05 가 lib 계약으로 확정).
 *  - subTypeOf                  → assets/js/request-types.js.
 *  - 응답 ◆ 글리프 / note 글리프 / 도구 아이콘 → 이미 동치 검증된 TSX(Diamond / ToolIcon).
 *
 * 동치 게이트(P3-06 TDD):
 *  - Chip 자체는 module-private 원본(chipHtml)이 export 되지 않아 직접 oracle 이 없다.
 *  - 대신 상위 TurnSpine.tsx 가 **exported** turnLineHtml/renderSpine 를 oracle 로 삼아
 *    렌더 동치를 보증한다(turn-spine 활성 턴에 chip-flow 전체가 임베드되므로 transitive 커버).
 *
 * @module features/session-detail/Chip
 */
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Diamond } from '../../components/design-system/icons';
import { ToolIcon } from '../../components/render';
import { chipFromRequest, chipKey } from './turn-rows';
import { subTypeOf } from '../../../assets/js/request-types.js';

/** i18n 번역 함수 시그니처(react-i18next t / 레거시 window.I18n.t 공통). */
type TFn = (key: string, vars?: Record<string, unknown>) => string;

/** flow item — compressFlowWithResponses(turn-rows.js) 의 반환 요소. */
export interface FlowItem {
  kind: 'tool' | 'response';
  request?: Record<string, unknown>;
  name?: string;
  count?: number;
  isAgent?: boolean;
  agentName?: string;
  items?: Record<string, unknown>[];
  isGroup?: boolean;
  kinds?: string[];
}

/** chip-flow 안 도구→도구/도구→응답 화살표 (작은 톤). 원본 CHIP_ARROW_SVG(turn-views.js:97) 동치. */
export function ChipArrow(): ReactElement {
  return (
    <svg
      className="chip-arrow"
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 5 L7 5 M5 2.5 L7.5 5 L5 7.5"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** turn-marker → turn-marker spine 화살표 (큰 톤). 원본 SPINE_ARROW_SVG(turn-views.js:100) 동치. */
export function SpineArrow(): ReactElement {
  return (
    <svg
      className="spine-arrow"
      width={14}
      height={14}
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 5 L7 5 M5 2.5 L7.5 5 L5 7.5"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 일반 도구 칩 라벨 — count×N 패턴. 원본 fmtActionLabel(turn-views.js:109) 동치.
 *  - count<=1 → 라벨만, ≥2 → 라벨 + `<span class="count">×N</span>`.
 *  - 라벨은 React 텍스트 노드로 escape(원본 escHtml 대비 " 미escape — 시각·보안 동치).
 */
function actionLabel(label: string | undefined, count: number | undefined): ReactNode {
  const safeLabel = label || '?';
  if (!count || count <= 1) return safeLabel;
  return (
    <>
      {safeLabel}
      <span className="count">×{count}</span>
    </>
  );
}

/**
 * 칩 공통 접근성 속성 — 원본 chipAccessibilityAttrs(turn-views.js:207) 동치.
 *  - key 가 빈 문자열이면 data-chip-key 미부여(원본 동일), role/tabindex 는 유지.
 *  - aria-label = "<labelText> <suffix>" (suffix i18n).
 */
function a11yProps(key: string, labelText: string, t: TFn): Record<string, string | number> {
  const suffix = t('session.session-detail.turn-views.chip-aria-suffix');
  const aria = `${labelText} ${suffix}`;
  const base: Record<string, string | number> = { tabIndex: 0, role: 'button', 'aria-label': aria };
  if (key) base['data-chip-key'] = key;
  return base;
}

/**
 * 단일 flow item → chip 한 조각.
 * 원본 chipHtml(turn-views.js:130)의 response/group/agent/mcp/plain 분기를 1:1 이식.
 *
 * @param item    flow item
 * @param respSeq 응답 칩의 turn 내 등장 순번(1-based). 응답이 아니면 무시.
 */
export function Chip({ item, respSeq }: { item: FlowItem; respSeq: number }): ReactElement {
  const { t } = useTranslation();
  // 응답 칩 — ◆ 글리프 (turn-views.js:132-138).
  if (item.kind === 'response') {
    const meta = chipFromRequest({ ...(item.request ?? {}), type: 'response' }, respSeq);
    const key = chipKey(meta);
    const label = t('session.session-detail.turn-views.response-chip-label');
    return (
      <span className="tool-chip response-chip ds-chip" data-tone="info" title={label} {...a11yProps(key, label, t)}>
        <Diamond size={10} />
      </span>
    );
  }

  // 도구 칩 — count×N + sub-type 색상 (turn-views.js:140-196).
  const { name, count, isAgent, agentName, items, isGroup } = item;
  const baseName = (name || '').split('__').pop() ?? '';
  const sub = items && items.length ? subTypeOf(items[0]) : '';
  const subCls = sub ? ` tool-chip-${sub}` : '';
  const tone = sub || 'tool';

  // chip-key — 그룹의 첫 요소 대표 (turn-views.js:148-150).
  const firstReq = items && items[0];
  const chipMeta = firstReq ? chipFromRequest({ ...firstReq, type: 'tool_call' }, respSeq) : null;
  const key = chipKey(chipMeta);

  // 정확 점프 SSoT — 대표 request-id (turn-views.js:159).
  const targetIdProps: Record<string, string> =
    firstReq && (firstReq as { id?: string }).id
      ? { 'data-target-request-id': String((firstReq as { id?: string }).id) }
      : {};

  const countSuffix = (count ?? 0) > 1 ? `×${count}` : '';

  // NEUTRAL 윈도우 묶음 칩 (turn-views.js:164-171).
  if (isGroup) {
    const groupAria =
      (count ?? 0) > 1
        ? t('session.session-detail.turn-views.chip-group-multi', { name, count })
        : t('session.session-detail.turn-views.chip-group-single', { name, count: 1 });
    const titleText = (item.kinds || []).join(' · ');
    return (
      <span
        className="tool-chip tool-chip-group ds-chip"
        data-tone="tool"
        title={titleText}
        {...a11yProps(key, groupAria, t)}
        {...targetIdProps}
      >
        {actionLabel(name, count)}
      </span>
    );
  }

  // agent/skill/task 칩 (turn-views.js:173-182).
  if (isAgent && agentName) {
    const fullLabel = agentName + (countSuffix ? ` ${countSuffix}` : '');
    const aria = `${agentName}${countSuffix ? ' ' + countSuffix : ''}`;
    return (
      <span
        className={`tool-chip agent-chip${subCls} ds-chip`}
        data-tone={tone}
        title={fullLabel}
        {...a11yProps(key, aria, t)}
        {...targetIdProps}
      >
        <ToolIcon toolName={name} />
        <span className="agent-chip-name">{agentName}</span>
        {countSuffix ? <span className="turn-group-count"> {countSuffix}</span> : null}
      </span>
    );
  }

  // MCP 칩 (turn-views.js:187-192).
  if (sub === 'mcp') {
    const fullLabel = (name ?? '') + (countSuffix ? ` ${countSuffix}` : '');
    return (
      <span
        className={`tool-chip agent-chip${subCls} ds-chip`}
        data-tone={tone}
        title={name}
        {...a11yProps(key, fullLabel, t)}
        {...targetIdProps}
      >
        <ToolIcon toolName={name} />
        <span className="agent-chip-name">{baseName}</span>
        {countSuffix ? <span className="turn-group-count"> {countSuffix}</span> : null}
      </span>
    );
  }

  // plain 도구 칩 (turn-views.js:194-196).
  const aria = (count ?? 0) > 1 ? `${baseName} ×${count}` : baseName;
  return (
    <span className={`tool-chip${subCls} ds-chip`} data-tone={tone} {...a11yProps(key, aria, t)} {...targetIdProps}>
      {actionLabel(baseName, count)}
    </span>
  );
}
