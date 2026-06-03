/**
 * T7 — malformed/누락 transcript_path 시 tokens_confidence·tokens_source 저장값 고정.
 *
 * 검증 목적 (parseTranscript → deriveTokensConfidence → persist 경로 특성화):
 *   PostToolUseHandler 는 transcript 를 파싱해 토큰 신뢰도를 결정한다.
 *     - 깨진 JSONL(PARSE_ERROR) / 미존재 파일(NOT_FOUND) / 경로 누락
 *       → parseTranscript 가 confidence='error' 반환
 *       → deriveTokensConfidence → tokens_confidence='error', tokens_source='unavailable'
 *       → tokens_input/output=0 으로 저장.
 *     - 정상 transcript(assistant + usage) → tokens_confidence='high', tokens_source='transcript',
 *       usage 값 그대로.
 *
 *   본 테스트는 raw PostToolUse 를 handleHookHttpRequest 로 흘려 end-to-end 로 저장값을 고정한다.
 *   (현재 동작이 스펙 — 에러 시 토큰 0 + error 라벨.)
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase().
 *       임시 transcript 파일도 afterEach 에서 정리. SSE: post 는 broadcast 하지만 연결 0개라 no-op.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SpyglassDatabase, closeDatabase, getRequestById } from '@spyglass/storage';
import { handleHookHttpRequest } from '../http-entry';
import type { HookProcessResult } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-token-conf-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

function sendPost(db: SpyglassDatabase, raw: Record<string, unknown>): Promise<HookProcessResult> {
  const req = new Request('http://localhost/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hook_event_name: 'PostToolUse', ...raw }),
  });
  return handleHookHttpRequest(req, db).then((r) => r.json() as Promise<HookProcessResult>);
}

describe('T7 — transcript 에러 시 tokens_confidence 저장값', () => {
  let db: SpyglassDatabase;
  let tmpDir: string;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    tmpDir = mkdtempSync(join(tmpdir(), 'spyglass-tc-'));
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('깨진 JSONL(PARSE_ERROR) → tokens_confidence="error", tokens_source="unavailable", 토큰 0', async () => {
    const badPath = join(tmpDir, 'broken.jsonl');
    // assistant 라인이지만 JSON 으로 파싱 불가 → PARSE_ERROR.
    writeFileSync(badPath, '{"type":"assistant", BROKEN NOT JSON\n');

    const result = await sendPost(db, {
      session_id: crypto.randomUUID(),
      cwd: '/tmp/proj-tc',
      tool_name: 'Bash',
      tool_use_id: 'tu-tc-parse-error',
      tool_input: { command: 'ls' },
      tool_response: { ok: true },
      transcript_path: badPath,
    });
    expect(result.success).toBe(true);

    const row = getRequestById(db.instance, result.request_id)!;
    expect(row.tokens_confidence).toBe('error');
    expect(row.tokens_source).toBe('unavailable');
    expect(row.tokens_input).toBe(0);
    expect(row.tokens_output).toBe(0);
    expect(row.tokens_total).toBe(0);
  });

  it('미존재 transcript_path(NOT_FOUND) → tokens_confidence="error", 토큰 0', async () => {
    const missingPath = join(tmpDir, 'does-not-exist.jsonl');
    const result = await sendPost(db, {
      session_id: crypto.randomUUID(),
      cwd: '/tmp/proj-tc',
      tool_name: 'Bash',
      tool_use_id: 'tu-tc-not-found',
      tool_input: { command: 'ls' },
      tool_response: { ok: true },
      transcript_path: missingPath,
    });
    const row = getRequestById(db.instance, result.request_id)!;
    expect(row.tokens_confidence).toBe('error');
    expect(row.tokens_source).toBe('unavailable');
    expect(row.tokens_total).toBe(0);
  });

  it('transcript_path 누락 → tokens_confidence="high"(NOT "error"), 토큰 0 — 현재 동작 고정', async () => {
    // 주의(현재 동작/잠재 위험): transcript_path 가 *아예 없으면* resolveTranscriptContext 가
    // parseTranscript 를 호출하지 않고 transcriptData=null 로 early-return 한다. 그러면
    // PostToolUseHandler 의 `transcriptData?.inputTokens.confidence ?? 'high'` nullish 폴백이
    // 'high' 로 떨어진다 — 즉 경로 누락은 'error' 가 아니라 'high'(토큰 0). 반면 경로가 *있지만*
    // 깨진(PARSE_ERROR)·미존재(NOT_FOUND) 케이스는 'error' 로 라벨된다. 이 비대칭은 후속 분석에서
    // "토큰 0 + high" 가 진짜 0 토큰 도구인지 transcript 미flush 인지 구분 불가하게 만들 수 있다.
    // 본 테스트는 현재 동작을 고정만 한다(프로덕션 미수정).
    const result = await sendPost(db, {
      session_id: crypto.randomUUID(),
      cwd: '/tmp/proj-tc',
      tool_name: 'Bash',
      tool_use_id: 'tu-tc-missing-path',
      tool_input: { command: 'ls' },
      tool_response: { ok: true },
      // transcript_path 의도적 누락
    });
    const row = getRequestById(db.instance, result.request_id)!;
    expect(row.tokens_confidence).toBe('high');
    expect(row.tokens_source).toBe('transcript');
    expect(row.tokens_total).toBe(0);
  });

  it('정상 transcript(assistant+usage) → tokens_confidence="high", tokens_source="transcript", usage 반영', async () => {
    const goodPath = join(tmpDir, 'good.jsonl');
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 12, output_tokens: 34, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });
    writeFileSync(goodPath, line + '\n');

    const result = await sendPost(db, {
      session_id: crypto.randomUUID(),
      cwd: '/tmp/proj-tc',
      tool_name: 'Bash',
      tool_use_id: 'tu-tc-ok',
      tool_input: { command: 'ls' },
      tool_response: { ok: true },
      transcript_path: goodPath,
    });
    const row = getRequestById(db.instance, result.request_id)!;
    expect(row.tokens_confidence).toBe('high');
    expect(row.tokens_source).toBe('transcript');
    expect(row.tokens_input).toBe(12);
    expect(row.tokens_output).toBe(34);
    expect(row.tokens_total).toBe(46);
  });
});
