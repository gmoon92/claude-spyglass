/**
 * settings/hook-detect.ts — 현재 `~/.claude/settings.json` 의 spyglass 훅 등록 상태 분석
 *
 * 책임 (Single Responsibility):
 *   `~/.claude/settings.json` 파일을 *읽기 전용* 으로 파싱하여 spyglass 와 관련된 두 가지를
 *   진단한다 — (1) `env.SPYGLASS_DIR` 값, (2) 각 hook event 별 spyglass 콜백 등록 여부.
 *
 *   설정 페이지의 "Hook 설정" 섹션이 본 모듈의 출력을 그대로 UI 로 노출.
 *
 * 의존성:
 *   - node:fs/promises (파일 IO) + node:path (경로 join) + node:os (homedir)
 *
 * 호출 흐름:
 *   routes/settings.ts::handleDiag → detectHookStatus()
 *     → 파일 존재 확인 → JSON 파싱 → spyglass-collect.sh 명령 매칭 → 결과 반환
 *
 * 디자인 결정:
 *   - 파일이 없거나 JSON 깨졌어도 *예외를 던지지 않고* `{exists:false, ...}` 폴백.
 *     설정 페이지가 첫 진단을 못 그리는 사고를 막기 위함.
 *   - hook 등록 여부 판정 기준: 해당 event 배열 안에 `command` 가 `spyglass-collect.sh` 를
 *     포함하는 hook 한 개 이상 존재. 사용자가 임의로 손댄 형식도 관대하게 수용.
 *   - `expectedEvents` 는 *권장 프로필 기준* — minimal 프로필 사용자라면 일부가 unregistered
 *     로 보이는 게 자연스러움 (UI 는 프로필 선택 후 다시 검사 가능).
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// =============================================================================
// 타입
// =============================================================================

/** 한 hook event 의 현재 등록 상태. */
export interface HookEventStatus {
  /** event 이름 (예: 'PreToolUse', 'PostToolUse'). */
  event: string;
  /** spyglass-collect.sh 가 매칭된 hook 항목 개수. 0 = 미등록. */
  count: number;
  /** event 가 spyglass 가 기대하는 *권장* 목록에 있는지. 없으면 사용자 추가 event. */
  expected: boolean;
}

export interface HookDetectResult {
  /** `~/.claude/settings.json` 절대 경로. */
  path: string;
  /** 파일이 실제로 존재하는지. */
  exists: boolean;
  /** JSON 파싱 성공 여부. exists 가 true 인데 false 면 파일이 깨진 상태. */
  parsed: boolean;
  /** env.SPYGLASS_DIR 값. 없거나 비어있으면 null. */
  spyglassDir: string | null;
  /** event 별 등록 상태 — 권장 목록 + 사용자 추가 event 모두 포함. */
  events: HookEventStatus[];
  /** 권장 events 중 등록된 개수. */
  registeredCount: number;
  /** 권장 events 총 개수. */
  expectedCount: number;
  /** 사용자가 직접 보고 싶을 수 있는 원본 파일 사이즈 (bytes). exists=false 면 null. */
  fileSize: number | null;
}

// =============================================================================
// 권장 hook events — full 프로필 기준 핵심 셋
// =============================================================================

/**
 * spyglass 가 권장하는 hook events.
 *
 *   minimal 프로필(`docs/examples/settings.hooks.minimal.json`) 의 6개 + 자주 쓰이는 4개.
 *   사용자가 minimal 만 깔았어도 핵심 6개는 *모두* expected:true 로 등록 상태가 정확히 표시됨.
 *   full 프로필의 27개 전부는 UI 가 너무 빽빽해지므로 *핵심 셋* 만 유지 — 사용자가 자세히
 *   보고 싶으면 settings.json 을 직접 열어 확인 가능.
 */
const EXPECTED_EVENTS: ReadonlyArray<string> = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
];

/** spyglass-collect.sh 가 hook command 에 포함되었는지 검사하는 substring 매칭 마커. */
const SPYGLASS_HOOK_MARKER = 'spyglass-collect.sh';

// =============================================================================
// 메인 진입점
// =============================================================================

