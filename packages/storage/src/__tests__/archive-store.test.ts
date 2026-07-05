/**
 * FileArchiveStore — 날짜단위 JSONL+zstd 본문 저장 round-trip (단계2)
 *
 * @see packages/storage/src/archive/archive-store.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileArchiveStore } from '../archive/archive-store';

let dir: string;
let store: FileArchiveStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spyglass-archive-'));
  store = new FileArchiveStore(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const FILE = '2026-06-01.requests.jsonl.zst';

describe('FileArchiveStore', () => {
  test('appendDay → readDay round-trip (JSONL 보존)', () => {
    const lines = [JSON.stringify({ id: 'r1', ts: 100 }), JSON.stringify({ id: 'r2', ts: 200, 한글: '값 🙂' })];
    store.appendDay(FILE, lines);
    expect(store.readDay(FILE)).toEqual(lines);
    // 파싱까지 무손실
    expect(JSON.parse(store.readDay(FILE)[1])).toEqual({ id: 'r2', ts: 200, 한글: '값 🙂' });
  });

  test('append 누적 — 기존 + 신규', () => {
    store.appendDay(FILE, ['a', 'b']);
    store.appendDay(FILE, ['c']);
    expect(store.readDay(FILE)).toEqual(['a', 'b', 'c']);
  });

  test('exists / remove', () => {
    expect(store.exists(FILE)).toBe(false);
    expect(store.readDay(FILE)).toEqual([]); // 미존재 → []
    store.appendDay(FILE, ['x']);
    expect(store.exists(FILE)).toBe(true);
    store.remove(FILE);
    expect(store.exists(FILE)).toBe(false);
    store.remove(FILE); // 재삭제 no-op
  });

  test('빈 lines append는 파일 생성 안 함', () => {
    store.appendDay(FILE, []);
    expect(store.exists(FILE)).toBe(false);
  });

  test('원자적 교체 — 최종 파일만 남고 .tmp 잔존 없음', () => {
    store.appendDay(FILE, ['a']);
    store.appendDay(FILE, ['b']);
    expect(existsSync(join(dir, `${FILE}.tmp`))).toBe(false);
    expect(store.readDay(FILE)).toEqual(['a', 'b']);
  });

  test('압축 효과 — 반복 라인은 원본보다 작게 저장', () => {
    const big = Array.from({ length: 200 }, (_, i) => JSON.stringify({ id: 'r' + i, log: 'repeated line '.repeat(20) }));
    store.appendDay(FILE, big);
    const rawBytes = new TextEncoder().encode(big.join('\n')).byteLength;
    const storedBytes = require('node:fs').statSync(join(dir, FILE)).size;
    expect(storedBytes).toBeLessThan(rawBytes);
    expect(store.readDay(FILE)).toEqual(big);
  });
});
