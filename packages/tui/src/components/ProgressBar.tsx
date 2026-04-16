/**
 * Progress Bar Component
 *
 * @description 토큰 사용량 시각화 프로그레스 바
 */

import React from 'react';
import { Box, Text } from 'ink';

/**
 * 프로그레스 바 props
 */
export interface ProgressBarProps {
  /** 진행률 (0-100) */
  progress: number;
  /** 바 너비 */
  width?: number;
  /** 채우기 문자 */
  fillChar?: string;
  /** 빈 칸 문자 */
  emptyChar?: string;
  /** 색상 */
  color?: 'green' | 'yellow' | 'red' | 'cyan' | 'blue';
}

/**
 * 프로그레스 바 컴포넌트
 */
export function ProgressBar({
  progress,
  width = 40,
  fillChar = '█',
  emptyChar = '░',
  color = 'cyan',
}: ProgressBarProps): JSX.Element {
  // 0-100 범위로 클램프
  const clampedProgress = Math.max(0, Math.min(100, progress));

  // 채워진 칸 수 계산
  const filledCount = Math.round((clampedProgress / 100) * width);
  const emptyCount = width - filledCount;

  // 색상 결정
  let barColor = color;
  if (color === 'cyan') {
    if (clampedProgress > 80) barColor = 'red';
    else if (clampedProgress > 60) barColor = 'yellow';
    else barColor = 'green';
  }

  const filled = fillChar.repeat(filledCount);
  const empty = emptyChar.repeat(emptyCount);

  return (
    <Box>
      <Text color="gray">[</Text>
      <Text color={barColor}>{filled}</Text>
      <Text color="gray">{empty}</Text>
      <Text color="gray">]</Text>
    </Box>
  );
}
