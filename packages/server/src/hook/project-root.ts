/**
 * hook 모듈 — 프로젝트 루트(spyglass_project_root) 수신·검증
 *
 * 책임:
 *  - 수집 훅(hooks/spyglass-collect.sh)이 payload 에 덧붙인 `spyglass_project_root`(훅이 git 으로 구한 저장소 루트)를
 *    꺼내 형식을 검증하고, payload 에서는 지운다 → claude_events.payload 에는 Claude Code 원본 payload 만 남는다.
 *  - 이름 파생 규칙 자체는 session.ts projectNameFromCwd 가 SSoT 다. 이 모듈은 값의 수신·검증만 한다.
 *
 * 왜 서버가 아니라 훅이 구하나: 서버는 컨테이너로 돌 수 있어(docker-compose.yml) 사용자의 파일시스템에 접근할 수 없다.
 *  git 은 세션이 도는 호스트의 훅 프로세스에서만 부를 수 있다.
 *
 * 외부 노출: takeProjectRoot, PROJECT_ROOT_PAYLOAD_FIELD
 * 호출자: http-entry.ts handleHookHttpRequest(/collect), events.ts eventsCollectHandler(/events)
 */

/** 훅이 payload 에 싣는 필드 이름. 훅 스크립트와 같아야 한다. */
export const PROJECT_ROOT_PAYLOAD_FIELD = 'spyglass_project_root';

const MAX_ROOT_LENGTH = 1024;
// 제어문자(개행 포함)가 든 값은 버린다.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * payload 에서 프로젝트 루트를 꺼내 검증하고, payload 에서는 지운다.
 *
 * @returns 절대 경로 형식을 통과한 값, 없거나 형식 위반이면 null (호출자는 cwd 로 폴백한다)
 */
export function takeProjectRoot(payload: Record<string, unknown>): string | null {
  if (!(PROJECT_ROOT_PAYLOAD_FIELD in payload)) return null;
  const raw = payload[PROJECT_ROOT_PAYLOAD_FIELD];
  delete payload[PROJECT_ROOT_PAYLOAD_FIELD];
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('/') || raw.length > MAX_ROOT_LENGTH || CONTROL_CHARS.test(raw)) return null;
  return raw;
}
