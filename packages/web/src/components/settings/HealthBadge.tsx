/**
 * components/settings/HealthBadge.tsx — 통합 상태 배지 (P2-06 공용 leaf)
 *
 * 원본: settings-view.js .settings-health-badge 마크업(:475-480 hook, :817 graph, :1115 sqlite,
 *   :1288 proxy — 4곳 동일 패턴, 아키텍처 §1.1).
 *   구조: is-{variant} 배지 + 글리프 아이콘 + 텍스트.
 *
 * 변형(variant): 시각 톤은 'ok' | 'warn' | 'off'(원본 broken/missing 은 warn 톤 공유 :476,
 *   graph off 는 별도 .is-off CSS :874). 상태→variant/icon 변환은 호출처가 logic.ts 로 결정.
 *
 * P2-07 재사용: GraphPanel(off 포함)/SqlitePanel/ProxyPanel 헬스 배지.
 *
 * @module components/settings/HealthBadge
 */

export interface HealthBadgeProps {
  /**
   * 시각 톤 — ok(녹) / warn(황) / off(graph 비활성, settings-view.css:874).
   * broken·missing 은 호출처가 warn 으로 매핑(원본 :476).
   */
  variant: 'ok' | 'warn' | 'off';
  /** 글리프(✓ / ⚠ / ✕) — 호출처가 상태에 맞게 결정. */
  icon: string;
  /** 배지 텍스트(i18n 라벨). React 자동 이스케이프. */
  label: string;
}

export function HealthBadge({ variant, icon, label }: HealthBadgeProps) {
  return (
    <div className="settings-health-row">
      <span className={`settings-health-badge is-${variant}`}>
        <span className="settings-health-icon" aria-hidden="true">{icon}</span>
        <span className="settings-health-text">{label}</span>
      </span>
    </div>
  );
}
