/**
 * components/settings/index.ts — settings 공용 leaf 컴포넌트 barrel (P2-06)
 *
 * 아키텍처 §1.1 의 공용 leaf 9종 진입점. P2-07(Graph/SQLite/Proxy)이 재사용한다.
 *   SettingsRow / HealthBadge / OptionCard / TooltipHost / CodeCopyBox / InlineCopyButton
 *   / StickyAlert / Toast (+ Copy 아이콘은 design-system/icons).
 *
 * @module components/settings
 */
export { SettingsRow, type SettingsRowProps } from './SettingsRow';
export { HealthBadge, type HealthBadgeProps } from './HealthBadge';
export { StorageUsageBar, type StorageUsageBarProps, type StorageUsageSegment } from './StorageUsageBar';
export { OptionCard, type OptionCardProps } from './OptionCard';
export { TooltipHost, type TooltipHostProps } from './TooltipHost';
export { CodeCopyBox, type CodeCopyBoxProps } from './CodeCopyBox';
export { InlineCopyButton, type InlineCopyButtonProps } from './InlineCopyButton';
export {
  StickyAlert,
  type StickyAlertProps,
  STICKY_ALERT_DURATION_MS,
  STICKY_ALERT_FADE_MS,
} from './StickyAlert';
export {
  Toast,
  type ToastProps,
  TOAST_SHOW_DELAY_MS,
  TOAST_DURATION_MS,
  TOAST_LEAVE_MS,
} from './Toast';
