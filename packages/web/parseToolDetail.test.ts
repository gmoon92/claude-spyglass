/**
 * parseToolDetail 단위 테스트 (P3-05 GAP-1 — SSoT 재연결)
 *
 * @description
 *  ★재연결★: parseToolDetail 은 이미 assets/js/render/extract.js:212 에 export 로 존재한다.
 *  과거 본 테스트는 인라인 복제본을 자체 정의해 SSoT 가 2곳으로 분기했다(review-safety GAP-1).
 *  이번 라운드에서 인라인 복제본을 제거하고 extract.js 의 export 를 직접 import 한다.
 *  별도 src/lib 추출은 3번째 사본을 만들 위험이 있어 금지 — extract.js export 가 단일 SSoT.
 *
 *  동작 동치: 기존 9개 케이스(인라인 복제본이 통과시키던 동작)를 SSoT import 로 그대로 통과시켜
 *  "복제본 ≡ SSoT" 를 증명한다(입력→출력 불변). + JSON 중첩값 직렬화 케이스 1건 보강(총 10).
 */

import { describe, it, expect } from 'bun:test';
// SSoT 단일화 — 인라인 복제본 제거, extract.js export 재사용.
import { parseToolDetail } from './assets/js/render/extract.js';

describe('parseToolDetail (SSoT = render/extract.js)', () => {
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

  it('JSON 중첩 값 — 문자열 아닌 값은 JSON.stringify (extract.js:218)', () => {
    const raw = JSON.stringify({ count: 3, ok: true });
    const result = parseToolDetail(raw)!;
    expect(result).toContain('count: 3');
    expect(result).toContain('ok: true');
  });
});
