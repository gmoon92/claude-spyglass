/**
 * design-system/icons/McpDot.tsx — MCP sub-type 전용 plug/socket 아이콘
 *
 * 원본: assets/js/design-system/icons/mcp-dot.js svgMcpDot.
 *  - 외곽 점 4개(fill r=1.2) + 중앙 원(stroke r=2.5). 기본 size 12.
 *
 * @module design-system/icons/McpDot
 */
import { Svg, type IconProps } from './Svg';

export function McpDot({ size = 12, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="4" cy="4" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth={1.5} />
    </Svg>
  );
}
