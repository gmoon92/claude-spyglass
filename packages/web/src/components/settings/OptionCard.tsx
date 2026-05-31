/**
 * components/settings/OptionCard.tsx — 라디오 시뮬레이션 옵션 카드 (P2-06 공용 leaf)
 *
 * 원본: settings-view.js .settings-option-card(:432-444 hook, :729 graph, :1214 proxy — 3중복,
 *   아키텍처 §1.1). head(label + ⓘ툴팁) + desc 동일 구조.
 *   role="radio" + aria-checked 로 라디오 동작 시뮬레이션(원본 :433-434).
 *
 * 제어(controlled): active(선택 여부)는 호출처(HooksPanel useState=_selectedProfile 등)가 주입.
 *   클릭 시 onSelect(value) 통지(FilterBar controlled 선례). 원본의 명령형 클래스 토글(:506-510)은
 *   React 선언형 리렌더로 대체 — idempotent dataset.bound 가드 불필요(아키텍처 §5.5).
 *
 * data-{dataAttr}="{value}" 셀렉터 계약 보존(hook-profile / graph-mode / proxy-shell, 아키텍처 §4.2).
 *
 * P2-07 재사용: GraphPanel(graph-mode 3카드) / ProxyPanel(proxy-shell).
 *
 * @module components/settings/OptionCard
 */
import { TooltipHost } from './TooltipHost';

export interface OptionCardProps {
  /** data-* 속성 접미사(예: 'hook-profile' / 'graph-mode' / 'proxy-shell'). 셀렉터 계약. */
  dataAttr: string;
  /** 옵션 값 — data-{dataAttr}="{value}". */
  value: string;
  /** 선택 여부(controlled) — is-active + aria-checked. */
  active: boolean;
  /** 카드 라벨. */
  label: string;
  /** 1줄 설명. */
  desc: string;
  /** ⓘ 호버 툴팁 텍스트. */
  tooltip: string;
  /** 선택 통지 — 호출처가 useState 갱신(원본 명령형 토글 대체). */
  onSelect?: (value: string) => void;
}

export function OptionCard({ dataAttr, value, active, label, desc, tooltip, onSelect }: OptionCardProps) {
  return (
    <button
      type="button"
      className={`settings-option-card${active ? ' is-active' : ''}`}
      role="radio"
      aria-checked={active ? 'true' : 'false'}
      {...{ [`data-${dataAttr}`]: value }}
      onClick={() => onSelect?.(value)}
    >
      <span className="settings-option-card-head">
        <span className="settings-option-card-label">{label}</span>
        <TooltipHost text={tooltip} />
      </span>
      <span className="settings-option-card-desc">{desc}</span>
    </button>
  );
}
