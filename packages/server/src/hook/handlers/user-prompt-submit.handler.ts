/**
 * hook 모듈 — UserPromptSubmit 이벤트 핸들러 (Strategy 구현체)
 *
 * 책임:
 *  - transcript 파싱 → tokens·model 추출
 *  - 'prompt' event_type으로 INSERT (새 turn_id 자동 채번 — persist에서 처리)
 *
 * 새 세션 첫 prompt 한계:
 *  - transcript에 user 라인만 있으면 model='', tokens=0 (NO_ASSISTANT_LINE)
 *  - proxy 응답 도착 시 backfill로 model 채워짐 (proxy/backfill.ts)
 *
 * 호출자: dispatcher.ts (REGISTRY)
 * 의존성: types, transcript-context, audit-meta, processor
 */

import { diagLog } from '../../diag-log';
import type { ClaudeHookPayload, HookProcessResult, NormalizedHookPayload } from '../types';
import type { HookEventHandler, HookContext } from '../event-handler';
import { resolveTranscriptContext } from '../transcript-context';
import { extractHookAuditMeta } from '../audit-meta';
import { processHookEvent } from '../processor';
import { extractSlashCommand } from '../slash-command';
import { makeRequestId, deriveTokensConfidence } from './_shared';

export class UserPromptSubmitHandler implements HookEventHandler {
  readonly eventType = 'UserPromptSubmit';

  handle(raw: ClaudeHookPayload, ctx: HookContext): HookProcessResult {
    const { db, now, projectName } = ctx;

    const { transcriptData, modelOverride } = resolveTranscriptContext(raw);

    const tokensInput = transcriptData?.inputTokens.value ?? 0;
    const tokensOutput = transcriptData?.outputTokens.value ?? 0;

    const { tokensConfidence, tokensSource } = deriveTokensConfidence(
      transcriptData?.inputTokens.confidence ?? 'high',
      transcriptData?.outputTokens.confidence ?? 'high',
    );

    const finalPromptModel = modelOverride || transcriptData?.model || undefined;
    diagLog('model-trace',
      `UserPromptSubmit: transcriptModel='${transcriptData?.model ?? ''}' `
        + `override='${modelOverride ?? ''}' → finalModel='${finalPromptModel ?? '(undefined)'}'`,
    );

    // v24: prompt에 <command-name>/foo</command-name>가 포함되면 슬래시 커맨드 호출.
    //  메타 문서 카탈로그(type='command')와 직접 매칭하려고 별도 컬럼에 정규화 저장.
    const promptText = typeof (raw as { prompt?: unknown }).prompt === 'string'
      ? (raw as { prompt: string }).prompt
      : undefined;
    const slashCommand = extractSlashCommand(promptText);

    const payload: NormalizedHookPayload = {
      id: makeRequestId('prompt', now),
      session_id: raw.session_id,
      project_name: projectName,
      timestamp: now,
      event_type: 'prompt',
      request_type: 'prompt',
      tool_name: undefined,
      tool_detail: undefined,
      model: finalPromptModel,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      tokens_total: tokensInput + tokensOutput,
      payload: JSON.stringify(raw),
      source: 'claude-code-hook',
      cache_creation_tokens: transcriptData?.cacheCreationTokens.value ?? 0,
      cache_read_tokens: transcriptData?.cacheReadTokens.value ?? 0,
      tokens_confidence: tokensConfidence,
      tokens_source: tokensSource,
      slash_command: slashCommand,
      ...extractHookAuditMeta(raw),
    };

    return processHookEvent(db, payload);
  }
}
