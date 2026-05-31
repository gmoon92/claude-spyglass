/**
 * tool-stats-fetcher.test.ts — fetchProjectToolStats colocated fetcher (vanilla→React 배선)
 *
 * 원본: tool-stats.js loadProjectToolStats(:66). fetch → 파싱 → raw rows(사이드이펙트 0).
 *   - 정상 envelope({success,data}) → rows 반환.
 *   - project null → fetch 생략(원본 select-project 빈 상태) → [].
 *   - HTTP 실패/abort/스키마 실패 → [] 안전 폴백.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchProjectToolStats } from '../tool-stats-fetcher';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

describe('fetchProjectToolStats — 프로젝트 도구 통계 colocated fetcher', () => {
  it('정상 envelope → data rows 반환', async () => {
    mockFetchOnce({ success: true, data: [{ tool_name: 'Bash', call_count: 10 }] });
    const rows = await fetchProjectToolStats({ project: 'claude-spyglass' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool_name).toBe('Bash');
  });

  it('project null → fetch 생략 → []', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const rows = await fetchProjectToolStats({ project: null });
    expect(rows).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('HTTP 실패 → [] 폴백', async () => {
    mockFetchOnce({ success: false }, false);
    const rows = await fetchProjectToolStats({ project: 'p' });
    expect(rows).toEqual([]);
  });

  it('스키마 미부합(data 누락) → [] 폴백', async () => {
    mockFetchOnce({ success: true });
    const rows = await fetchProjectToolStats({ project: 'p' });
    expect(rows).toEqual([]);
  });

  it('from/to range → URL 쿼리 부착', async () => {
    const spy = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ success: true, data: [] }) }) as unknown as Response);
    vi.stubGlobal('fetch', spy);
    await fetchProjectToolStats({ project: 'my proj', from: 100, to: 200 });
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain('/api/projects/my%20proj/tool-stats');
    expect(url).toContain('from=100');
    expect(url).toContain('to=200');
  });
});
