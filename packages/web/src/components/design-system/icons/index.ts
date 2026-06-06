/**
 * design-system/icons/index.ts — 아이콘 패밀리 barrel export (P2-01)
 *
 * 책임:
 *  - src/components/design-system/icons/ 하위 20개 stateless 아이콘 컴포넌트를 단일 진입점으로 re-export.
 *  - 구 assets/js/design-system/icons/_index.js barrel 의 React 대응물(병존, 소비처 전환은 후속).
 *
 * 사용 가이드:
 *  - 여러 아이콘 동시 사용: `import { Trash, Warn } from '@/components/design-system/icons'`
 *  - 단일 아이콘: `import { Note } from '@/components/design-system/icons/Note'`
 *
 * 디자인 패밀리:
 *  - 공통 래퍼 Svg(stroke/fill·viewBox·size) — 원본 wrapSvg 의 단일 통합본.
 *  - 모든 아이콘은 currentColor 토큰 상속(hex 하드코딩 금지, SSoT 준수).
 *
 * @module design-system/icons
 */
export { Svg, type IconProps, type SvgProps } from './Svg';

export { AgentDot } from './AgentDot';
export { Bolt } from './Bolt';
export { Check, type CheckProps } from './Check';
export { Chevron, type ChevronProps } from './Chevron';
// 대화형 페이로드 뷰 전용 위계 글리프 (payload-chat-redesign · 3차 회의 g-claude/user/think/return/pin)
export { ChatClaude } from './ChatClaude';
export { ChatUser } from './ChatUser';
export { ChatThink } from './ChatThink';
export { ChatReturn } from './ChatReturn';
export { ChatPin } from './ChatPin';
export { Copy } from './Copy';
export { Diamond } from './Diamond';
export { ErrorIcon } from './ErrorIcon';
export { Info } from './Info';
export { McpDot } from './McpDot';
export { Note } from './Note';
export { Quote } from './Quote';
export { Radio, type RadioProps } from './Radio';
export { Refresh } from './Refresh';
export { Search } from './Search';
export { SkillDot } from './SkillDot';
export { StatusActive } from './StatusActive';
export { StatusEnded } from './StatusEnded';
export { StatusStale } from './StatusStale';
export { ToolDot } from './ToolDot';
export { Trash } from './Trash';
export { Warn } from './Warn';
