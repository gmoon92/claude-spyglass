/**
 * design-system/icons/ChatThink.tsx — 대화형 뷰 thinking(속생각) 글리프 (payload-chat-redesign)
 *
 * line-icon 패밀리 규약 계승(viewBox 0 0 16 16, stroke currentColor, sw 1.5, round).
 * 사고 구름 + 꼬리 점 2개 — '확정 발화 아님'을 형태로 표현. 신규 위계 글리프(3차 회의 g-think).
 *
 * @module design-system/icons/ChatThink
 */
import { Svg, type IconProps } from './Svg';

export function ChatThink({ size = 14, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M5.4 4.4a2.1 2.1 0 0 1 3.9-.9 1.9 1.9 0 0 1 2.4 2.4 1.9 1.9 0 0 1-1.1 3.2H6a2.1 2.1 0 0 1-.6-4.1z" />
      <circle cx="5" cy="11.6" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="3.4" cy="13.4" r="0.55" fill="currentColor" stroke="none" />
    </Svg>
  );
}
