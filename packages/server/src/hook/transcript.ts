/**
 * hook 모듈 — transcript JSONL 파싱
 *
 * 책임:
 *  - Claude Code가 디스크에 쓰는 transcript JSONL 파일을 읽어 토큰 usage + model 추출
 *  - 메인 세션 transcript와 서브에이전트 transcript의 경로 규약을 정의
 *
 * 외부 노출 (export):
 *  - parseTranscript(path)              : 단일 transcript에서 마지막 assistant의 usage·model 추출
 *  - resolveSubagentTranscriptPath(...) : 서브에이전트 전용 transcript 경로 계산
 *  - extractSubagentToolCalls(path)     : 서브 transcript에서 모든 tool_use 항목 추출
 *
 * 호출자:
 *  - transcript-context.ts: hook payload 컨텍스트에 따라 어느 transcript를 볼지 결정 후 호출
 *  - raw-handler.ts (PostToolUse Agent 분기): 자식 tool_use 추출 후 persistSubagentChildren에 전달
 *
 * 의존성:
 *  - node:fs (readFileSync) — 동기 파일 읽기 (collect 흐름은 한 번에 한 hook 처리이므로 OK)
 *  - diag-log: 진단 로그 (model-trace.log)
 */

import { readFileSync } from 'node:fs';
import { diagLog } from '../diag-log';
import type { TokenResult, TranscriptUsage, SubagentChildToolCall } from './types';

/**
 * transcript JSONL 파일에서 마지막 assistant 메시지의 usage + model 추출.
 *
 * transcript_path의 JSONL은 각 라인이 독립 JSON 객체.
 * 마지막 type='assistant' 라인에서 message.usage, message.model 추출.
 *
 * 반환 형식:
 *  - 파일 미존재: 모든 토큰 value=null, error='NOT_FOUND'
 *  - JSON 파싱 실패: error='PARSE_ERROR'
 *  - usage 필드 부재(드물지만 model만 있는 케이스): error='NO_USAGE', model은 채움
 *  - 성공: value=n, confidence='high', source='transcript'
 *
 * 알려진 한계 — 새 세션 첫 prompt:
 *  transcript에 user 라인만 1개 있을 때(`NO_ASSISTANT_LINE`)는 model='', tokens=0.
 *  이 케이스는 proxy 측 backfill로 보정한다. (proxy/backfill.ts)
 */
export function parseTranscript(transcriptPath: string): TranscriptUsage {
  const errorResult = (err: string): TokenResult => ({
    value: null,
    confidence: 'error',
    source: 'unavailable',
    error: err,
  });

  const successResult = (value: number): TokenResult => ({
    value,
    confidence: 'high',
    source: 'transcript',
  });

  const defaultResult: TranscriptUsage = {
    inputTokens: errorResult('NOT_FOUND'),
    outputTokens: errorResult('NOT_FOUND'),
    cacheCreationTokens: errorResult('NOT_FOUND'),
    cacheReadTokens: errorResult('NOT_FOUND'),
    model: '',
  };

  if (!transcriptPath) {
    diagLog('model-trace', `parseTranscript: empty path → defaultResult(model='')`);
    return defaultResult;
  }

  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter((line: string) => line.trim());
    let assistantSeen = 0;

    // 마지막 assistant 메시지 탐색 (뒤에서 앞으로) — 최신 turn의 usage만 필요
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>;
        if (entry.type !== 'assistant') continue;
        assistantSeen++;

        const message = entry.message as Record<string, unknown> | undefined;
        if (!message) continue;

        const usage = message.usage as Record<string, unknown> | undefined;
        if (!usage) {
          diagLog('model-trace',
            `parseTranscript: NO_USAGE path=${transcriptPath} `
              + `lines=${lines.length} assistantSeen=${assistantSeen} model='${(message.model as string) ?? ''}'`,
          );
          return {
            inputTokens: errorResult('NO_USAGE'),
            outputTokens: errorResult('NO_USAGE'),
            cacheCreationTokens: errorResult('NO_USAGE'),
            cacheReadTokens: errorResult('NO_USAGE'),
            model: (message.model as string) ?? '',
          };
        }

        const extractedModel = (message.model as string) ?? '';
        diagLog('model-trace',
          `parseTranscript: OK path=${transcriptPath} lines=${lines.length} model='${extractedModel}'`,
        );
        return {
          inputTokens: successResult((usage?.input_tokens as number) ?? 0),
          outputTokens: successResult((usage?.output_tokens as number) ?? 0),
          cacheCreationTokens: successResult((usage?.cache_creation_input_tokens as number) ?? 0),
          cacheReadTokens: successResult((usage?.cache_read_input_tokens as number) ?? 0),
          model: extractedModel,
        };
      } catch {
        diagLog('model-trace', `parseTranscript: PARSE_ERROR path=${transcriptPath} lineIdx=${i}`);
        return {
          inputTokens: errorResult('PARSE_ERROR'),
          outputTokens: errorResult('PARSE_ERROR'),
          cacheCreationTokens: errorResult('PARSE_ERROR'),
          cacheReadTokens: errorResult('PARSE_ERROR'),
          model: '',
        };
      }
    }
    diagLog('model-trace',
      `parseTranscript: NO_ASSISTANT_LINE path=${transcriptPath} lines=${lines.length} → defaultResult(model='')`,
    );
  } catch (err) {
    diagLog('model-trace',
      `parseTranscript: READ_FAIL path=${transcriptPath} err=${(err as Error).message}`,
    );
    // 파일 읽기 실패 → defaultResult (NOT_FOUND)
  }

  return defaultResult;
}

