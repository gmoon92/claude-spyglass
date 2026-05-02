/**
 * hook 모듈 — PostToolUse 이벤트 핸들러 (Strategy 구현체)
 *
 * 책임:
 *  1. duration_ms 계산 (raw.duration_ms 우선, 없으면 timing map fallback)
 *  2. transcript 파싱 → tokens·model 추출
 *  3. 'tool' event_type으로 INSERT (Upsert: 기존 pre_tool 행이 있으면 UPDATE)
 *  4. tool_name='Agent' 종료 시 서브 transcript에서 자식 tool_use 추출 → 일괄 INSERT
 *     (Migration 017: parent_tool_use_id로 부모 Agent에 매핑)
 *
 * 호출자: dispatcher.ts (REGISTRY)
 * 의존성: types, transcript, transcript-context, tool-detail, audit-meta, timing, turn, persist, processor
 */

import { diagLog } from '../../diag-log';
import type { ClaudeHookPayload, HookProcessResult, NormalizedHookPayload } from '../types';
import type { HookEventHandler, HookContext } from '../event-handler';
import { resolveSubagentTranscriptPath, extractSubagentToolCalls } from '../transcript';
import { resolveTranscriptContext } from '../transcript-context';
import { extractToolDetail } from '../tool-detail';
import { extractHookAuditMeta } from '../audit-meta';
import { toolTimingMap } from '../timing';
import { getLastTurnId } from '../turn';
import { persistSubagentChildren } from '../persist';
import { processHookEvent } from '../processor';
import { makeRequestId, deriveTokensConfidence } from './_shared';

export class PostToolUseHandler implements HookEventHandler {
  readonly eventType = 'PostToolUse';

  handle(raw: ClaudeHookPayload, ctx: HookContext): HookProcessResult {
    const { db, now, projectName } = ctx;

    // duration_ms: Claude Code 신버전은 raw에 직접 제공. 없으면 timing map 폴백.
    let duration_ms = typeof raw.duration_ms === 'number' && raw.duration_ms >= 0
      ? raw.duration_ms
      : 0;
    if (duration_ms === 0 && raw.tool_use_id) {
      const startTs = toolTimingMap.get(raw.tool_use_id);
      if (startTs !== undefined) {
        duration_ms = now - startTs;
        toolTimingMap.delete(raw.tool_use_id);
      }
    }

    const { transcriptData, modelOverride } = resolveTranscriptContext(raw);
    // v22: tool_response를 함께 전달 → TaskUpdate 등에서 statusChange 같은 결과값 활용
    const toolDetail = raw.tool_name && raw.tool_input
      ? extractToolDetail(raw.tool_name, raw.tool_input, raw.tool_response)
      : null;

    const tokensInput = transcriptData?.inputTokens.value ?? 0;
    const tokensOutput = transcriptData?.outputTokens.value ?? 0;

    const { tokensConfidence, tokensSource } = deriveTokensConfidence(
      transcriptData?.inputTokens.confidence ?? 'high',
      transcriptData?.outputTokens.confidence ?? 'high',
    );

    const finalPostModel = modelOverride || transcriptData?.model || undefined;
    diagLog('model-trace',
      `PostToolUse: tool=${raw.tool_name ?? '-'} `
        + `transcriptModel='${transcriptData?.model ?? ''}' override='${modelOverride ?? ''}' `
        + `→ finalModel='${finalPostModel ?? '(undefined)'}'`,
    );

    const payload: NormalizedHookPayload = {
      id: makeRequestId('tool', now),
      session_id: raw.session_id,
      project_name: projectName,
      timestamp: now,
      event_type: 'tool',
      request_type: 'tool_call',
      tool_name: raw.tool_name ?? undefined,
      tool_detail: toolDetail ?? undefined,
      model: finalPostModel,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      tokens_total: tokensInput + tokensOutput,
      duration_ms,
      payload: JSON.stringify(raw),
      source: 'claude-code-hook',
      cache_creation_tokens: transcriptData?.cacheCreationTokens.value ?? 0,
      cache_read_tokens: transcriptData?.cacheReadTokens.value ?? 0,
      tokens_confidence: tokensConfidence,
      tokens_source: tokensSource,
      ...extractHookAuditMeta(raw),
    };

    const result = processHookEvent(db, payload);

    // Agent tool 완료 시 서브 transcript의 자식 tool_use 일괄 INSERT (Migration 017).
    // parent_tool_use_id로 부모 Agent에 매핑되어 같은 turn에 트리 구조로 묶임.
    this.maybePersistSubagentChildren(raw, db, result.success);

    return result;
  }

  private maybePersistSubagentChildren(
    raw: ClaudeHookPayload,
    db: HookContext['db'],
    success: boolean,
  ): void {
    if (!(success && raw.tool_name === 'Agent' && raw.tool_use_id
      && raw.transcript_path && raw.session_id)) {
      return;
    }
    const subAgentId = (raw.tool_response as { agentId?: string } | undefined)?.agentId;
    if (!subAgentId) return;

    try {
      const subPath = resolveSubagentTranscriptPath(
        raw.transcript_path,
        raw.session_id,
        subAgentId,
      );
      const childCalls = extractSubagentToolCalls(subPath);
      if (childCalls.length === 0) return;
      const parentTurnId = getLastTurnId(db, raw.session_id) ?? undefined;
      persistSubagentChildren(db, childCalls, {
        parentToolUseId: raw.tool_use_id,
        sessionId: raw.session_id,
        turnId: parentTurnId,
      });
    } catch (e) {
      console.error('[Hook] Failed to persist subagent children:', e);
    }
  }
}
