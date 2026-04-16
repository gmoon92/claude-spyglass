/**
 * Alert Banner Component
 *
 * @description 상단 알림 배너 표시
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { AlertLevel, Alert } from '../hooks/useAlerts';

/**
 * 알림 배너 props
 */
export interface AlertBannerProps {
  level: AlertLevel;
  alert: Alert | null;
  onDismiss?: () => void;
}

/**
 * 레벨별 색상
 */
function getLevelColor(level: AlertLevel): string {
  switch (level) {
    case 'critical':
      return 'red';
    case 'warning':
      return 'yellow';
    case 'normal':
      return 'green';
    default:
      return 'gray';
  }
}

/**
 * 레벨별 아이콘
 */
function getLevelIcon(level: AlertLevel): string {
  switch (level) {
    case 'critical':
      return '🔴';
    case 'warning':
      return '🟡';
    case 'normal':
      return '🟢';
    default:
      return '⚪';
  }
}

/**
 * 알림 배너 컴포넌트
 */
export function AlertBanner({ level, alert, onDismiss }: AlertBannerProps): JSX.Element {
  // 정상 상태는 배너 표시 안 함
  if (level === 'normal' || !alert) {
    return (
      <Box height={1}>
        <Text color="gray">{getLevelIcon('normal')} System Normal</Text>
      </Box>
    );
  }

  const color = getLevelColor(level);
  const icon = getLevelIcon(level);

  return (
    <Box
      height={1}
      backgroundColor={color}
      paddingX={1}
    >
      <Box width="10%">
        <Text color="white" bold>
          {icon} {level.toUpperCase()}
        </Text>
      </Box>
      <Box width="80%">
        <Text color="white" wrap="truncate">
          {alert.title}: {alert.message}
        </Text>
      </Box>
      <Box width="10%" justifyContent="flex-end">
        <Text color="white">Press A to Ack</Text>
      </Box>
    </Box>
  );
}

/**
 * 알림 레벨 표시 (간단 버전)
 */
export function AlertIndicator({ level }: { level: AlertLevel }): JSX.Element {
  const color = getLevelColor(level);
  const icon = getLevelIcon(level);

  return (
    <Box>
      <Text color={color} bold>
        {icon}
      </Text>
    </Box>
  );
}
