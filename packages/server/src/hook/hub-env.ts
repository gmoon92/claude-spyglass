/**
 * hook 모듈 — 허브 환경 태그(hub_env) 수신·검증·세션 기록
 *
 * 책임:
 *  - 수집 훅(hooks/spyglass-collect.sh)이 payload 에 덧붙인 `hub_env` 를 꺼내 허용 목록·형식을 검증한다.
 *  - 꺼낸 뒤 payload 에서는 지운다 → claude_events.payload·requests 에는 Claude Code 원본 payload 만 남고,
 *    환경변수 값이 여러 곳에 중복 저장되지 않는다.
 *  - 검증을 통과한 값을 sessions.orca_terminal / hub_role 에 기록한다(Migration 069).
 *
 * 왜 서버에서도 검증하나: 훅 스크립트의 허용 목록은 클라이언트 쪽 약속일 뿐이다.
 *  서버는 허용 목록 밖 키와 형식이 틀린 값을 버려, 환경변수 값이 DB 에 새어 들어올 길을 막는다.
 *
 * 외부 노출: takeHubEnv, recordSessionHubEnv
 * 호출자: http-entry.ts handleHookHttpRequest(/collect), events.ts eventsCollectHandler(/events)
 * 의존: @spyglass/storage setSessionHubEnv
 *
 * 호출 시점: 두 수신 경로 모두 "payload 파싱 직후 takeHubEnv → 처리 끝난 뒤 recordSessionHubEnv".
 *  세션 행은 /collect 의 첫 이벤트나 /events 의 Stop 에서 만들어지므로, SessionStart 시점에는 행이 없을 수 있다.
 *  모든 훅 이벤트가 hub_env 를 싣기 때문에 행이 생긴 뒤 첫 이벤트에서 기록된다.
 */

import type { Database } from 'bun:sqlite';
import { setSessionHubEnv, type SessionHubEnv } from '@spyglass/storage';

/** payload 의 필드 이름. */
const PAYLOAD_FIELD = 'hub_env';

/**
 * 허용하는 환경변수 이름(= hub_env 의 키). 훅 스크립트의 SPYGLASS_HUB_ENV_KEYS 와 같은 두 개여야 한다.
 * 여기에 없는 키는 버린다.
 *   ORCA_TERMINAL_HANDLE    → sessions.orca_terminal
 *   CLAUDE_HUB_SESSION_ROLE → sessions.hub_role
 */
const ENV_TERMINAL_HANDLE = 'ORCA_TERMINAL_HANDLE';
const ENV_SESSION_ROLE = 'CLAUDE_HUB_SESSION_ROLE';

/** Orca 터미널 핸들 형식(`term_<uuid>` 등). 공백·따옴표·제어문자가 든 값은 버린다. */
const TERMINAL_HANDLE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const HUB_ROLES: ReadonlySet<string> = new Set(['main', 'worker']);

/** 세션별 마지막으로 기록한 값 — 같은 값이면 DB 조회·쓰기를 건너뛴다(훅 이벤트마다 오므로). */
const lastRecorded = new Map<string, string>();

/**
 * payload 에서 hub_env 를 꺼내 검증하고, payload 에서는 지운다.
 *
 * @returns 검증을 통과한 값이 하나라도 있으면 SessionHubEnv, 없으면 null
 */
export function takeHubEnv(payload: Record<string, unknown>): SessionHubEnv | null {
  const raw = payload[PAYLOAD_FIELD];
  if (!(PAYLOAD_FIELD in payload)) return null;
  delete payload[PAYLOAD_FIELD];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const src = raw as Record<string, unknown>;
  const env: SessionHubEnv = {};
  const handle = src[ENV_TERMINAL_HANDLE];
  if (typeof handle === 'string' && TERMINAL_HANDLE_PATTERN.test(handle)) env.orca_terminal = handle;
  const role = src[ENV_SESSION_ROLE];
  if (typeof role === 'string' && HUB_ROLES.has(role)) env.hub_role = role;

  return env.orca_terminal !== undefined || env.hub_role !== undefined ? env : null;
}

/**
 * 검증된 허브 환경 태그를 세션에 기록한다. 실패해도 수집 응답에 영향이 없게 예외를 삼킨다.
 *
 * 같은 값을 이미 기록했으면 아무것도 하지 않는다. 세션 행이 아직 없으면 캐시하지 않아
 * 다음 이벤트에서 다시 시도한다.
 */
export function recordSessionHubEnv(db: Database, sessionId: string, env: SessionHubEnv | null): void {
  if (!env || !sessionId) return;
  const key = `${env.orca_terminal ?? ''}|${env.hub_role ?? ''}`;
  if (lastRecorded.get(sessionId) === key) return;
  try {
    if (setSessionHubEnv(db, sessionId, env)) lastRecorded.set(sessionId, key);
  } catch (error) {
    console.error('[HubEnv] Failed to record session hub env:', error);
  }
}

/** 테스트용 — 프로세스 캐시 초기화. */
export function resetHubEnvCacheForTest(): void {
  lastRecorded.clear();
}
