/**
 * design-system/icons/ChatPin.tsx — 대화형 뷰 system prompt(핀 공지) 글리프 (payload-chat-redesign)
 *
 * line-icon 패밀리 규약 계승(viewBox 0 0 16 16, stroke currentColor, sw 1.5, round).
 * 압정(push-pin) — '대화에 매번 고정되는 규칙'. 신규 위계 글리프(3차 회의 g-pin).
 *
 * @module design-system/icons/ChatPin
 */
import { Svg, type IconProps } from './Svg';

export function ChatPin({ size = 14, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M6 2h4l-.7 4.2 2.2 2.3H4.5l2.2-2.3L6 2z" />
      <line x1="8" y1="10.5" x2="8" y2="14" />
    </Svg>
  );
}
