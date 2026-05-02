/**
 * hook 모듈 — 도구별 tool_detail 추출
 *
 * 책임:
 *  - PreToolUse/PostToolUse hook의 raw.tool_input에서 도구 종류별로 의미 있는 요약 1줄을 만든다.
 *  - DB의 requests.tool_detail 컬럼에 저장 (UI 행에 표시용).
 *
 * 도구별 추출 규칙:
 *  - Read/Edit/MultiEdit/Write: file_path
 *  - Bash: command (80자 제한)
 *  - Glob/Grep: pattern + (path)
 *  - Skill: skill 이름 또는 args
 *  - Agent: subagent_type / description / prompt
 *  - WebFetch: url, WebSearch: query
 *  - SendMessage: "→{to}: {summary}"
 *  - AskUserQuestion: 첫 질문
 *  - mcp__*: 첫 의미 있는 문자열 필드
 *  - 기타: null
 *
 * 외부 노출: extractToolDetail(toolName, toolInput)
 *
 * 호출자:
 *  - raw-handler.ts: PreToolUse/PostToolUse 처리 시
 *  - persist.ts: 서브에이전트 자식 tool_use 저장 시 (persistSubagentChildren)
 *
 * 의존성: 없음 (순수 함수)
 */

/**
 * 도구별 파라미터 요약 문자열 반환.
 *
 * @param toolName  도구 이름 (Read, Bash, Skill, Agent, mcp__*, ...)
 * @param toolInput hook payload의 tool_input 객체
 * @returns        80자 이내 요약 문자열 또는 null
 */
export function extractToolDetail(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  if (!toolInput) return null;

  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write': {
      const fp = toolInput.file_path as string | undefined;
      return fp || null;
    }

    case 'Bash': {
      const cmd = toolInput.command as string | undefined;
      if (!cmd) return null;
      return cmd.slice(0, 80);
    }

    case 'Glob': {
      const pattern = (toolInput.pattern as string) ?? '';
      const path = toolInput.path as string | undefined;
      if (!pattern) return null;
      return path ? `${pattern} in ${path}` : pattern;
    }

    case 'Grep': {
      const pattern = (toolInput.pattern as string) ?? '';
      const path = toolInput.path as string | undefined;
      if (!pattern) return null;
      return path ? `${pattern} in ${path}` : pattern;
    }

    case 'Skill': {
      const skill = toolInput.skill as string | undefined;
      if (skill) return skill.slice(0, 80);
      const args = toolInput.args as string | undefined;
      return args ? args.slice(0, 80) : null;
    }

    case 'Agent': {
      const subagentType = toolInput.subagent_type as string | undefined;
      if (subagentType) return subagentType;
      const desc = toolInput.description as string | undefined;
      if (desc) return desc.slice(0, 80);
      const prompt = toolInput.prompt as string | undefined;
      return prompt ? prompt.slice(0, 80) : null;
    }

    case 'WebFetch': {
      const url = toolInput.url as string | undefined;
      return url || null;
    }

    case 'WebSearch': {
      const query = toolInput.query as string | undefined;
      return query || null;
    }

    case 'ToolSearch': {
      const query = toolInput.query as string | undefined;
      return query ? query.slice(0, 80) : null;
    }

    case 'SendMessage': {
      const summary = toolInput.summary as string | undefined;
      const to = toolInput.to as string | undefined;
      if (summary) return to ? `→${to}: ${summary}`.slice(0, 80) : summary.slice(0, 80);
      return to ? `→${to}` : null;
    }

    case 'AskUserQuestion': {
      const questions = toolInput.questions as Array<{ question: string }> | undefined;
      const first = questions?.[0]?.question;
      return first ? first.slice(0, 80) : null;
    }

    default: {
      // mcp__* 공통: 첫 번째 의미 있는 문자열 필드 반환
      if (toolName.startsWith('mcp__')) {
        const firstStr = Object.values(toolInput).find(
          (v) => typeof v === 'string' && v.length > 2,
        );
        return firstStr ? (firstStr as string).slice(0, 80) : null;
      }
      return null;
    }
  }
}
