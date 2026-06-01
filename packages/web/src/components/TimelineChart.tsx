/**
 * TimelineChart.tsx — 30초 sliding-window tick 을 로컬 소유하는 Chart 래퍼.
 *
 * 배경(성능 — 병목 #2):
 *   타임라인 버킷은 30초마다 now 기준으로 좌로 흘러야 한다(원본 advanceBuckets 의 시간경과 대응).
 *   이 tick state(nowTick)를 BrowseLayout 이 소유하면 30초마다 BrowseLayout 전체가 재렌더되고,
 *   같은 서브트리의 피드 테이블(최대 200행)까지 매 30초 재조정된다(SSE feed 와 동거하는 진앙지).
 *
 * 책임(관심사 격리):
 *   - nowTick(30초 interval)을 이 컴포넌트의 로컬 state 로 소유한다.
 *   - feedTimestamps + nowTick → bucketizeByMinute 로 timelineBuckets 를 파생(차트 입력)한다.
 *   - 나머지 Chart props 는 그대로 통과한다(SSoT 는 호출처 BrowseLayout — 상태 재설계 없음).
 *
 * 효과:
 *   30초 tick 은 이 컴포넌트(→ Chart subtree)만 재렌더한다. BrowseLayout 본체와 피드 테이블은
 *   tick 을 구독하지 않으므로 영향받지 않는다. memo 로 감싸 BrowseLayout 이 tick 외 사유로
 *   재렌더될 때(예: 무관 로컬 state) prop 불변이면 본체 실행도 건너뛴다.
 *
 * 의존성: components/Chart(leaf 렌더) · components/chart-data(bucketizeByMinute SSoT).
 * 호출 흐름: BrowseLayout → <TimelineChart feedTimestamps=… {...chartProps}/> → <Chart timelineBuckets=…/>.
 *
 * @module components/TimelineChart
 */
import { memo, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Chart, type ChartProps } from './Chart';
import { bucketizeByMinute } from './chart-data';

/** 30초 sliding window 갱신 주기(ms) — 원본 BrowseLayout nowTick interval 동치. */
const TICK_MS = 30_000;

/**
 * TimelineChart props — Chart 와 동일하되 timelineBuckets 는 내부 파생이므로 제외하고,
 * 대신 버킷 입력인 feedTimestamps(epoch ms 배열)를 받는다.
 */
export interface TimelineChartProps extends Omit<ChartProps, 'timelineBuckets'> {
  /**
   * 피드 행 timestamp(epoch ms) 배열 — 30분 sliding 버킷 입력.
   * BrowseLayout 이 feedRows 에서 파생(ref 안정: feed 변경 시에만 갱신)해 주입한다.
   */
  feedTimestamps: number[];
}

export const TimelineChart = memo(function TimelineChart({
  feedTimestamps,
  ...chartProps
}: TimelineChartProps): ReactElement {
  // 30초 sliding window tick — 이 컴포넌트 로컬 소유(피드 테이블과 분리). 원본 BrowseLayout:163-167 이관.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // 30분 sliding 타임라인 버킷 — feed timestamp 를 현재 분 기준 버킷에 분배(원본 BrowseLayout:170-175 이관).
  const timelineBuckets: number[] = useMemo(
    () => bucketizeByMinute(feedTimestamps, nowTick),
    [feedTimestamps, nowTick],
  );

  return <Chart {...chartProps} timelineBuckets={timelineBuckets} />;
});
