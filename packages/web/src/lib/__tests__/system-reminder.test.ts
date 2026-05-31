/**
 * system-reminder.test.ts — turn 단위 system-reminder 블록 분해 + 누적 dedup/diff (P3-07)
 *
 * 원본: assets/js/session-detail/system-reminder.js (parseReminderBodies / computeNewRemindersByTurn).
 * lib/ 는 universal leaf(architecture.md §1.3) — import 0 순수함수라 위험 최소(§2.3).
 * 전략: 원본 SSoT 1:1 이식 검증 — 정규식 본문 추출·trim·세션 누적 dedup·turn_index ASC 정렬
 *   불변식 + 적대적 경계(빈 입력/비문자열/중첩 줄바꿈/turn 내 중복).
 */
import { describe, it, expect } from 'bun:test';
import { parseReminderBodies, computeNewRemindersByTurn } from '../system-reminder';

describe('parseReminderBodies — 블록 본문 추출(system-reminder.js:32)', () => {
  it('단일 블록 → 본문 1개(trim)', () => {
    expect(parseReminderBodies('<system-reminder>  hello  </system-reminder>')).toEqual(['hello']);
  });

  it('복수 블록 → 등장 순서대로 모두', () => {
    const raw = '<system-reminder>a</system-reminder>\nmid\n<system-reminder>b</system-reminder>';
    expect(parseReminderBodies(raw)).toEqual(['a', 'b']);
  });

  it('태그 안 줄바꿈 안전([\\s\\S]*?)', () => {
    const raw = '<system-reminder>line1\nline2</system-reminder>';
    expect(parseReminderBodies(raw)).toEqual(['line1\nline2']);
  });

  it('turn 내 동일 본문 중복은 그대로 중복 반환(dedup 은 호출 측 책임)', () => {
    const raw = '<system-reminder>x</system-reminder><system-reminder>x</system-reminder>';
    expect(parseReminderBodies(raw)).toEqual(['x', 'x']);
  });

  it('빈 본문(trim 후 길이 0) 무시', () => {
    expect(parseReminderBodies('<system-reminder>   </system-reminder>')).toEqual([]);
  });

  // ── 적대적 경계 ──
  it('null/undefined/비문자열 → 빈 배열', () => {
    expect(parseReminderBodies(null)).toEqual([]);
    expect(parseReminderBodies(undefined)).toEqual([]);
    expect(parseReminderBodies(123 as unknown as string)).toEqual([]);
    expect(parseReminderBodies('')).toEqual([]);
  });

  it('블록 없음 → 빈 배열', () => {
    expect(parseReminderBodies('plain text no tags')).toEqual([]);
  });

  it('글로벌 정규식 state 재진입 안전(lastIndex 리셋) — 연속 호출 동일 결과', () => {
    const raw = '<system-reminder>a</system-reminder>';
    expect(parseReminderBodies(raw)).toEqual(['a']);
    expect(parseReminderBodies(raw)).toEqual(['a']); // 두 번째도 동일(lastIndex 누수 없음)
    expect(parseReminderBodies(raw)).toEqual(['a']);
  });
});

describe('computeNewRemindersByTurn — 세션 누적 dedup/diff(system-reminder.js:54)', () => {
  it('각 turn 의 신규 reminder 만 Map(turn_id→bodies)', () => {
    const turns = [
      { turn_id: 't1', turn_index: 1, system_reminder: '<system-reminder>hook A</system-reminder>' },
      { turn_id: 't2', turn_index: 2, system_reminder: '<system-reminder>hook B</system-reminder>' },
    ];
    const m = computeNewRemindersByTurn(turns);
    expect(m.get('t1')).toEqual(['hook A']);
    expect(m.get('t2')).toEqual(['hook B']);
  });

  it('한 번 본 reminder 는 이후 turn 에서 신규 미취급(세션 누적 dedup)', () => {
    const turns = [
      { turn_id: 't1', turn_index: 1, system_reminder: '<system-reminder>same</system-reminder>' },
      { turn_id: 't2', turn_index: 2, system_reminder: '<system-reminder>same</system-reminder>' },
      { turn_id: 't3', turn_index: 3, system_reminder: '<system-reminder>same</system-reminder><system-reminder>fresh</system-reminder>' },
    ];
    const m = computeNewRemindersByTurn(turns);
    expect(m.get('t1')).toEqual(['same']);
    expect(m.has('t2')).toBe(false); // 신규 0건 → 항목 없음
    expect(m.get('t3')).toEqual(['fresh']); // same 은 이미 본 것, fresh 만 신규
  });

  it('turn_index ASC 정렬 후 dedup — 입력 순서 무관(내부 정렬)', () => {
    // 입력은 역순이지만 chronological(index ASC)로 t1 이 same 을 먼저 소유.
    const turns = [
      { turn_id: 't2', turn_index: 2, system_reminder: '<system-reminder>same</system-reminder>' },
      { turn_id: 't1', turn_index: 1, system_reminder: '<system-reminder>same</system-reminder>' },
    ];
    const m = computeNewRemindersByTurn(turns);
    expect(m.get('t1')).toEqual(['same']); // index 1 이 먼저 → 소유
    expect(m.has('t2')).toBe(false);
  });

  it('turn 내 중복 본문은 turn 내에서도 한 번만 신규(seen 즉시 추가)', () => {
    const turns = [
      { turn_id: 't1', turn_index: 1, system_reminder: '<system-reminder>dup</system-reminder><system-reminder>dup</system-reminder>' },
    ];
    expect(computeNewRemindersByTurn(turns).get('t1')).toEqual(['dup']);
  });

  it('신규 0건 turn 은 Map 에 항목 없음(.get → undefined)', () => {
    const turns = [
      { turn_id: 't1', turn_index: 1, system_reminder: null },
      { turn_id: 't2', turn_index: 2, system_reminder: '<system-reminder>  </system-reminder>' },
    ];
    const m = computeNewRemindersByTurn(turns);
    expect(m.has('t1')).toBe(false);
    expect(m.has('t2')).toBe(false);
    expect(m.size).toBe(0);
  });

  // ── 적대적 경계 ──
  it('빈 배열/비배열 → 빈 Map', () => {
    expect(computeNewRemindersByTurn([]).size).toBe(0);
    expect(computeNewRemindersByTurn(null as unknown as []).size).toBe(0);
    expect(computeNewRemindersByTurn(undefined as unknown as []).size).toBe(0);
  });

  it('turn_index 누락 → 0 으로 취급(정렬 안정)', () => {
    const turns = [
      { turn_id: 't1', system_reminder: '<system-reminder>a</system-reminder>' } as { turn_id: string; turn_index?: number; system_reminder?: string | null },
    ];
    expect(computeNewRemindersByTurn(turns as never).get('t1')).toEqual(['a']);
  });

  it('입력 turns 배열을 변이하지 않는다(slice 사본 정렬)', () => {
    const turns = [
      { turn_id: 't2', turn_index: 2, system_reminder: '<system-reminder>b</system-reminder>' },
      { turn_id: 't1', turn_index: 1, system_reminder: '<system-reminder>a</system-reminder>' },
    ];
    computeNewRemindersByTurn(turns);
    expect(turns[0].turn_id).toBe('t2'); // 원본 순서 보존
    expect(turns[1].turn_id).toBe('t1');
  });
});
