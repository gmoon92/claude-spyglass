/**
 * stats-tables.test.tsx — tool-stats 매트릭스 + syslib 표 정렬/뷰 + 골든마스터 (P3-09)
 *
 * 정렬 SSoT(nextSort/applySort)·행 산술(computeMatrixView)·임계(sizeClassFor) 결정론 고정 +
 * ToolStatsMatrix/SystemPromptLibrary 마크업 계약. window.I18n 스텁(getCollator 의존).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  applySort as tsApplySort,
  nextSort as tsNextSort,
  fmtDur,
  DEFAULT_SORT as TS_DEFAULT,
  type ToolStatRow,
} from '../tool-stats-sort';
import { computeMatrixView } from '../tool-stats-view';
import { ToolStatsMatrix } from '../ToolStatsMatrix';
import {
  applySort as slApplySort,
  nextSort as slNextSort,
  sizeClassFor,
  formatBytes,
  formatTime,
  refHotCutoff,
  type SysLibRow,
} from '../syslib-sort';
import { SystemPromptLibrary } from '../SystemPromptLibrary';

beforeAll(() => {
  (globalThis as { window?: { I18n?: unknown } }).window ??= {};
  (globalThis as { window: { I18n?: unknown } }).window.I18n = { t: (k: string) => k, getLang: () => 'en' };
});

const t = (key: string) => `t:${key}`;

// ── tool-stats ────────────────────────────────────────────────────────────────
const TS_ROWS: ToolStatRow[] = [
  { tool_name: 'Bash', avg_duration_ms: 500, call_count: 10, total_tokens: 1000, pct_of_total_tokens: 40, error_count: 2 },
  { tool_name: 'Read', avg_duration_ms: 0, call_count: 30, total_tokens: 500, pct_of_total_tokens: 20, error_count: 0, has_low_confidence: true },
  { tool_name: 'Agent', avg_duration_ms: 1200, call_count: 5, total_tokens: 2000, pct_of_total_tokens: 80, error_count: 0 },
];

describe('tool-stats-sort — 정렬 전이/dispatcher', () => {
  it('기본 정렬 tokens desc', () => {
    expect(TS_DEFAULT).toEqual({ key: 'tokens', dir: 'desc' });
  });
  it('같은 키 재클릭 → 방향 토글', () => {
    expect(tsNextSort({ key: 'tokens', dir: 'desc' }, 'tokens')).toEqual({ key: 'tokens', dir: 'asc' });
  });
  it('다른 키 클릭 → 컬럼 기본 방향(tool=asc)', () => {
    expect(tsNextSort({ key: 'tokens', dir: 'desc' }, 'tool')).toEqual({ key: 'tool', dir: 'asc' });
  });
  it('applySort tokens desc → Agent(2000) 첫행', () => {
    const sorted = tsApplySort(TS_ROWS, 'tokens', 'desc');
    expect(sorted[0].tool_name).toBe('Agent');
  });
  it('applySort 원본 불변(slice)', () => {
    tsApplySort(TS_ROWS, 'calls', 'asc');
    expect(TS_ROWS[0].tool_name).toBe('Bash');
  });
  it('fmtDur: 0→— / <1s ms / <60s s / 분초', () => {
    expect(fmtDur(0)).toBe('—');
    expect(fmtDur(500)).toBe('500ms');
    expect(fmtDur(1500)).toBe('1.5s');
    expect(fmtDur(65000)).toBe('1m5s');
  });
});

describe('computeMatrixView — 행 산술(duration 0 제외 max)', () => {
  it('maxDur 는 0 행 제외(Read durMs=0 무시 → max=1200)', () => {
    const v = computeMatrixView(TS_ROWS);
    expect(v.maxDur).toBe(1200);
    expect(v.maxCalls).toBe(30);
  });
  it('durMs=0 행 → durUnavailable + bar 0', () => {
    const v = computeMatrixView(TS_ROWS);
    const read = v.rows.find((r) => r.toolName === 'Read')!;
    expect(read.durUnavailable).toBe(true);
    expect(read.durBarPct).toBe(0);
  });
  it('has_low_confidence → hasLowConf true', () => {
    const v = computeMatrixView(TS_ROWS);
    expect(v.rows.find((r) => r.toolName === 'Read')!.hasLowConf).toBe(true);
  });
});

describe('ToolStatsMatrix — 골든마스터', () => {
  it('빈 stats → state-empty + no-data', () => {
    const html = renderToStaticMarkup(<ToolStatsMatrix stats={[]} t={t} />);
    expect(html).toContain('state-empty');
    expect(html).toContain('t:ui.tool-stats.no-data');
  });
  it('정상 → ts-mx 헤더/행 + 정렬 aria + 에러 배지 + duration unavailable', () => {
    const html = renderToStaticMarkup(
      <ToolStatsMatrix stats={TS_ROWS} sort={{ key: 'tokens', dir: 'desc' }} t={t} />,
    );
    expect(html).toContain('ts-mx-head');
    expect(html).toContain('data-ts-sort="tokens"');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('ts-mx-bar-fill--avg ds-bar-fill');
    expect(html).toContain('data-tone="success"'); // calls bar
    expect(html).toContain('mini-badge badge-error ds-badge'); // Bash error_count 2
    expect(html).toContain('data-duration-unavailable="true"'); // Read durMs 0
    expect(html).toContain('confidence-low-mark'); // Read low conf
  });
});

// ── syslib ──────────────────────────────────────────────────────────────────
const SL_ROWS: SysLibRow[] = [
  { hash: 'aaaaaaaaaaaa1111', byte_size: 40 * 1024, ref_count: 9, segment_count: 3, first_seen_at: 1_700_000_000_000, last_seen_at: 1_700_000_500_000 },
  { hash: 'bbbbbbbbbbbb2222', byte_size: 20 * 1024, ref_count: 5, segment_count: 2, first_seen_at: 1_700_000_100_000, last_seen_at: 1_700_000_400_000 },
  { hash: 'cccccccccccc3333', byte_size: 1000, ref_count: 1, segment_count: 1, first_seen_at: 1_700_000_200_000, last_seen_at: 1_700_000_300_000 },
];

describe('syslib-sort — 정렬/임계/포맷', () => {
  it('기본 정렬 last_seen_at desc', () => {
    const sorted = slApplySort(SL_ROWS, 'last_seen_at', 'desc');
    expect(sorted[0].hash.startsWith('aaaa')).toBe(true);
  });
  it('미존재 키 → last_seen_at 폴백', () => {
    // @ts-expect-error 무효 키 폴백 동작 확인
    expect(() => slApplySort(SL_ROWS, 'bogus', 'desc')).not.toThrow();
  });
  it('nextSort: ref_count 진입 시 기본 desc', () => {
    expect(slNextSort({ key: 'last_seen_at', dir: 'desc' }, 'ref_count')).toEqual({ key: 'ref_count', dir: 'desc' });
  });
  it('sizeClassFor: >32KB large / >16KB warn / 작으면 ""', () => {
    expect(sizeClassFor(40 * 1024)).toBe('syslib-size-large');
    expect(sizeClassFor(20 * 1024)).toBe('syslib-size-warn');
    expect(sizeClassFor(1000)).toBe('');
  });
  it('formatBytes: B/KB/MB', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
    expect(formatBytes(null)).toBe('-');
  });
  it('formatTime: YYYY-MM-DD HH:MM 형식', () => {
    expect(formatTime(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatTime(null)).toBe('-');
  });
  it('refHotCutoff: ref_count 키일 때만 상위 25%', () => {
    expect(refHotCutoff('ref_count', 3)).toBe(1); // ceil(3*0.25)=1
    expect(refHotCutoff('byte_size', 3)).toBe(0);
  });
});

describe('SystemPromptLibrary — 골든마스터', () => {
  it('빈 rows → state-empty + no-prompts', () => {
    const html = renderToStaticMarkup(<SystemPromptLibrary rows={[]} t={t} />);
    expect(html).toContain('t:ui.syslib.no-prompts');
  });
  it('정상 → syslib-table + 행 + size 임계 클래스 + 정렬 헤더', () => {
    const html = renderToStaticMarkup(
      <SystemPromptLibrary rows={SL_ROWS} sort={{ key: 'last_seen_at', dir: 'desc' }} t={t} />,
    );
    expect(html).toContain('syslib-table');
    expect(html).toContain('data-syslib-sort="byte_size"');
    expect(html).toContain('syslib-size-large'); // 40KB 행
    expect(html).toContain('syslib-size-warn'); // 20KB 행
    expect(html).toContain('data-syslib-hash="aaaaaaaaaaaa1111"');
    expect(html).toContain('aaaaaaaaaaaa…'); // hash.slice(0,12)
  });
  it('ref_count 정렬 시 상위 hot 강조(syslib-ref-hot)', () => {
    const html = renderToStaticMarkup(
      <SystemPromptLibrary rows={SL_ROWS} sort={{ key: 'ref_count', dir: 'desc' }} t={t} />,
    );
    expect(html).toContain('syslib-ref-hot'); // 상위 25% = 1행
  });
  it('다른 키 정렬 시 hot 강조 없음', () => {
    const html = renderToStaticMarkup(
      <SystemPromptLibrary rows={SL_ROWS} sort={{ key: 'byte_size', dir: 'desc' }} t={t} />,
    );
    expect(html).not.toContain('syslib-ref-hot');
  });
});
