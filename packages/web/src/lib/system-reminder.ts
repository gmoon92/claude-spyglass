/**
 * lib/system-reminder.ts — turn 단위 `<system-reminder>` 블록 분해 + 누적 dedup/diff SSoT (P3-07)
 *
 * 원본: assets/js/session-detail/system-reminder.js (1:1 이식, 재구현 아님).
 * lib/ universal leaf(architecture.md §1.3) — import 0 순수함수라 stores/components 양쪽이 공유 가능.
 *
 * 책임:
 *  - raw system_reminder 문자열에서 `<system-reminder>…</system-reminder>` 블록 본문 추출.
 *  - 본문 trim 텍스트를 dedup 키로 사용(동일 본문 = 같은 reminder).
 *  - turn 배열을 chronological(turn_index ASC)로 훑어 "그 turn 에서 처음 등장한 reminder"만
 *    turn_id → 신규 reminder[] Map 으로 반환.
 *
 * 정책(원본 system-reminder.js:13-18):
 *  - 누적 dedup 기준 = 세션 시작부터 이 turn 직전까지 본 적 있는 reminder 집합.
 *  - 빈 라인 무시, body 는 trim 후 dedup.
 *  - 정규식은 `[\s\S]*?` 로 태그 안 줄바꿈 안전.
 *
 * @module lib/system-reminder
 */

/** raw 텍스트 내 모든 system-reminder 블록을 잡는 글로벌 정규식. */
const REMINDER_RE = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;

/** computeNewRemindersByTurn 입력 turn 의 최소 형태. */
export interface ReminderTurn {
  turn_id: string;
  turn_index: number;
  system_reminder?: string | null;
}

/**
 * raw 텍스트에서 reminder 블록 본문을 모두 추출.
 * 같은 본문이 같은 raw 안에 여러 번 나오면 그대로 중복 반환(turn 내 dedup 은 호출 측 결정).
 *
 * @param raw — TurnItem.system_reminder 그대로
 * @returns 각 reminder 본문(trim 문자열). raw 가 비거나 비문자열이면 빈 배열.
 */
export function parseReminderBodies(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  REMINDER_RE.lastIndex = 0; // 글로벌 정규식 state 리셋 — 호출 간 영향 차단
  while ((m = REMINDER_RE.exec(raw)) !== null) {
    const body = (m[1] ?? '').trim();
    if (body.length > 0) out.push(body);
  }
  return out;
}

/**
 * turn 배열을 chronological 순서로 훑어 각 turn 에서 처음 등장한 reminder 만 모은다.
 *  - 호출 측 정렬 순서에 의존하지 않도록 내부에서 turn_index ASC 정렬 사본을 만든다(입력 불변).
 *  - 반환은 turn_id 키 Map — 칩 렌더 시 즉시 lookup.
 *  - 신규 reminder 0건 turn 은 Map 에 항목을 두지 않는다(.get → undefined 로 미렌더).
 *
 * @param turns — turn 배열({turn_id, turn_index, system_reminder?})
 * @returns turn_id → 신규 reminder 본문 배열
 */
export function computeNewRemindersByTurn(turns: ReminderTurn[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!Array.isArray(turns) || turns.length === 0) return result;

  const asc = turns.slice().sort((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0));
  const seen = new Set<string>(); // 세션 누적 dedup 집합

  for (const t of asc) {
    const bodies = parseReminderBodies(t.system_reminder);
    if (bodies.length === 0) continue;
    const fresh: string[] = [];
    for (const b of bodies) {
      if (seen.has(b)) continue;
      seen.add(b);
      fresh.push(b);
    }
    if (fresh.length > 0) result.set(t.turn_id, fresh);
  }
  return result;
}
