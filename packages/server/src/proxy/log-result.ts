/**
 * proxy 모듈 — 응답 결과 stdout 로그 출력
 *
 * 책임:
 *  - upstream 응답 종료 후 운영 가시성용 단일 라인 로그를 stdout에 출력.
 *  - 진단 로그(diag-log)와는 별도. stdout은 사용자가 직접 보는 콘솔.
 *
 * 출력 예:
 *   [PROXY] ✓ POST /v1/messages → 200 1234ms (stream)
 *   [PROXY]   model    : claude-opus-4-7
 *   [PROXY]   stop     : end_turn
 *   [PROXY]   tokens   : in=100 out=50 cache_create=0 cache_read=0
 *   [PROXY]   ttft     : 250ms
 *   [PROXY]   tps      : 35.8 tok/s
 *   [PROXY]   preview  : ...
 *
 * 외부 노출: logResult(p)
 * 호출자: handler.ts (스트리밍/비스트리밍 응답 종료 직후)
 * 의존성: types
 */

import type { AnthropicUsage } from './types';

/**
 * 응답 한 건에 대한 사람-읽기용 stdout 요약 출력.
 */
export function logResult(p: {
  method: string;
  path: string;
  statusCode: number;
  ms: number;
  isStream: boolean;
  model: string | null;
  usage: AnthropicUsage;
  tps: number | null;
  stopReason: string | null;
  ttft: number | null;
  errorType: string | null;
  requestPreview: string | null;
}): void {
  const ok = p.statusCode >= 200 && p.statusCode < 300;
  const icon = ok ? '✓' : '✗';
  const streamLabel = p.isStream ? ' (stream)' : '';
  console.log(`[PROXY] ${icon} ${p.method} ${p.path} → ${p.statusCode} ${p.ms}ms${streamLabel}`);
  if (p.model)         console.log(`[PROXY]   model    : ${p.model}`);
  if (p.stopReason)    console.log(`[PROXY]   stop     : ${p.stopReason}`);
  if (p.errorType)     console.log(`[PROXY]   error    : ${p.errorType}`);
  console.log(
    `[PROXY]   tokens   : in=${p.usage.input_tokens ?? 0}`
    + ` out=${p.usage.output_tokens ?? 0}`
    + ` cache_create=${p.usage.cache_creation_input_tokens ?? 0}`
    + ` cache_read=${p.usage.cache_read_input_tokens ?? 0}`,
  );
  if (p.ttft !== null)  console.log(`[PROXY]   ttft     : ${p.ttft}ms`);
  if (p.tps !== null)   console.log(`[PROXY]   tps      : ${p.tps.toFixed(1)} tok/s`);
  if (p.requestPreview) console.log(`[PROXY]   preview  : ${p.requestPreview.slice(0, 80)}…`);
}
