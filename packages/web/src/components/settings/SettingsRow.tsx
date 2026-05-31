/**
 * components/settings/SettingsRow.tsx — 진단 카드 한 줄 (P2-06 공용 leaf)
 *
 * 원본: settings-view.js:1534 rowHtml(label,status,value,tail).
 *   전 섹션이 호출하는 최다 재사용 leaf — diag/hooks/sqlite/proxy/server 공통(아키텍처 §1.1).
 *   구조: icon(✓⚠✕) + label + value + tail(보조 메타/명령어/버튼).
 *
 * 동치: 원본 escHtml(label)/escHtml(value) → React 자동 이스케이프. tail 은 원본이 raw HTML
 *   문자열이었으나 React 에선 ReactNode(jump 버튼/메타 배지 등)로 받는다 — 셀렉터 계약 유지.
 *
 * P2-07 재사용: GraphPanel/SqlitePanel/ProxyPanel 의 상태 row 전부 이 컴포넌트로 그린다.
 *
 * @module components/settings/SettingsRow
 */
import type { ReactNode } from 'react';
import type { RowStatus } from '../../features/settings/types';

export interface SettingsRowProps {
  label: string;
  status: RowStatus;
  value: string;
  /** 보조 슬롯 — 메타 배지/명령 코드/jump 버튼 등(원본 tail). */
  tail?: ReactNode;
}

/** status → 글리프(원본 :1535). */
function statusIcon(status: RowStatus): string {
  return status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '✕';
}

export function SettingsRow({ label, status, value, tail }: SettingsRowProps) {
  return (
    <div className={`settings-row settings-row-${status}`}>
      <span className="settings-row-icon">{statusIcon(status)}</span>
      <span className="settings-row-label">{label}</span>
      <span className="settings-row-value">{value}</span>
      <span className="settings-row-tail">{tail}</span>
    </div>
  );
}
