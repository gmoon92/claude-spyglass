/**
 * design-system/icons/ChatUser.tsx — 대화형 뷰 user(사람/CLI) 아바타 글리프 (payload-chat-redesign)
 *
 * line-icon 패밀리 규약 계승(viewBox 0 0 16 16, stroke currentColor, sw 1.5, round). 인물 실루엣.
 * 색은 currentColor 상속(--chat-user-accent). 신규 대화 전용 위계 글리프(3차 회의 g-user).
 *
 * @module design-system/icons/ChatUser
 */
import { Svg, type IconProps } from './Svg';

export function ChatUser({ size = 14, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="8" cy="5.4" r="2.5" />
      <path d="M3 13.6c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    </Svg>
  );
}