/**
 * `~/.claude/settings.json` 을 읽어 spyglass 훅 등록 상태를 진단.
 *
 *   - 파일 미존재: `exists:false, parsed:false, events:[]` 로 폴백.
 *   - JSON 깨짐: `exists:true, parsed:false` 로 폴백 (UI 가 "파일 손상" 경고 표시).
 *   - 정상: `events[]` 에 권장 셋 + 사용자가 spyglass 콜백을 추가로 단 event 까지 포함.
 */
export async function detectHookStatus(): Promise<HookDetectResult> {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  // 파일 존재/크기 확인 — stat 실패 = 미존재로 간주 (권한 문제도 동일 처리).
  let fileSize: number | null = null;
  let exists = false;
  try {
    const st = await stat(settingsPath);
    exists = st.isFile();
    fileSize = exists ? st.size : null;
  } catch {
    return emptyResult(settingsPath);
  }
  if (!exists) return emptyResult(settingsPath);

  // 파일 읽기 + JSON 파싱 — 깨진 JSON 은 parsed:false 로 폴백.
  let parsed: unknown;
  try {
    const text = await readFile(settingsPath, 'utf-8');
    parsed = JSON.parse(text);
  } catch {
    return {
      path: settingsPath,
      exists: true,
      parsed: false,
      spyglassDir: null,
      events: [],
      registeredCount: 0,
      expectedCount: EXPECTED_EVENTS.length,
      fileSize,
    };
  }

  // 정상 JSON — env.SPYGLASS_DIR + hooks.* 추출.
  const settings = (parsed ?? {}) as Record<string, unknown>;
  const env = (settings.env ?? {}) as Record<string, unknown>;
  const spyglassDir = typeof env.SPYGLASS_DIR === 'string' && env.SPYGLASS_DIR.length > 0
    ? env.SPYGLASS_DIR
    : null;

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const events: HookEventStatus[] = [];

  // 권장 events 먼저 (UI 순서 보장) — 미등록이어도 항목으로 노출.
  const seen = new Set<string>();
  for (const ev of EXPECTED_EVENTS) {
    seen.add(ev);
    events.push({
      event: ev,
      count: countSpyglassHooks(hooks[ev]),
      expected: true,
    });
  }
  // 사용자가 spyglass-collect.sh 를 추가로 단 event 가 있으면 그것도 노출.
  for (const ev of Object.keys(hooks)) {
    if (seen.has(ev)) continue;
    const cnt = countSpyglassHooks(hooks[ev]);
    if (cnt > 0) {
      events.push({ event: ev, count: cnt, expected: false });
    }
  }

  const registeredCount = events.filter((e) => e.expected && e.count > 0).length;

  return {
    path: settingsPath,
    exists: true,
    parsed: true,
    spyglassDir,
    events,
    registeredCount,
    expectedCount: EXPECTED_EVENTS.length,
    fileSize,
  };
}

// =============================================================================
// 헬퍼
// =============================================================================

/** 파일 없음/접근 불가 시의 빈 결과 — UI 가 "설정 파일이 없습니다" 안내를 그릴 수 있도록. */
function emptyResult(settingsPath: string): HookDetectResult {
  return {
    path: settingsPath,
    exists: false,
    parsed: false,
    spyglassDir: null,
    events: [],
    registeredCount: 0,
    expectedCount: EXPECTED_EVENTS.length,
    fileSize: null,
  };
}

/**
 * 한 event 의 hooks 배열에서 spyglass 콜백이 몇 개 등록됐는지 카운트.
 *
 * Claude Code 의 hook 스키마:
 *   "EventName": [{ "matcher"?: "*", "hooks": [{ "type": "command", "command": "...", ... }] }]
 *
 * 본 함수는 깊이 2단계까지 순회 — 외부 group 배열 + 내부 hooks 배열.
 * `command` 가 `spyglass-collect.sh` substring 을 포함하면 +1.
 */
function countSpyglassHooks(eventEntry: unknown): number {
  if (!Array.isArray(eventEntry)) return 0;
  let count = 0;
  for (const group of eventEntry) {
    if (group === null || typeof group !== 'object') continue;
    const innerHooks = (group as { hooks?: unknown }).hooks;
    if (!Array.isArray(innerHooks)) continue;
    for (const hook of innerHooks) {
      if (hook === null || typeof hook !== 'object') continue;
      const cmd = (hook as { command?: unknown }).command;
      if (typeof cmd === 'string' && cmd.includes(SPYGLASS_HOOK_MARKER)) count++;
    }
  }
  return count;
}
