/**
 * system-reminder.js — turn 단위 `<system-reminder>` 블록 분해 + dedup/diff SSoT.
 *
 * 책임:
 *  - raw system_reminder 문자열(서버 응답 TurnItem.system_reminder)에서
 *    `<system-reminder>…</system-reminder>` 블록 본문을 추출.
 *  - 본문 trim된 텍스트를 그대로 dedup 키로 사용한다 (동일 본문 = 같은 reminder).
 *  - turn 배열을 chronological(turn_index ASC) 순회하며,
 *    "그 turn 시점에 처음 등장한 reminder"만 모아 turn_id → 신규 reminder[] 맵을 반환.
 *
 * 호출자: session-detail/turn-views.js renderTurnCards.
 *
 * 정책:
 *  - 누적 dedup 기준은 "세션 시작부터 이 turn 직전까지의 본 적 있는 reminder 집합".
 *    한 번이라도 등장한 reminder는 이후 turn에서 더 이상 신규 취급 안 함.
 *    → 시각 노이즈 최소화 (같은 hook 알림이 turn마다 반복 표시되지 않음).
 *  - 빈 라인은 무시. body는 trim 후 dedup.
 *  - 정규식은 `[\s\S]*?` 사용해 태그 안 줄바꿈 안전.
 *
 * 의존성: 없음 (escHtml 등 UI 헬퍼는 호출 측에서).
 */

const REMINDER_RE = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;

/**
 * raw 텍스트에서 reminder 블록 본문을 모두 추출.
 * 같은 본문이 같은 raw 안에 여러 번 나오면 그대로 중복 반환 (turn 내 dedup은 호출 측이 결정).
 *
 * @param {string|null|undefined} raw — TurnItem.system_reminder 그대로
 * @returns {string[]} 각 reminder 본문 (trim된 문자열). raw가 비어있으면 빈 배열.
 */
export function parseReminderBodies(raw: any) {
  if (!raw || typeof raw !== 'string') return [];
  const out = [];
  let m;
  REMINDER_RE.lastIndex = 0;   // 글로벌 정규식 state 리셋 — 호출 간 영향 차단
  while ((m = REMINDER_RE.exec(raw)) !== null) {
    const body = (m[1] ?? '').trim();
    if (body.length > 0) out.push(body);
  }
  return out;
}

/**
 * turn 배열을 chronological 순서로 훑어 각 turn에서 처음 등장한 reminder만 모은다.
 *
 *  - 호출 측이 turn 정렬 순서에 의존하지 않도록 내부에서 turn_index ASC 정렬 사본을 만든다.
 *  - 반환은 turn_id 키 Map — 칩 렌더 시 즉시 lookup 가능.
 *  - 신규 reminder가 0건인 turn은 Map에 항목을 두지 않는다 (호출 측에서 .get → undefined로 미렌더).
 *
 * @param {Array<{turn_id: string, turn_index: number, system_reminder?: string|null}>} turns
 * @returns {Map<string, string[]>} turn_id → 신규 reminder 본문 배열
 */
export function computeNewRemindersByTurn(turns: any) {
  const result = new Map();
  if (!Array.isArray(turns) || turns.length === 0) return result;

  const asc = turns.slice().sort((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0));
  const seen = new Set();   // 세션 누적 dedup 집합

  for (const t of asc) {
    const bodies = parseReminderBodies(t.system_reminder);
    if (bodies.length === 0) continue;
    const fresh = [];
    for (const b of bodies) {
      if (seen.has(b)) continue;
      seen.add(b);
      fresh.push(b);
    }
    if (fresh.length > 0) result.set(t.turn_id, fresh);
  }
  return result;
}
