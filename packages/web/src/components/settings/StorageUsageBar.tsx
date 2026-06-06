/**
 * components/settings/StorageUsageBar.tsx — 저장소 용량 비율 바 (Storage 패널 leaf)
 *
 * Storage 요약 카드에서 두 저장소(대화·이벤트 기록 / 관계 흐름 그래프)의 용량 비율을
 * 가로 막대로 시각화한다. 순수 프레젠테이션 leaf — 바이트 포맷/라벨은 호출처가 결정.
 *
 * 무전역: 색 톤은 CSS 클래스(.storage-usage-seg.is-{key})로 위임. 0 합계(둘 다 0/null)면
 *   빈 바 + '—' 만 노출하고 분모 0 나눗셈을 회피한다.
 *
 * @module components/settings/StorageUsageBar
 */

export interface StorageUsageSegment {
  /** 세그먼트 식별 키 — CSS 톤(.is-{key}) + React key. */
  key: string;
  /** 범례 라벨(i18n). */
  label: string;
  /** 바이트(없으면 0 취급). */
  bytes: number;
  /** 사람이 읽는 크기 텍스트(formatBytes 결과). */
  sizeText: string;
}

export interface StorageUsageBarProps {
  segments: StorageUsageSegment[];
}

export function StorageUsageBar({ segments }: StorageUsageBarProps) {
  const total = segments.reduce((acc, s) => acc + (s.bytes > 0 ? s.bytes : 0), 0);

  return (
    <div className="storage-usage">
      <div className="storage-usage-bar" role="img" aria-label="storage usage ratio">
        {total > 0 &&
          segments.map((s) => {
            const pct = s.bytes > 0 ? (s.bytes / total) * 100 : 0;
            if (pct <= 0) return null;
            return (
              <span
                key={s.key}
                className={`storage-usage-seg is-${s.key}`}
                style={{ width: `${pct}%` }}
                data-tip={`${s.label}: ${s.sizeText}`}
              />
            );
          })}
      </div>
      <ul className="storage-usage-legend">
        {segments.map((s) => {
          const pct = total > 0 && s.bytes > 0 ? (s.bytes / total) * 100 : 0;
          return (
            <li key={s.key} className="storage-usage-legend-item">
              <span className={`storage-usage-dot is-${s.key}`} aria-hidden="true" />
              <span className="storage-usage-legend-label">{s.label}</span>
              <span className="storage-usage-legend-value">
                {s.sizeText}
                {total > 0 ? ` · ${pct.toFixed(0)}%` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
