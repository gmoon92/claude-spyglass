/**
 * instruction-footprint — 지침 문서 주입 현황 집계 (queries/instruction-footprint.ts).
 *
 * 검증 핵심:
 *  - parseInstructionBlocks: 실제 system_reminder 모양(마커 줄·괄호 설명 유무·블록 끝 판정·한글 바이트·중복 첨부)
 *  - getInstructionFootprint: 세션별 최근 요청 1건 표본, 파일별 평균/최대 바이트, path_prefix 와 rel_path,
 *    InstructionsLoaded 로드 집계, 일별 추이, 시스템 프롬프트 크기, 기간·표본 상한
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createEvent } from '../queries/event';
import { createProxyRequest } from '../queries/proxy';
import { getInstructionFootprint, parseInstructionBlocks } from '../queries/instruction-footprint';

const HUB = '/work/hub';
const body = (n: number, ch = 'x') => ch.repeat(n);

/** Claude Code 가 붙이는 모양을 본뜬 reminder. 각 블록은 `Contents of` 마커 줄로 시작한다. */
function reminder(parts: Array<{ path: string; desc?: string; text: string }>): string {
  const blocks = parts.map((p) => `Contents of ${p.path}${p.desc ? ` (${p.desc})` : ''}:\n\n${p.text}\n\n`);
  return `<system-reminder>\nCodebase and user instructions are shown below.\n\n${blocks.join('')}</system-reminder>\n`;
}

describe('parseInstructionBlocks', () => {
  it('설명이 있는 마커와 없는 마커를 모두 읽고 블록별 바이트를 센다', () => {
    const text = reminder([
      { path: `${HUB}/CLAUDE.md`, desc: 'project instructions, checked into the codebase', text: body(100) },
      { path: `${HUB}/.claude/rules/a.md`, text: body(40) },
    ]);
    expect(parseInstructionBlocks(text)).toEqual([
      { file_path: `${HUB}/CLAUDE.md`, description: 'project instructions, checked into the codebase', bytes: 100 },
      { file_path: `${HUB}/.claude/rules/a.md`, description: null, bytes: 40 },
    ]);
  });

  it('블록은 다음 마커 또는 </system-reminder> 에서 끝난다 (뒤따르는 userEmail 등은 포함하지 않는다)', () => {
    const text =
      `<system-reminder>\nContents of ${HUB}/MEMORY.md (auto-memory):\n\n${body(30)}\n</system-reminder>\n` +
      `<system-reminder>\n# userEmail\n${body(500)}\n</system-reminder>`;
    expect(parseInstructionBlocks(text)).toEqual([{ file_path: `${HUB}/MEMORY.md`, description: 'auto-memory', bytes: 30 }]);
  });

  it('바이트는 UTF-8 기준 — 한글 3바이트', () => {
    const text = reminder([{ path: '/a.md', text: '가나다' }]);
    expect(parseInstructionBlocks(text)[0].bytes).toBe(9);
  });

  it('같은 파일이 여러 번 실리면 실린 만큼 항목이 나온다', () => {
    const text = reminder([{ path: '/a.md', text: body(10) }]) + reminder([{ path: '/a.md', text: body(10) }]);
    expect(parseInstructionBlocks(text).map((b) => b.file_path)).toEqual(['/a.md', '/a.md']);
  });

  it('본문 중간의 "Contents of" 문장·마커 모양이 아닌 줄은 마커로 보지 않는다', () => {
    const text = reminder([{ path: '/a.md', text: 'see Contents of the file (not a marker): ok\nmore' }]);
    expect(parseInstructionBlocks(text)).toHaveLength(1);
  });

  it('마커가 없으면 빈 배열 (형식이 바뀌어도 깨지지 않고 빈다)', () => {
    expect(parseInstructionBlocks('<system-reminder>\nhello\n</system-reminder>')).toEqual([]);
    expect(parseInstructionBlocks('')).toEqual([]);
  });
});

