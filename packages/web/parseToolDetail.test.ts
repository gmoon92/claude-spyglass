/**
 * parseToolDetail 단위 테스트
 *
 * @description index.html에서 추출한 parseToolDetail 함수를 검증한다.
 */

import { describe, it, expect } from 'bun:test';

function parseToolDetail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.entries(obj).slice(0, 3)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' · ');
    }
  } catch {}
  try {
    const lines = (raw as string).split('\n').filter((l: string) => /^\w[\w\s]*=/.test(l.trim()));
    if (lines.length) return lines.slice(0, 3).map((l: string) => l.trim()).join(' · ');
  } catch {}
  return raw;
}

describe('parseToolDetail', () => {
  it('JSON 객체 — key: value 포맷으로 변환', () => {
    const raw = JSON.stringify({ file_path: '/src/app.ts', command: 'read' });
    const result = parseToolDetail(raw);
    expect(result).toContain('file_path: /src/app.ts');
    expect(result).toContain('command: read');
  });

  it('JSON 배열 — raw 폴백', () => {
    const raw = JSON.stringify(['a', 'b']);
    const result = parseToolDetail(raw);
    expect(result).toBe(raw);
  });

  it('깨진 JSON + key=value 줄 폴백', () => {
    const raw = 'invalid{json\npath=/src/app.ts\nline=42';
    const result = parseToolDetail(raw);
    expect(result).toContain('path=/src/app.ts');
    expect(result).toContain('line=42');
  });

  it('null 입력 — null 반환', () => {
    expect(parseToolDetail(null)).toBeNull();
  });

  it('undefined 입력 — null 반환', () => {
    expect(parseToolDetail(undefined)).toBeNull();
  });

  it('빈 문자열 — null 반환', () => {
    expect(parseToolDetail('')).toBeNull();
  });

  it('JSON도 key=value도 아닌 단순 텍스트 — 원본 그대로 반환', () => {
    const raw = 'some plain text without structure';
    expect(parseToolDetail(raw)).toBe(raw);
  });

  it('JSON 키 3개 초과 — 최대 3개만 포함', () => {
    const obj = { a: '1', b: '2', c: '3', d: '4', e: '5' };
    const result = parseToolDetail(JSON.stringify(obj))!;
    const parts = result.split(' · ');
    expect(parts.length).toBeLessThanOrEqual(3);
  });

  it('80자 초과 입력도 그대로 반환 (truncate는 호출자 책임)', () => {
    const raw = 'x'.repeat(100);
    const result = parseToolDetail(raw);
    expect(result).toBe(raw);
    expect(result!.length).toBe(100);
  });
});
