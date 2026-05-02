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
 * 외부 노출: extractToolDetail(toolName, toolInput, toolResponse?)
 *
 * 호출자:
 *  - handlers/pre-tool-use.handler.ts : tool_response 없음 (PreToolUse 시점)
 *  - handlers/post-tool-use.handler.ts: tool_response 함께 전달 (PostToolUse 시점)
 *  - persist.ts (서브에이전트 자식): tool_response 없음 (transcript에서 추출)
 *
 * tool_response 활용 (v22+, PostToolUse 한정):
 *  - TaskUpdate: response.statusChange로 "#1 in_progress→completed" 표시
 *  - 다른 도구는 PreToolUse 표시와 동일하게 fallback
 *
 * 의존성: 없음 (순수 함수)
 */

/**
 * 도구별 파라미터 요약 문자열 반환.
 *
 * @param toolName     도구 이름 (Read, Bash, Skill, Agent, mcp__*, Task*, ...)
 * @param toolInput    hook payload의 tool_input 객체
 * @param toolResponse hook payload의 tool_response (PostToolUse만 보유, 옵션)
 * @returns           80자 이내 요약 문자열 또는 null
 */
export function extractToolDetail(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse?: unknown,
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
      // PostToolUse: tool_input.answers — 사용자가 실제 선택한 답이 question→label 매핑으로 들어옴
      // PreToolUse: 답이 아직 없으니 첫 질문 텍스트로 폴백
      // 여러 질문이면 'Q×N' 표시 + 첫 질문/답을 같이 노출
      const questions = toolInput.questions as
        Array<{ question: string; options?: Array<{ label: string }> }> | undefined;
      const first = questions?.[0]?.question;
      if (!first) return null;
      const answers = toolInput.answers as Record<string, string> | undefined;
      const firstAnswer = answers ? answers[first] : undefined;
      const qPrefix = (questions && questions.length > 1) ? `Q×${questions.length} ` : '';
      if (firstAnswer) {
        return `${qPrefix}${first} → ${firstAnswer}`.slice(0, 80);
      }
      return `${qPrefix}${first}`.slice(0, 80);
    }

    case 'TaskCreate': {
      // 작업 제목이 가장 의미 있음. 없으면 description fallback.
      const subject = toolInput.subject as string | undefined;
      if (subject) return subject.slice(0, 80);
      const desc = toolInput.description as string | undefined;
      return desc ? desc.slice(0, 80) : null;
    }

    case 'TaskUpdate': {
      // PostToolUse 시점: tool_response.statusChange 우선.
      //   실측: statusChange는 객체 {from, to}로 들어옴 — 객체를 string 템플릿에 박으면
      //   '[object Object]'로 강제 변환되므로 명시적으로 풀어 from→to로 표기.
      //   문자열 형태(미래 호환)도 폴백으로 지원.
      // PreToolUse 시점: tool_input의 status/subject/owner 등 변경 필드 표시
      const taskId = toolInput.taskId as string | undefined;
      if (!taskId) return null;
      const tr = toolResponse as
        { statusChange?: string | { from?: string; to?: string }; updatedFields?: string[] }
        | undefined;
      const sc = tr?.statusChange;
      if (sc && typeof sc === 'object' && (sc.from || sc.to)) {
        return `#${taskId} ${sc.from ?? '?'}→${sc.to ?? '?'}`.slice(0, 80);
      }
      if (typeof sc === 'string' && sc.length > 0) {
        return `#${taskId} ${sc}`.slice(0, 80);
      }
      const status = toolInput.status as string | undefined;
      if (status) return `#${taskId} → ${status}`.slice(0, 80);
      const subject = toolInput.subject as string | undefined;
      if (subject) return `#${taskId} ${subject}`.slice(0, 80);
      const owner = toolInput.owner as string | undefined;
      if (owner) return `#${taskId} owner=${owner}`.slice(0, 80);
      // PreToolUse에서 인자 없이 호출된 경우 (드물지만) — taskId만이라도 표시
      return `#${taskId}`;
    }

    case 'TaskGet': {
      const taskId = toolInput.taskId as string | undefined;
      return taskId ? `#${taskId}` : null;
    }

    case 'TaskList': {
      // 인자 없음 — 목록 조회 액션임을 명시
      return '(list)';
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