describe('getInstructionFootprint', () => {
  let db: Database;
  const T = 1_700_000_000_000;
  let seq = 0;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    seq = 0;
  });
  afterEach(() => db.close());

  function proxy(session: string, ts: number, text: string | null, systemBytes?: number): void {
    createProxyRequest(db, {
      id: `p-${++seq}`, timestamp: ts, method: 'POST', path: '/v1/messages',
      session_id: session, system_reminder: text,
    });
    if (systemBytes !== undefined) {
      db.run('UPDATE proxy_requests SET system_byte_size = ? WHERE id = ?', [systemBytes, `p-${seq}`]);
    }
  }
  function loaded(session: string, ts: number, file: string, reason: string, memoryType = 'Project'): void {
    createEvent(db, {
      event_id: `e-${++seq}`, event_type: 'InstructionsLoaded', session_id: session, cwd: HUB, timestamp: ts,
      payload: JSON.stringify({ file_path: file, memory_type: memoryType, load_reason: reason }),
    });
  }

  it('세션별 가장 최근 요청의 reminder 만 표본으로 쓰고 파일별 평균·최대를 낸다', () => {
    // s1: 오래된 요청(작은 CLAUDE.md)과 최근 요청(큰 CLAUDE.md) — 최근 것만 본다
    proxy('s1', T, reminder([{ path: `${HUB}/CLAUDE.md`, desc: 'project', text: body(10) }]));
    proxy('s1', T + 1000, reminder([{ path: `${HUB}/CLAUDE.md`, desc: 'project', text: body(100) }, { path: `${HUB}/r.md`, text: body(50) }]));
    proxy('s2', T + 500, reminder([{ path: `${HUB}/CLAUDE.md`, desc: 'project', text: body(300) }]));
    const r = getInstructionFootprint(db, {});
    expect(r.sampled_sessions).toBe(2);
    const claude = r.files.find((f) => f.file_path === `${HUB}/CLAUDE.md`)!;
    expect(claude).toMatchObject({ sessions: 2, avg_bytes: 200, max_bytes: 300, copies_max: 1, kind: 'project' });
    expect(r.files.find((f) => f.file_path === `${HUB}/r.md`)).toMatchObject({ sessions: 1, avg_bytes: 50 });
    expect(r.files[0].file_path).toBe(`${HUB}/CLAUDE.md`); // 평균 바이트 큰 순
  });

  it('같은 reminder 에 같은 파일이 두 번 실리면 합산하고 copies_max 로 드러낸다', () => {
    proxy('s1', T, reminder([{ path: '/a.md', text: body(40) }]) + reminder([{ path: '/a.md', text: body(40) }]));
    const a = getInstructionFootprint(db, {}).files[0];
    expect(a).toMatchObject({ avg_bytes: 80, copies_max: 2 });
  });

  it('path_prefix 로 파일을 거르고 rel_path 를 붙인다 (접두 밖은 제외)', () => {
    proxy('s1', T, reminder([
      { path: `${HUB}/CLAUDE.md`, text: body(10) },
      { path: `${HUB}/.claude/rules/x.md`, text: body(20) },
      { path: '/home/u/.claude/MEMORY.md', text: body(30) },
    ]));
    const r = getInstructionFootprint(db, { pathPrefix: HUB });
    expect(r.files.map((f) => f.rel_path).sort()).toEqual(['.claude/rules/x.md', 'CLAUDE.md']);
    expect(getInstructionFootprint(db, {}).files.every((f) => f.rel_path === null)).toBe(true);
  });

  it('InstructionsLoaded 로 로드 횟수·사유별 분해·마지막 시각을 센다 (reminder 에 없는 파일도 나온다)', () => {
    loaded('s1', T + 10, `${HUB}/CLAUDE.md`, 'session_start');
    loaded('s1', T + 20, `${HUB}/CLAUDE.md`, 'compact');
    loaded('s2', T + 30, `${HUB}/.claude/rules/p.md`, 'path_glob_match');
    const r = getInstructionFootprint(db, {});
    const c = r.files.find((f) => f.file_path === `${HUB}/CLAUDE.md`)!;
    expect(c).toMatchObject({ loads: 2, by_reason: { session_start: 1, compact: 1 }, last_loaded_at: T + 20, kind: 'Project', avg_bytes: null, copies_max: null, sessions: 0 });
    expect(r.load_events).toBe(3);
  });

  it('reminder 바이트와 로드 횟수가 한 파일 항목으로 합쳐진다', () => {
    proxy('s1', T, reminder([{ path: `${HUB}/CLAUDE.md`, text: body(60) }]));
    loaded('s1', T + 5, `${HUB}/CLAUDE.md`, 'session_start');
    const f = getInstructionFootprint(db, {}).files;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ loads: 1, avg_bytes: 60 });
  });

  it('기간 필터 — 범위 밖 요청·이벤트는 제외', () => {
    proxy('old', T, reminder([{ path: '/old.md', text: body(10) }]));
    proxy('new', T + 10_000, reminder([{ path: '/new.md', text: body(10) }]));
    loaded('old', T, '/old.md', 'session_start');
    const r = getInstructionFootprint(db, { fromTs: T + 5000 });
    expect(r.files.map((f) => f.file_path)).toEqual(['/new.md']);
    expect(r.sampled_sessions).toBe(1);
    expect(r.load_events).toBe(0);
  });

  it('표본 상한(sessionLimit) — 최근 활동 세션부터', () => {
    for (let i = 0; i < 5; i++) proxy(`s${i}`, T + i * 1000, reminder([{ path: `/f${i}.md`, text: body(10) }]));
    const r = getInstructionFootprint(db, { sessionLimit: 2 });
    expect(r.sampled_sessions).toBe(2);
    expect(r.files.map((f) => f.file_path).sort()).toEqual(['/f3.md', '/f4.md']);
  });

  it('reminder_bytes — 표본 평균·최대와 일별 추이', () => {
    const small = reminder([{ path: '/a.md', text: body(10) }]);
    const big = reminder([{ path: '/a.md', text: body(1000) }]);
    proxy('s1', T, small);
    proxy('s2', T + 1000, big);
    const r = getInstructionFootprint(db, {});
    expect(r.reminder_bytes.sessions).toBe(2);
    expect(r.reminder_bytes.max).toBe(Buffer.byteLength(big, 'utf8'));
    expect(r.reminder_bytes.avg).toBe(Math.round((Buffer.byteLength(small, 'utf8') + Buffer.byteLength(big, 'utf8')) / 2));
    expect(r.reminder_bytes.by_day).toBeNull(); // 기본은 추이를 계산하지 않는다
    const withTrend = getInstructionFootprint(db, { includeTrend: true }).reminder_bytes.by_day!;
    expect(withTrend).toHaveLength(1);
    expect(withTrend[0].requests).toBe(2);
  });

  it('system_prompt_bytes — 최신값과 최대값', () => {
    proxy('s1', T, null, 5000);
    proxy('s1', T + 1000, null, 3000);
    const r = getInstructionFootprint(db, {});
    expect(r.system_prompt_bytes).toEqual({ latest: 3000, max: 5000, latest_at: T + 1000 });
  });

  it('데이터가 없으면 비어 있다', () => {
    const r = getInstructionFootprint(db, {});
    expect(r.files).toEqual([]);
    expect(r.reminder_bytes).toEqual({ avg: null, max: null, sessions: 0, by_day: null });
    expect(getInstructionFootprint(db, { includeTrend: true }).reminder_bytes.by_day).toEqual([]);
    expect(r.system_prompt_bytes).toEqual({ latest: null, max: null, latest_at: null });
    expect(r.sampled_sessions).toBe(0);
  });

  it('마커 형식이 아닌 reminder 는 파일 없이 reminder_bytes 만 남는다', () => {
    proxy('s1', T, '<system-reminder>\nunknown format\n</system-reminder>');
    const r = getInstructionFootprint(db, {});
    expect(r.files).toEqual([]);
    expect(r.reminder_bytes.sessions).toBe(1);
  });
});
