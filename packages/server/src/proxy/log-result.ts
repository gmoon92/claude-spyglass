/**
 * proxy 모듈 — 요청/응답 stdout 로그 출력
 *
 * 책임:
 *  - 요청 진입(`→`) / 응답 종료(`✓`/`✗`) 시 운영 가시성용 로그를 stdout에 출력.
 *  - 진단 로그(diag-log)와는 별도. stdout은 사용자가 직접 보는 콘솔.
 *  - **DIAG 게이트 (판단 SSoT)**: 정보성 [PROXY] 라인은 SPYGLASS_DIAG_ENABLED 활성
 *    시에만 출력 — hook [RECV] 게이트(d94bc5c)와 동일 방향. 운영 기본값(OFF)에서는
 *    프록시 요청마다 찍히는 stdout 노이즈를 전부 억제한다.
 *    (과거 626777e는 방향이 반대 — "DIAG ON 시 파일 미러와 중복" 논리였으나, 운영
 *    콘솔이 지저분해지는 비용이 더 커서 [RECV]와 같은 opt-in 방향으로 통일.)
 *    warn/error 라인(각 호출처의 console.warn/error)은 게이트 대상이 아니다.
 *
 * 출력 예 (DIAG ON):
 *   [PROXY] → POST /v1/messages [claude-opus-4-7]
 *   [PROXY] ✓ POST /v1/messages → 200 1234ms (stream)
 *   [PROXY]   model    : claude-opus-4-7
 *   [PROXY]   stop     : end_turn
 *   [PROXY]   tokens   : in=100 out=50 cache_create=0 cache_read=0
 *   [PROXY]   ttft     : 250ms
 *   [PROXY]   tps      : 35.8 tok/s
 *   [PROXY]   preview  : ...
 *
 * 외부 노출: proxyInfoLog(...lines), logInbound(p), logResult(p)
 * 호출자: handler/inbound.ts (요청 진입·custom upstream), handler/{stream,non-stream}.ts (응답 종료 직후)
 * 의존성: types, diag-log#isDiagEnabled
 */

import { isDiagEnabled } from '../diag-log';
import type { AnthropicUsage } from './types';

/**
 * 정보성 [PROXY] stdout 공통 헬퍼 — DIAG 게이트 판단 SSoT.
 *
 * diagLog/diagJson 과 같은 패턴: 플래그 판단을 호출 측이 아닌 함수 내부에 둔다.
 * SPYGLASS_DIAG_ENABLED 비활성(운영 기본) 시 no-op — 모든 정보성 [PROXY] 라인은
 * console.log 직접 호출 대신 반드시 이 헬퍼를 거칠 것.
 */
export function proxyInfoLog(...lines: string[]): void {
  if (!isDiagEnabled()) return;
  for (const line of lines) console.log(line);
}

/**
 * 요청 진입 한 건에 대한 사람-읽기용 stdout 한 줄 출력.
 */
export function logInbound(p: { method: string; pathname: string; model: string | null }): void {
  proxyInfoLog(`[PROXY] → ${p.method} ${p.pathname}${p.model ? ` [${p.model}]` : ''}`);
}

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
  const lines = [`[PROXY] ${icon} ${p.method} ${p.path} → ${p.statusCode} ${p.ms}ms${streamLabel}`];
  if (p.model)         lines.push(`[PROXY]   model    : ${p.model}`);
  if (p.stopReason)    lines.push(`[PROXY]   stop     : ${p.stopReason}`);
  if (p.errorType)     lines.push(`[PROXY]   error    : ${p.errorType}`);
  lines.push(
    `[PROXY]   tokens   : in=${p.usage.input_tokens ?? 0}`
    + ` out=${p.usage.output_tokens ?? 0}`
    + ` cache_create=${p.usage.cache_creation_input_tokens ?? 0}`
    + ` cache_read=${p.usage.cache_read_input_tokens ?? 0}`,
  );
  if (p.ttft !== null)  lines.push(`[PROXY]   ttft     : ${p.ttft}ms`);
  if (p.tps !== null)   lines.push(`[PROXY]   tps      : ${p.tps.toFixed(1)} tok/s`);
  if (p.requestPreview) lines.push(`[PROXY]   preview  : ${p.requestPreview.slice(0, 80)}…`);
  proxyInfoLog(...lines);
}
