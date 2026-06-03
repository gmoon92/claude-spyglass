/**
 * use-strip-stats.test.tsx — 특성화 테스트 (소스 변경 없음, 현재 동작 고정).
 *
 * useStripStats 는 3개 endpoint(/api/stats/strip, /api/sessions/active,
 * /api/stats/tools)를 Promise.all 로 병렬 호출하고 결과를 합성한다.
 *
 * 커버:
 *   - 3 endpoint 병렬 성공 → strip 합성 + activeSessions + toolStats 매핑
 *   - synthesizedStrip: active_sessions / total_requests / total_tokens 가
 *     /api/sessions/active 에서 합성된다
 *   - error_rate 0-division 가드 (call_count=0 → NaN 아님)
 *   - 한 endpoint reject → error 설정, isLoading=false
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { useStripStats } from '../hooks/useStripStats';
import { renderHook } from './helpers/render-hook';
import { FetchMock, flushAsync } from './helpers/fetch-mock';
import { makeSession } from './helpers/fixtures';

let fm: FetchMock;
afterEach(() => fm?.restore());

const API = 'http://test';
// interval 을 매우 크게 줘서 폴링이 테스트 동안 다시 안 돌게 한다.
const HUGE = 9_999_999;

describe('useStripStats — 3 endpoint 병렬 성공', () => {
  it('strip 을 sessions/active 기준으로 합성한다', async () => {
    fm = new FetchMock()
      .route('/api/stats/strip', { json: { data: { p95_duration_ms: 222, error_rate: 0.1 } } })
      .route('/api/sessions/active', {
        json: { data: [makeSession({ id: 's1', request_count: 2, total_tokens: 100 }), makeSession({ id: 's2', request_count: 3, total_tokens: 50 })] },
      })
      .route('/api/stats/tools', { json: { data: [{ tool_name: 'Read', call_count: 10, error_count: 2, avg_tokens: 100, p95_duration_ms: 80 }] } });

    const h = renderHook(() => useStripStats(API, HUGE));
    await flushAsync();

    expect(h.current.error).toBeNull();
    expect(h.current.isLoading).toBe(false);
    // synthesizedStrip 은 active sessions 합산
    expect(h.current.strip!.active_sessions).toBe(2);
    expect(h.current.strip!.total_sessions).toBe(2);
    expect(h.current.strip!.total_requests).toBe(5);
    expect(h.current.strip!.total_tokens).toBe(150);
    // strip 원본의 p95/error_rate 는 보존
    expect(h.current.strip!.p95_duration_ms).toBe(222);
    expect(h.current.activeSessions.length).toBe(2);
    h.unmount();
  });

  it('tools 의 call_count/error_count → calls + error_rate 매핑', async () => {
    fm = new FetchMock()
      .route('/api/stats/strip', { json: { data: {} } })
      .route('/api/sessions/active', { json: { data: [] } })
      .route('/api/stats/tools', { json: { data: [{ tool_name: 'Bash', call_count: 4, error_count: 1 }] } });

    const h = renderHook(() => useStripStats(API, HUGE));
    await flushAsync();
    const ts = h.current.toolStats[0]!;
    expect(ts.tool_name).toBe('Bash');
    expect(ts.calls).toBe(4);
    expect(ts.error_rate).toBe(0.25);
    h.unmount();
  });
});

describe('useStripStats — error_rate 0-division', () => {
  it('call_count=0 이어도 error_rate 는 NaN 이 아니다', async () => {
    fm = new FetchMock()
      .route('/api/stats/strip', { json: { data: {} } })
      .route('/api/sessions/active', { json: { data: [] } })
      .route('/api/stats/tools', { json: { data: [{ tool_name: 'Glob', call_count: 0, error_count: 0 }] } });

    const h = renderHook(() => useStripStats(API, HUGE));
    await flushAsync();
    const ts = h.current.toolStats[0]!;
    // Math.max(1, 0) 가드 → 0/1 = 0
    expect(Number.isNaN(ts.error_rate)).toBe(false);
    expect(ts.error_rate).toBe(0);
    h.unmount();
  });
});

describe('useStripStats — 빈 응답', () => {
  it('data 누락 시 빈 배열/0 합성', async () => {
    fm = new FetchMock()
      .route('/api/stats/strip', { json: {} })
      .route('/api/sessions/active', { json: {} })
      .route('/api/stats/tools', { json: {} });

    const h = renderHook(() => useStripStats(API, HUGE));
    await flushAsync();
    expect(h.current.activeSessions).toEqual([]);
    expect(h.current.toolStats).toEqual([]);
    expect(h.current.strip!.active_sessions).toBe(0);
    expect(h.current.strip!.total_tokens).toBe(0);
    h.unmount();
  });
});

describe('useStripStats — 에러 경로', () => {
  it('한 endpoint reject → error 설정, isLoading=false', async () => {
    fm = new FetchMock()
      .route('/api/stats/strip', { reject: new Error('network down') })
      .route('/api/sessions/active', { json: { data: [] } })
      .route('/api/stats/tools', { json: { data: [] } });

    const h = renderHook(() => useStripStats(API, HUGE));
    await flushAsync();
    expect(h.current.error).toBe('network down');
    expect(h.current.isLoading).toBe(false);
    h.unmount();
  });
});
