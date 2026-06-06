/**
 * design-system/icons/ChatReturn.tsx — 대화형 뷰 tool_result(↳ 결과 귀환) 글리프 (payload-chat-redesign)
 *
 * line-icon 패밀리 규약 계승(viewBox 0 0 16 16, stroke currentColor, sw 1.5, round).
 * 꺾여 돌아오는 화살표 — '도구가 돌려준 결과'의 방향성. 신규 위계 글리프(3차 회의 g-return).
 *
 * @module design-system/icons/ChatReturn
 */
import { Svg, type IconProps } from './Svg';

export function ChatReturn({ size = 14, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M4 3v3.6a2 2 0 0 0 2 2h6.5" />
      <path d="M9.6 6L12.6 8.6L9.6 11.2" />
    </Svg>
  );
}
