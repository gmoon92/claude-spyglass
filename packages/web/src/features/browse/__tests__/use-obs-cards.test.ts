/**
 * use-obs-cards.test.ts — sessions/active → LivePulsePayload 합성 동치 검증
 *
 * 원본: assets/js/api.js fetchObservability(:344-350) —
 *   active_count = 배열 길이, last_event_ts = max(last_activity_at), recent_calls = [].
 */
import { describe, it, expect } from 'vitest';
import { toLivePulse } from '../use-obs-cards';

describe('toLivePulse — sessions/active 합성(원본 api.js:344-350 1:1)', () => {
  it('빈/null 입력 → active_count=0, last_event_ts=null', () => {
    expect(toLivePulse(null)).toEqual({ active_count: 0, last_event_ts: null, recent_calls: [] });
    expect(toLivePulse([])).toEqual({ active_count: 0, last_event_ts: null, recent_calls: [] });
  });

  it('active_count 는 배열 길이, last_event_ts 는 max(last_activity_at)', () => {
    const out = toLivePulse([
      { last_activity_at: 1000 },
      { last_activity_at: 3000 },
      { last_activity_at: 2000 },
    ]);
    expect(out).toEqual({ active_count: 3, last_event_ts: 3000, recent_calls: [] });
  });

  it('last_activity_at 누락 행은 0 으로 간주(max 폴백 0 → null)', () => {
    const out = toLivePulse([{}, {}]);
    expect(out).toEqual({ active_count: 2, last_event_ts: null, recent_calls: [] });
  });
});
