/**
 * hook 모듈 — PreToolUse 이벤트 핸들러 (Strategy 구현체)
 *
 * 책임:
 *  - tool_use_id에 대한 시작 시각을 timing 맵에 기록 (PostToolUse에서 duration 계산용)
 *  - 서브에이전트 내부 hook이면 서브 transcript에서 model 추출
 *  - tool_detail 추출 + audit 메타 추출 후 'pre_tool' event_type으로 INSERT
 *
 * 모델 정책:
 *  - 메인 세션 PreToolUse는 model을 의도적으로 NULL로 둠
 *    → transcript 미flush 상태일 가능성 + proxy 측 backfill로 채움
 *  - 서브에이전트 내부(raw.agent_id 존재) hook만 서브 transcript에서 model 추출
 *
 * 자바 비유:
 *   public class PreToolUseHandler implements HookEventHandler {
 *     public String getEventType() { return "PreToolUse"; }
 *     public HookProcessResult handle(payload, ctx) { ... }
 *   }
 *
 * 호출자: dispatcher.ts (REGISTRY)
 * 의존성: types, transcript-context, tool-detail, audit-meta, timing, processor
 */

import { diagLog } from '../../diag-log';
import type { ClaudeHookPayload, HookProcessResult, NormalizedHookPayload } from '../types';
import type { HookEventHandler, HookContext } from '../event-handler';
import { resolveTranscriptContext } from '../transcript-context';
import { extractToolDetail } from '../tool-detail';
import { extractHookAuditMeta } from '../audit-meta';
import { toolTimingMap } from '../timing';
import { processHookEvent } from '../processor';
import { makeRequestId } from './_shared';

export class PreToolUseHandler implements HookEventHandler {
  readonly eventType = 'PreToolUse';

  handle(raw: ClaudeHookPayload, ctx: HookContext): HookProcessResult {
    const { db, now, projectName } = ctx;

    if (raw.tool_use_id) {
      toolTimingMap.set(raw.tool_use_id, now);
    }

    const toolDetail = raw.tool_name && raw.tool_input
      ? extractToolDetail(raw.tool_name, raw.tool_input)
      : null;

    // 서브에이전트 내부 hook이면 서브 transcript에서 model 추출.
    // 메인 세션 PreToolUse는 model 미지정 — proxy backfill 정책으로 채움.
    const { transcriptData: preTranscriptData, modelOverride: preModelOverride } =
      resolveTranscriptContext(raw);
    const preModel = raw.agent_id
      ? (preModelOverride || preTranscriptData?.model || undefined)
      : undefined;

    diagLog('model-trace',
      `PreToolUse: tool=${raw.tool_name ?? '-'} agent_id=${raw.agent_id ?? '-'} `
        + `→ finalModel='${preModel ?? '(undefined; main-session policy)'}'`,
    );

    const payload: NormalizedHookPayload = {
      id: makeRequestId('pre', now),
      session_id: raw.session_id,
      project_name: projectName,
      timestamp: now,
      event_type: 'pre_tool',
      request_type: 'tool_call',
      tool_name: raw.tool_name ?? undefined,
      tool_detail: toolDetail ?? undefined,
      model: preModel,
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      duration_ms: 0,
      payload: JSON.stringify(raw),
      source: 'claude-code-hook',
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      ...extractHookAuditMeta(raw),
    };

    return processHookEvent(db, payload);
  }
}
