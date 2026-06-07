/**
 * features/settings/SettingsSkeleton.tsx — 설정 패널 콜드 로딩 스켈레톤 (perf-report §6 잔여).
 *
 * 배경: /api/settings/diag 콜드 ~223ms 동안 각 패널(Diag/Storage/Server/Integration)이
 *   `<div class="settings-loading">loading…</div>` 텍스트 가림막만 보여 콘텐츠 영역이 빈 채로 멈춘다.
 *   셸·탭은 즉시 표시되므로(SettingsView 라우터), 콘텐츠만 패널 형태의 스켈레톤으로 대체해
 *   레이아웃 점프·빈 화면 체감을 줄인다(perceived-perf — 실제 fetch 비용은 불변).
 *
 * 재사용 SSoT: 4개 패널의 loading 분기가 모두 이 컴포넌트를 쓴다(텍스트 가림막 중복 제거).
 *   카드 N개 × 행 M개의 shimmer placeholder — 특정 패널 구조에 묶이지 않은 일반 형태.
 *
 * @module features/settings/SettingsSkeleton
 */
import type { ReactElement } from 'react';

export interface SettingsSkeletonProps {
  /** 스켈레톤 카드 수(패널 밀도에 맞춰 조정, 기본 3). */
  cards?: number;
  /** 카드당 행 수(기본 3). */
  rows?: number;
  /** 접근성 라벨(로딩 중 안내). */
  label?: string;
}

/**
 * 설정 패널 콜드 로딩 스켈레톤 — shimmer 카드 placeholder.
 *  - aria-busy 로 스크린리더에 로딩 상태 전달(텍스트 "loading" 대체).
 */
export function SettingsSkeleton({ cards = 3, rows = 3, label = 'Loading…' }: SettingsSkeletonProps): ReactElement {
  return (
    <div className="settings-skeleton" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: cards }, (_, ci) => (
        <div className="sk-card" key={ci}>
          <div className="sk-line sk-title" />
          {Array.from({ length: rows }, (_, ri) => (
            <div className="sk-line" key={ri} style={{ width: `${88 - ri * 12}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
