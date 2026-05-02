/**
 * hook 모듈 — transcript 컨텍스트 결정
 *
 * 책임:
 *  - hook payload의 출처(메인 세션 / 서브에이전트 내부 / Agent tool 종료 / Skill tool 종료)에 따라
 *    어느 transcript를 읽을지, model을 어떤 우선순위로 결정할지 분기.
 *
 * 분기 규칙 (4가지):
 *  1. 서브에이전트 내부 hook (raw.agent_id 존재):
 *     → 서브 transcript 전체 사용 (tokens·model 모두 서브에서)
 *  2. Agent tool PostToolUse (raw.tool_response.agentId 존재):
 *     → 메인 transcript의 tokens 유지 + 서브 transcript의 model로 보정
 *     (Agent 종료 시 메인은 마지막 assistant turn이 Agent 호출 자체이므로 model이 부정확할 수 있음)
 *  3. Skill tool PostToolUse:
 *     → tool_response.model 직접 사용 (스킬은 별도 모델로 실행될 수 있음)
 *  4. 그 외 (UserPromptSubmit, 일반 PostToolUse, ...):
 *     → 메인 transcript 그대로
 *
 * 외부 노출:
 *  - resolveTranscriptContext(raw): { transcriptData, modelOverride? }
 *
 * 호출자:
 *  - raw-handler.ts: PreToolUse / PostToolUse / UserPromptSubmit 모두에서 호출
 *
 * 의존성:
 *  - transcript.ts: parseTranscript, resolveSubagentTranscriptPath
 *  - diag-log: model-trace.log에 분기 결과 기록
 */

import { diagLog } from '../diag-log';
import type { ClaudeHookPayload, TranscriptUsage } from './types';
import { parseTranscript, resolveSubagentTranscriptPath } from './transcript';

/**
 * hook payload의 컨텍스트에 따라 transcript 데이터·model 우선순위를 결정한다.
 *
 * 반환:
 *  - transcriptData: 사용할 transcript의 usage·model (또는 null)
 *  - modelOverride : transcriptData.model보다 우선 적용해야 하는 model (서브/스킬 케이스)
 *
 * 호출 측 사용 패턴:
 *   const { transcriptData, modelOverride } = resolveTranscriptContext(raw);
 *   const finalModel = modelOverride || transcriptData?.model || undefined;
 */
export function resolveTranscriptContext(
  raw: ClaudeHookPayload,
): { transcriptData: TranscriptUsage | null; modelOverride?: string } {
  const mainPath = raw.transcript_path;
  diagLog('model-trace',
    `resolveCtx: enter event=${raw.hook_event_name} tool=${raw.tool_name ?? '-'} `
      + `session=${raw.session_id ?? '-'} agentId=${raw.agent_id ?? '-'} `
      + `transcript_path=${mainPath ?? '(missing)'}`,
  );
  const mainData = mainPath ? parseTranscript(mainPath) : null;

  if (!mainPath || !raw.session_id) {
    diagLog('model-trace',
      `resolveCtx: early-return (no path/session) mainModel='${mainData?.model ?? ''}'`,
    );
    return { transcriptData: mainData };
  }

  // 1) 서브에이전트 내부 hook: 서브 transcript 전체 사용
  if (raw.agent_id) {
    const subPath = resolveSubagentTranscriptPath(mainPath, raw.session_id, raw.agent_id);
    diagLog('model-trace', `resolveCtx: branch=subagent-internal subPath=${subPath}`);
    return { transcriptData: parseTranscript(subPath) };
  }

  // 2) Agent tool PostToolUse: 서브 transcript에서 model만 보정
  if (raw.tool_name === 'Agent' && raw.hook_event_name === 'PostToolUse') {
    const subAgentId = (raw.tool_response as { agentId?: string } | undefined)?.agentId;
    if (subAgentId) {
      const subPath = resolveSubagentTranscriptPath(mainPath, raw.session_id, subAgentId);
      const subData = parseTranscript(subPath);
      diagLog('model-trace',
        `resolveCtx: branch=Agent-post subAgentId=${subAgentId} `
          + `subModel='${subData.model}' mainModel='${mainData?.model ?? ''}'`,
      );
      if (subData.model) {
        return { transcriptData: mainData, modelOverride: subData.model };
      }
    }
  }

  // 3) Skill tool PostToolUse: tool_response.model에서 직접 모델 추출
  if (raw.tool_name === 'Skill' && raw.hook_event_name === 'PostToolUse') {
    const skillModel = (raw.tool_response as { model?: string } | undefined)?.model;
    if (skillModel) {
      diagLog('model-trace', `resolveCtx: branch=Skill-post skillModel='${skillModel}'`);
      return { transcriptData: mainData, modelOverride: skillModel };
    }
  }

  diagLog('model-trace', `resolveCtx: branch=default mainModel='${mainData?.model ?? ''}'`);
  return { transcriptData: mainData };
}
