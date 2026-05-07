/**
 * hook 모듈 — UserPromptSubmit prompt에서 슬래시 커맨드 이름 추출
 *
 * 책임:
 *  - 사용자가 `/foo` 입력 시 Claude Code가 prompt에 `<command-name>foo</command-name>` 태그를 박아 보냄.
 *    이 태그에서 커맨드 이름을 뽑아 메타 문서 카탈로그(type='command') 매칭 키로 사용한다.
 *  - 마이그레이션 024가 추가한 `requests.slash_command` 컬럼에 저장된다.
 *
 * 외부 노출:
 *  - extractSlashCommand(prompt): 매칭된 커맨드 이름 또는 null
 *
 * 호출자:
 *  - handlers/user-prompt-submit.handler.ts
 *
 * 의존성: 없음 (순수 함수)
 */

const COMMAND_NAME_RE = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;

/**
 * prompt 텍스트에서 슬래시 커맨드 이름 추출.
 *
 * - 사용자가 `/foo bar` 입력 시 Claude Code 내부에서 prompt 본문에
 *   `<command-name>/foo</command-name>` 형태로 들어옴.
 * - 선행 슬래시는 제거하여 카탈로그(name='foo')와 직접 매칭되도록 정규화.
 *
 * @param prompt UserPromptSubmit hook의 raw.prompt 텍스트
 * @returns 커맨드 이름 (선행 슬래시 제거) 또는 매칭 실패 시 null
 */
export function extractSlashCommand(prompt: string | undefined | null): string | null {
  if (!prompt) return null;
  const m = prompt.match(COMMAND_NAME_RE);
  if (!m) return null;
  const name = m[1].trim();
  return name.length > 0 ? name : null;
}