/**
 * 서브에이전트 전용 transcript 경로 계산.
 *
 * Claude Code 규약:
 *   메인 transcript: <projects-dir>/<session_id>.jsonl
 *   서브 transcript: <projects-dir>/<session_id>/subagents/agent-<agent_id>.jsonl
 *
 * 호출 시점:
 *  - PreToolUse(서브에이전트 내부): agent_id 자체로 서브 경로 계산
 *  - PostToolUse(Agent tool 종료): tool_response.agentId로 서브 경로 계산
 */
export function resolveSubagentTranscriptPath(
  transcriptPath: string,
  sessionId: string,
  agentId: string,
): string {
  const lastSlash = transcriptPath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? transcriptPath.slice(0, lastSlash) : '';
  return `${dir}/${sessionId}/subagents/agent-${agentId}.jsonl`;
}

/**
 * 서브에이전트 transcript JSONL을 파싱하여 모든 tool_use 항목을 추출 (Migration 017).
 *
 * 표준 Anthropic message format 가정:
 *   각 line = {type: 'assistant', timestamp: ISO8601, message: {model, usage, content: [...]}}
 *   content[].type === 'tool_use' → {id, name, input}
 *
 * usage/model 부여 규칙:
 *  - 한 assistant 응답 안에 여러 tool_use가 있으면 첫 tool_use에만 usage 부여 (1회 청구가 맞음)
 *  - 후속 tool_use는 tokens_*=0 (통계 왜곡 방지)
 *
 * 파일 미존재/파싱 실패 시 빈 배열 반환 (수집은 계속 진행).
 *
 * 호출자: raw-handler.ts (PostToolUse + tool_name='Agent')
 */
export function extractSubagentToolCalls(
  subTranscriptPath: string,
): SubagentChildToolCall[] {
  let content: string;
  try {
    content = readFileSync(subTranscriptPath, 'utf-8');
  } catch {
    return [];
  }

  const result: SubagentChildToolCall[] = [];
  const lines = content.split('\n').filter((l: string) => l.trim());

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== 'assistant') continue;

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const contentArr = message.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(contentArr)) continue;

    const usage = (message.usage ?? {}) as Record<string, unknown>;
    const model = (message.model as string) ?? '';
    const ts = entry.timestamp as string | undefined;
    const timestampMs = ts ? Date.parse(ts) : Date.now();

    let firstToolUseInResponse = true;
    for (const block of contentArr) {
      if (block.type !== 'tool_use') continue;
      const id = block.id as string | undefined;
      const name = block.name as string | undefined;
      if (!id || !name) continue;

      // usage는 첫 tool_use에만 부여 (assistant 응답당 1회 청구 → 통계 왜곡 방지)
      const tokensInput = firstToolUseInResponse ? ((usage.input_tokens as number) ?? 0) : 0;
      const tokensOutput = firstToolUseInResponse ? ((usage.output_tokens as number) ?? 0) : 0;
      const cacheCreationTokens = firstToolUseInResponse
        ? ((usage.cache_creation_input_tokens as number) ?? 0)
        : 0;
      const cacheReadTokens = firstToolUseInResponse
        ? ((usage.cache_read_input_tokens as number) ?? 0)
        : 0;

      result.push({
        toolUseId: id,
        toolName: name,
        toolInput: (block.input ?? {}) as Record<string, unknown>,
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now(),
        model,
        tokensInput,
        tokensOutput,
        cacheCreationTokens,
        cacheReadTokens,
      });
      firstToolUseInResponse = false;
    }
  }

  return result;
}
