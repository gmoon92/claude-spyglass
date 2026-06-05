/**
 * hook 모듈 — discard 진단 (hook_event_name 누락 payload 추적)
 *
 * 배경:
 *  - /collect·/events 게이트는 hook_event_name 없는 payload 를 400 으로 조기 거부한다.
 *  - 거부 자체는 옳지만, 거부 직전 본문이 어디에도 영구화되지 않아 "누가/무엇을 보냈는지"
 *    사후 추론이 불가능했다 (http-entry 의 diagJson 기록은 거부 return 이후 라인이라 도달 못 함).
 *
 * 책임 (단일 진입점):
 *  - logDiscardedPayload(raw, reason) 한 번 호출로 거부 진단 흔적을 두 채널에 남긴다.
 *    1) console.warn — DIAG 플래그와 무관하게 항상 출력. 추정 이벤트명을 앞에 명시 +
 *       payload 키 목록 + 길이 제한 프리뷰. 평상시(DIAG OFF)에도 stderr 로 정체가 잡힌다.
 *    2) diagJson('discarded') — DIAG ON 시에만 전체 raw 를 별도 원장(discarded.jsonl)에 보존.
 *
 * 설계 노트:
 *  - 추정 이벤트명(inferEventLabel)은 진단 표기 전용 — 게이트 판정(처리/거부)에는 쓰지 않는다.
 *    비표준 스키마를 임의 복원해 다운스트림으로 흘리면 더 깊은 곳에서 깨지므로, 거부는 유지하고
 *    "무엇이 왔는지"만 가시화한다.
 *  - 프리뷰는 평문 노출을 최소화하기 위해 길이를 제한한다(DISCARD_PREVIEW_MAX).
 *
 * 호출자:
 *  - hook/http-entry.ts (/collect)
 *  - events.ts (/events)
 */

import { diagJson } from '../diag-log';

/** 프리뷰 최대 길이 — 평문 노출 최소화를 위해 짧게 유지. 초과분은 절단 + 잘린 길이 표기. */
const DISCARD_PREVIEW_MAX = 200;

/**
 * hook_event_name 표준 키가 비었을 때, payload 에서 이벤트 식별 단서를 best-effort 로 추출.
 *
 * Claude Code 버전별 비표준 스키마(camelCase 별칭, event/type 일반 필드)나 비-hook 직접 호출을
 * 사후 식별하기 위함. 우선순위: hook 명명 별칭 → 범용 타입 필드 → tool 단서.
 *
 * @returns 추정 라벨. 단서가 전혀 없으면 null.
 */
function inferEventLabel(raw: Record<string, unknown>): string | null {
  const aliases = ['hookEventName', 'eventName', 'event', 'hook_event', 'type'];
  for (const key of aliases) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // 이벤트명은 없지만 tool_name 만 있으면 tool 단서로 표기 (PreToolUse 류 추정 근거).
  const tool = raw['tool_name'];
  if (typeof tool === 'string' && tool.trim()) return `tool:${tool.trim()}`;
  return null;
}

/**
 * 직렬화 + 길이 제한 프리뷰. max(기본 200) 초과분은 절단하고 잘린 길이를 표기한다.
 * 직렬화 불가(순환 참조 등) 시 '<unserializable>' 폴백.
 */
function payloadPreview(raw: unknown, max = DISCARD_PREVIEW_MAX): string {
  try {
    const s = JSON.stringify(raw);
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…(+${s.length - max} chars)`;
  } catch {
    return '<unserializable>';
  }
}

/**
 * hook_event_name 없는 payload 를 거부할 때 호출 — 진단 흔적을 한 곳에서 남긴다.
 *
 * @param raw    거부된 원본 payload (객체 아닌 값도 안전 처리)
 * @param reason 거부 사유 라벨 (예: 'missing hook_event_name (/collect)')
 * @returns      추정 이벤트 라벨('unknown' 폴백) — 호출측 로깅/응답에 재사용 가능.
 */
export function logDiscardedPayload(raw: unknown, reason: string): string {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const inferred = inferEventLabel(obj) ?? 'unknown';
  const keys = Object.keys(obj);

  // 항상 출력 — 추정 이벤트명을 앞에 명시해 평상시(DIAG OFF)에도 정체를 식별할 수 있게 한다.
  console.warn(
    `[RECV] discarded: ${reason}`
      + ` inferred=${inferred}`
      + ` keys=[${keys.join(',')}]`
      + ` preview=${payloadPreview(raw)}`,
  );

  // DIAG ON 시에만 전체 raw 보존 — 정밀 분석용(평문, 0o600, 재시작 시 truncate).
  diagJson('discarded', { reason, inferred, keys, raw });

  return inferred;
}
