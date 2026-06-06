/**
 * design-system/icons/ChatClaude.tsx — 대화형 뷰 assistant(Claude) 아바타 글리프 (payload-chat-redesign)
 *
 * line-icon 패밀리 규약 계승(viewBox 0 0 16 16, stroke currentColor, sw 1.5, round). 모니터+눈 글리프.
 * 색은 currentColor 상속(--chat-claude-accent). 신규 대화 전용 위계 글리프(3차 회의 g-claude).
 *
 * @module design-system/icons/ChatClaude
 */
import { Svg, type IconProps } from './Svg';

export function ChatClaude({ size = 14, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <rect x="2" y="3.5" width="12" height="8" rx="2" />
      <line x1="8" y1="1.5" x2="8" y2="3.5" />
      <circle cx="6" cy="7.5" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.5" r="0.95" fill="currentColor" stroke="none" />
      <path d="M5.5 14h5" />
    </Svg>
  );
}
