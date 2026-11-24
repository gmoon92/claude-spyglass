/**
 * detectSubagent — billing-header 의 cc_is_subagent 로 서브에이전트 요청 판정.
 * backfill 이 메인/서브 행을 구분하는 근거라, 형태별(string / text 배열 / header 없음)로 고정한다.
 */

import { describe, expect, test } from 'bun:test';
import { detectSubagent, parseRequestBody } from '../request-parser';

const SUB = 'x-anthropic-billing-header: cc_version=2.1.330.068; cc_entrypoint=cli; cc_is_subagent=true;';
const MAIN = 'x-anthropic-billing-header: cc_version=2.1.330.fd6; cc_entrypoint=cli;';

describe('detectSubagent', () => {
  test('text 배열 첫 블록의 cc_is_subagent=true → true', () => {
    expect(detectSubagent([{ type: 'text', text: SUB }, { type: 'text', text: 'You are...' }])).toBe(true);
  });
  test('header 는 있지만 플래그가 없으면 → false', () => {
    expect(detectSubagent([{ type: 'text', text: MAIN }])).toBe(false);
  });
  test('string system 도 처리한다', () => {
    expect(detectSubagent(`${SUB}\nYou are a helper`)).toBe(true);
  });
  test('header 가 없으면 판정 불가 → null', () => {
    expect(detectSubagent('You are Claude')).toBeNull();
    expect(detectSubagent(undefined)).toBeNull();
  });
  test('header 다음 줄의 문자열은 판정에 쓰지 않는다', () => {
    expect(detectSubagent(`${MAIN}\nmention cc_is_subagent=true in prose`)).toBe(false);
  });
  test('parseRequestBody 가 isSubagent 를 채운다', () => {
    const body = JSON.stringify({ model: 'claude-opus-5-5', system: [{ type: 'text', text: SUB }], messages: [] });
    expect(parseRequestBody(new TextEncoder().encode(body).buffer as ArrayBuffer).isSubagent).toBe(true);
  });
});
