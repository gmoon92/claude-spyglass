/**
 * render/badges.tsx — 배지·도구 아이콘 React 대응물 (P2-04)
 *
 * 원본: assets/js/render/badges.js (typeBadge / toolIconHtml / anomalyBadgesHtml ...).
 *
 * 전략(D형 골든마스터 — renderers.test.ts.snap 동치):
 *  - 출력 HTML 구조(class·data-tone·title·aria-label·텍스트)를 원본 문자열과 **동치**로 유지.
 *  - SVG 글리프는 이미 동치 검증된 TSX 아이콘(design-system/icons)을 재사용 — 재구현 금지.
 *  - 라벨/분기 판정은 원본 SSoT(typeBadge tone map, toolIconHtml 접두사 라우팅)를 1:1 이식.
 *  - 동치는 renderers-equivalence.test.tsx 가 renderToStaticMarkup ↔ 원본 js 문자열을
 *    정규화(self-close 통일 + 공백 축약 + 엔티티 디코드) 비교로 보증.
 *
 * 병존 원칙: 원본 badges.js 는 무수정. 소비처 전환은 후속 단계.
 *
 * @module render/badges
 */
import type { ReactElement } from 'react';
import { SkillDot, McpDot, AgentDot, ToolDot } from '../design-system/icons';

/**
 * 타입 배지 — prompt / tool_call / system / response / unknown.
 * 원본 badges.js#typeBadge 의 tone map·라벨 분기 1:1.
 */
export function TypeBadge({ type }: { type: string | null | undefined }): ReactElement {
  const known = ['prompt', 'tool_call', 'system', 'response'];
  const t = type ?? '';
  const cls = known.includes(t) ? t : 'unknown';
  const label = known.includes(t) ? t : t || '?';
  const toneMap: Record<string, string> = {
    prompt: 'brand',
    tool_call: 'success',
    system: 'warn',
    response: 'info',
  };
  const tone = toneMap[t] ?? 'neutral';
  // 원본은 title/aria-label 에 escHtml(type) — React 자동 이스케이프로 동치(정규화에서 엔티티 디코드).
  return (
    <span className={`type-badge type-${cls} ds-badge`} data-tone={tone} title={t} aria-label={t}>
      {label}
    </span>
  );
}

/**
 * 도구 아이콘 라우팅 — 원본 badges.js#toolIconHtml SSoT 분기 1:1.
 *  Skill → SkillDot(tool-icon-skill) / mcp__ → McpDot(tool-icon-mcp) /
 *  Task → AgentDot(tool-icon-task) / Agent → AgentDot(tool-icon-agent) / else → ToolDot(tool-icon-tool)
 *  eventType==='pre_tool' → ' tool-icon-running' 부착.
 */
export function ToolIcon({
  toolName,
  eventType = null,
}: {
  toolName: string | null | undefined;
  eventType?: string | null;
}): ReactElement {
  const name = typeof toolName === 'string' ? toolName : '';
  const isSkill = name === 'Skill' || name.startsWith('Skill');
  const isMcp = !isSkill && name.startsWith('mcp__');
  const isTask = !isSkill && !isMcp && name.startsWith('Task');
  const isAgent = !isSkill && !isMcp && !isTask && (name === 'Agent' || name.startsWith('Agent'));
  const runCls = eventType === 'pre_tool' ? ' tool-icon-running' : '';
  if (isSkill) {
    return (
      <span className={`tool-icon tool-icon-skill${runCls} ds-icon`}>
        <SkillDot size={12} />
      </span>
    );
  }
  if (isMcp) {
    return (
      <span className={`tool-icon tool-icon-mcp${runCls} ds-icon`}>
        <McpDot size={12} />
      </span>
    );
  }
  if (isTask) {
    return (
      <span className={`tool-icon tool-icon-task${runCls} ds-icon`}>
        <AgentDot size={12} />
      </span>
    );
  }
  if (isAgent) {
    return (
      <span className={`tool-icon tool-icon-agent${runCls} ds-icon`}>
        <AgentDot size={12} />
      </span>
    );
  }
  return (
    <span className={`tool-icon tool-icon-tool${runCls} ds-icon`}>
      <ToolDot size={12} />
    </span>
  );
}

/**
 * spike/loop anomaly 배지 묶음 — 원본 badges.js#anomalyBadgesHtml 1:1.
 * slow 는 duration 셀로 분리되므로 호출 측에서 제외(원본 makeRequestRow 와 동일).
 */
export function AnomalyBadges({ flags }: { flags: Set<string> | null | undefined }): ReactElement | null {
  if (!flags || flags.size === 0) return null;
  const toneMap: Record<string, string> = { spike: 'warn', loop: 'info', slow: 'warn' };
  return (
    <>
      {[...flags].map((f) => (
        <span
          key={f}
          className={`mini-badge badge-${f} ds-badge`}
          data-tone={toneMap[f] ?? 'neutral'}
          data-mini-badge-tooltip={f}
        >
          {f}
        </span>
      ))}
    </>
  );
}

/**
 * duration 셀 slow 배지 — 원본 makeRequestRow 의 인라인 slowBadge 와 동치.
 * (원본은 ds-badge·data-tone 없이 badge-slow + tooltip 만)
 */
export function SlowBadge(): ReactElement {
  return (
    <span className="mini-badge badge-slow" data-mini-badge-tooltip="slow">
      slow
    </span>
  );
}
