/**
 * settings/claude-hooks.ts — `~/.claude/settings.json` 의 Hook 자동 병합 핵심
 *
 * 책임 (Single Responsibility):
 *   사용자의 `~/.claude/settings.json` 에 spyglass 의 hook 콜백을 *안전하게* 주입한다.
 *   사용자가 직접 jq 명령을 외우거나 텍스트 에디터로 병합할 필요 없이, 웹 대시보드 클릭
 *   한 번으로 끝나도록 한다.
 *
 *   본 모듈의 *불변식 (invariants)*:
 *     1) 변경 전 반드시 백업 파일을 생성 (덮어쓰지 않는 unique suffix)
 *     2) `env.SPYGLASS_DIR` 과 `hooks.*` 두 키 외에는 *절대 건드리지 않음*
 *     3) 쓰기 중 프로세스가 죽어도 원본이 깨지지 않도록 atomic rename
 *
 * 의존성:
 *   - node:fs/promises (writeFile, rename, copyFile, mkdir, stat)
 *   - node:path / node:os (경로, homedir, tmpdir 대신 같은 디렉토리 .tmp 사용)
 *
 * 호출 흐름:
 *   routes/settings.ts::handleHooksApply
 *     → loadCurrentSettings() 또는 빈 객체로 시작
 *     → loadHookProfile(profile) → ${SPYGLASS_DIR} 치환
 *     → mergeSettings(current, profile, spyglassDir)
 *     → diffSummary(before, after)  ← UI 표시용
 *     → backupSettings(currentPath)  ← bak-YYYYMMDD-HHMMSS
 *     → applySettings(merged) atomic
 *
 * 디자인 결정:
 *   - 백업 suffix 는 *초 단위* (HHMMSS) — 1초 안에 동일 적용을 두 번 호출해도 충돌 가능성 ↓.
 *     그래도 충돌하면 `-${random}` 추가 폴백.
 *   - atomic write: 같은 디렉토리에 `.tmp-<random>` 파일 작성 → fsync → rename. 다른 디렉토리
 *     (예: /tmp) 사용 X — cross-fs rename 은 atomic 보장 안 됨.
 *   - merge 정책: hooks 객체는 *완전 치환* (사용자가 다른 도구의 hook 을 등록했어도 같은 event
 *     안에 spyglass 콜백을 추가하려면 별도 PR — 본 PR 범위 밖). env.SPYGLASS_DIR 만 주입.
 *
 *     [심화 정책 — 2026-05-26]
 *     사용자 보호 vs 의도: 사용자가 spyglass 가 아닌 다른 hook 콜백을 직접 추가했다면 그건
 *     `~/.claude/settings.json` 의 다른 키나 사용자 정의 매니저로 관리할 가능성이 높다. 본 PR
 *     은 *spyglass 가 권장하는 프로필을 통째로 적용* 하는 동작이므로 hooks 키 자체를 갈아끼는
 *     게 의미적으로 일관 — 이 동작은 항상 *백업본* 이 보장하므로 사용자가 원복 가능.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { backupFile, writeAtomic, restoreFromBackup as toolkitRestoreFromBackup, deleteBackup } from './file-edit-toolkit';

// =============================================================================
// 경로 / 상수
// =============================================================================

/** `~/.claude/settings.json` 절대 경로.
 *
 *   `process.env.HOME` 을 우선 사용 — 테스트가 HOME 을 임시 디렉토리로 redirect 할 수 있도록.
 *   환경 변수가 없으면 `os.homedir()` 폴백 (Windows USERPROFILE 케이스 등).
 *   *추가 환경변수 override (SPYGLASS_CLAUDE_HOME 같은)* 는 의도적으로 미지원 — 보안 우려.
 */
export function getSettingsPath(): string {
  const home = process.env.HOME || homedir();
  return join(home, '.claude', 'settings.json');
}

/** 본 레포지토리 안의 hook profile JSON 경로. */
export function getProfilePath(_profile: HookProfileKind): string {
  // `process.cwd()` 는 spyglass 서버가 기동된 디렉토리 — install-guide 가 정의하는 `SPYGLASS_DIR`.
  // 본 PR 범위에선 서버를 항상 클론 디렉토리에서 기동한다고 가정 (install-guide 3.1).
  // full 단일 프로필 — minimal 은 제거됨(선택 아님).
  return join(process.cwd(), 'docs', 'examples', 'settings.hooks.full.json');
}

/** hook 프로필 종류 — full 단일(선택 아님). 향후 확장 여지를 위해 타입은 유지. */
export type HookProfileKind = 'full';

// =============================================================================
// 타입
// =============================================================================

/** 사용자 settings + spyglass profile 의 임의 JSON. JsonValue 로 재귀 표현. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export interface SettingsObject {
  [key: string]: JsonValue;
}

export interface DiffSummary {
  /** 새로 추가된 hook event 이름들. */
  applied: string[];
  /** 기존 hook event 중 프로필이 *덮어쓴* 항목들 (사용자가 직접 단 hook 도 포함될 수 있음). */
  modified: string[];
  /** 기존에는 있었지만 새 프로필엔 없는 event — 본 PR 정책상 *유지* (사용자 설정 보호). */
  preserved: string[];
  /** env.SPYGLASS_DIR 이 새로 설정 / 변경 / 동일 한지. */
  spyglassDir: 'created' | 'changed' | 'unchanged';
  /** 변경 전/후 env.SPYGLASS_DIR 값. */
  spyglassDirBefore: string | null;
  spyglassDirAfter: string;
}

export interface ApplyResult {
  /** 백업본 절대 경로. 검증 성공 후 삭제하면 null. */
  backupPath: string | null;
  /** 사용된 프로필. */
  profile: HookProfileKind;
  /** 변경 요약 — UI 가 사용자에게 표시. */
  diff: DiffSummary;
  /** 적용 후 settings.json 의 크기 (bytes). */
  finalSize: number;
  /** 적용 후 JSON 유효성 검증 통과 여부. */
  verify: 'ok' | 'failed';
  /** 검증 성공으로 이번 백업을 삭제했으면 true (백업 누적 방지). */
  backupRemoved: boolean;
}

// =============================================================================
// 로딩 — current + profile
// =============================================================================

/**
 * 현재 `~/.claude/settings.json` 을 파싱해 반환. 파일이 없거나 JSON 이 깨졌으면 *빈 객체*.
 *
 * 깨진 JSON 을 만나도 throw 하지 않는다 — UI 가 "원본을 백업 후 새로 작성" 시나리오를 지원해야
 * 하기 때문. 단, 깨진 JSON 위에 단순 덮어쓰면 사용자가 손댄 내용을 잃을 위험이 있으므로
 * 호출 측(routes/settings.ts) 이 *적용 전* 미리보기 API 로 사용자에게 다시 확인하는 흐름.
 */
export async function loadCurrentSettings(): Promise<SettingsObject> {
  const path = getSettingsPath();
  try {
    const txt = await readFile(path, 'utf-8');
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SettingsObject;
    }
    return {};
  } catch {
    // 파일 없음 / 권한 / JSON syntax error — 모두 빈 객체로 시작.
    return {};
  }
}

/**
 * spyglass 가 발행한 profile JSON 을 로드하고 `${SPYGLASS_DIR}` placeholder 를 실제 경로로 치환.
 *
 *   - profile 파일 자체는 항상 `<your-name>` placeholder 또는 `$SPYGLASS_DIR` 변수 참조 형식.
 *   - 본 함수는 env.SPYGLASS_DIR 값만 실제 절대 경로(`process.cwd()`) 로 치환.
 *   - hooks 내부의 `bash $SPYGLASS_DIR/hooks/spyglass-collect.sh` 명령은 *런타임에* Claude Code 가
 *     env 를 주입하므로 치환 X — 원본 그대로 보존.
 */
export async function loadHookProfile(
  profile: HookProfileKind,
  spyglassDir: string = process.cwd(),
): Promise<SettingsObject> {
  const path = getProfilePath(profile);
  const txt = await readFile(path, 'utf-8');
  const parsed = JSON.parse(txt) as SettingsObject;

  // env.SPYGLASS_DIR 만 절대 경로로 치환. 그 외 키는 그대로.
  const env = (parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
    ? parsed.env
    : {}) as Record<string, JsonValue>;
  env.SPYGLASS_DIR = spyglassDir;
  parsed.env = env;

  return parsed;
}

// =============================================================================
// 병합 — 사용자 설정 *최대한* 보존
// =============================================================================

/**
 * current 와 profile 을 병합 — 본 PR 의 핵심 *불변식 2* 가 여기 구현된다.
 *
 *   1) profile 의 `env.SPYGLASS_DIR` 을 current.env 에 *덮어쓰기 주입*. current.env 의 다른 키는 보존.
 *   2) profile 의 `hooks.*` event 들을 current.hooks 에 *덮어쓰기 주입*. profile 에 없는 event 는 보존.
 *   3) 그 외 top-level 키 (`model`, `enabledPlugins`, `autoMemoryEnabled`, `statusLine` ...) 는 *건드리지 않음*.
 *
 *   다이아몬드 시나리오:
 *     사용자가 PreToolUse 에 다른 도구의 콜백을 등록해 두었으면 본 병합으로 *덮어쓰임*.
 *     이 케이스는 사용자가 의도적으로 spyglass 가 아닌 hook 을 단 케이스라 우리 책임 밖이지만,
 *     백업본이 항상 보존되므로 사용자가 원복 + 직접 합칠 수 있다 — UI 의 미리보기 단계에서
 *     diff.modified 로 사용자에게 명시.
 *
 *   불변성 (immutability): current 와 profile 어느 쪽도 mutate 하지 않는다. 깊은 복사 후 병합.
 */
export function mergeSettings(
  current: SettingsObject,
  profile: SettingsObject,
): { merged: SettingsObject; diff: DiffSummary } {
  // 깊은 복사 — JSON.stringify/parse 가 가장 단순하고 안전 (JsonValue 만 다루므로 함수/심볼 없음).
  const merged: SettingsObject = JSON.parse(JSON.stringify(current));

  // ── 방어적 타입 가드 (hardening #2) ─────────────────────────────────
  //   사용자의 기존 settings.json 에 env 또는 hooks 가 null, array, 또는 primitive 일 수
  //   있다 (직접 편집 / 다른 도구가 적은 비표준 값). 그대로 스프레드/속성 접근하면 TypeError
  //   가 발생하므로 *항상* plain object 로 정규화하여 안전한 기반 위에서 병합.
  //
  //   기존 값이 plain object 면 그대로(이미 깊은 복사된 상태), 그 외 (null/array/primitive)
  //   는 빈 객체로 재할당. 정규화 자체는 원본 사용자 데이터를 잃는 것이 아니라 "spyglass 가
  //   관리하는 두 키" 만 빈 객체로 시작 — top-level 사용자 키는 손대지 않음.
  if (!isPlainObject(merged.env)) merged.env = {};
  if (!isPlainObject(merged.hooks)) merged.hooks = {};

  // ── env.SPYGLASS_DIR 주입 ────────────────────────────────────────────
  const profileEnv = isPlainObject(profile.env) ? (profile.env as SettingsObject) : {};
  const newSpyglassDir = typeof profileEnv.SPYGLASS_DIR === 'string' ? profileEnv.SPYGLASS_DIR : '';
  const currentEnv: SettingsObject = merged.env as SettingsObject;
  const oldSpyglassDir =
    typeof currentEnv.SPYGLASS_DIR === 'string' && currentEnv.SPYGLASS_DIR.length > 0
      ? currentEnv.SPYGLASS_DIR
      : null;

  currentEnv.SPYGLASS_DIR = newSpyglassDir;
  merged.env = currentEnv;

  const spyglassDirChange: DiffSummary['spyglassDir'] =
    oldSpyglassDir === null
      ? 'created'
      : oldSpyglassDir === newSpyglassDir
      ? 'unchanged'
      : 'changed';

  // ── hooks.* 주입 ────────────────────────────────────────────────────
  //   merged.hooks 는 위 가드에서 이미 plain object 보장됨.
  const profileHooks = isPlainObject(profile.hooks) ? (profile.hooks as SettingsObject) : {};
  const currentHooks: SettingsObject = merged.hooks as SettingsObject;

  const applied: string[] = [];
  const modified: string[] = [];

  for (const [event, value] of Object.entries(profileHooks)) {
    if (event in currentHooks) {
      modified.push(event);
    } else {
      applied.push(event);
    }
    currentHooks[event] = value;
  }

  // current 에 있지만 profile 에 없는 hook event — 보존 (사용자 설정 보호).
  const preserved: string[] = [];
  for (const event of Object.keys(currentHooks)) {
    if (!(event in profileHooks) && !applied.includes(event) && !modified.includes(event)) {
      preserved.push(event);
    }
  }
  merged.hooks = currentHooks;

  // ── 그 외 top-level 키: profile 에서 가져오지 않음 — 의도적 무시 (불변식 2의 핵심) ────

  return {
    merged,
    diff: {
      applied: applied.sort(),
      modified: modified.sort(),
      preserved: preserved.sort(),
      spyglassDir: spyglassDirChange,
      spyglassDirBefore: oldSpyglassDir,
      spyglassDirAfter: newSpyglassDir,
    },
  };
}

// =============================================================================
// 백업 / Atomic write — file-edit-toolkit 위임 (불변식 SSoT 통합)
// =============================================================================

/**
 * `~/.claude/settings.json` 을 백업. 단순히 file-edit-toolkit::backupFile 위임 — 동작 동일.
 * 외부 export 시그니처는 보존 (원본 미존재 시 null).
 */
export async function backupSettings(): Promise<string | null> {
  return backupFile(getSettingsPath());
}

/**
 * 병합된 settings 객체를 `~/.claude/settings.json` 에 atomic 저장.
 *
 *   - JSON pretty-print: indent 2 — 사용자가 직접 들여다볼 수 있는 형식.
 *   - 실제 IO 는 file-edit-toolkit::writeAtomic 위임 — `~/.spyglass/tmp/` 격리 + cross-platform.
 *
 *   응답 시그니처 `{finalSize}` 는 외부 호출자(routes/settings.ts) 가 사용 중이므로 보존.
 */
export async function applySettings(merged: SettingsObject): Promise<{ finalSize: number }> {
  const body = JSON.stringify(merged, null, 2) + '\n';
  const { bytes } = await writeAtomic(getSettingsPath(), body);
  return { finalSize: bytes };
}

// =============================================================================
// 고수준 — preview / apply 두 진입점
// =============================================================================

/**
 * 적용하지 *않고* diff 만 미리보기 — UI 가 사용자에게 확인 모달을 띄우기 위함.
 */
export async function previewHookApply(
  profile: HookProfileKind,
  spyglassDir: string = process.cwd(),
): Promise<{ diff: DiffSummary; merged: SettingsObject; current: SettingsObject }> {
  const current = await loadCurrentSettings();
  const profileJson = await loadHookProfile(profile, spyglassDir);
  const { merged, diff } = mergeSettings(current, profileJson);
  return { diff, merged, current };
}

/**
 * 백업본으로부터 settings.json 을 원복 — UI 의 "Undo" 흐름.
 *
 * 동작:
 *   1) backupPath 가 실제 settings.json 백업 형식인지 검증
 *      ( `${SETTINGS_PATH}.bak-...` prefix + `.bak-` substring )
 *      — 임의 파일을 settings.json 으로 덮어쓰는 path traversal 공격 방어.
 *   2) backupPath 존재 확인.
 *   3) *현재* settings.json 도 다시 한 번 백업 — 원복 자체에 대한 안전망.
 *      (이름: `settings.json.bak-<ts>-pre-restore`).
 *   4) backupPath 내용을 atomic 으로 settings.json 에 복사 (read → applySettings).
 *
 * @throws backupPath 형식 위반 / 파일 미존재 / 깨진 JSON.
 */
export async function restoreFromBackup(backupPath: string): Promise<{
  restoredFrom: string;
  preRestoreBackup: string | null;
  finalSize: number;
}> {
  const settingsPath = getSettingsPath();
  // ── 1) Path traversal 가드 (claude-hooks 도메인 책임) ───────────────
  // backupPath 는 반드시 `${settingsPath}.bak-` prefix 로 시작해야 한다 — 그 외 임의 경로를
  // settings.json 으로 복사하지 못하도록 차단. 단순 startsWith 검증으로 충분 (디렉토리는
  // settingsPath 의 dirname 으로 강제됨).
  if (!backupPath.startsWith(`${settingsPath}.bak-`)) {
    throw new Error('backupPath must be a settings.json backup (.bak- prefix in ~/.claude/)');
  }
  // ── 2) 백업 파일 JSON 검증 (settings 도메인 한정 — JSON 만 허용) ──
  try {
    const text = await readFile(backupPath, 'utf-8');
    const obj = JSON.parse(text);
    if (!isPlainObject(obj)) {
      throw new Error('backup file root is not a JSON object');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to read backup: ${msg}`);
  }
  // ── 3) 실제 복원 (toolkit 위임 — pre-restore 백업 + atomic write) ───
  const result = await toolkitRestoreFromBackup(backupPath, settingsPath);
  return {
    restoredFrom: result.restoredFrom,
    preRestoreBackup: result.preRestoreBackup,
    finalSize: result.bytes,
  };
}

/**
 * 백업 → 병합 → atomic write 전체 흐름. 백업 실패면 throw (사용자 보호).
 */
export async function applyHookProfile(
  profile: HookProfileKind,
  spyglassDir: string = process.cwd(),
): Promise<ApplyResult> {
  const current = await loadCurrentSettings();
  const profileJson = await loadHookProfile(profile, spyglassDir);
  const { merged, diff } = mergeSettings(current, profileJson);

  // 백업 실패 = critical. 백업 없이는 변경하지 않는다.
  const backupPath = await backupSettings();
  const { finalSize } = await applySettings(merged);

  // JSON 유효성 검증 — 기록한 파일을 다시 읽어 파싱(우리가 직렬화했으므로 정상이 기대값).
  let verify: 'ok' | 'failed' = 'ok';
  try {
    JSON.parse(await readFile(getSettingsPath(), 'utf-8'));
  } catch {
    verify = 'failed';
  }

  // 검증 통과 + 백업 존재 → 백업 삭제(누적 방지). 검증 실패 시 백업 유지(복원 가능).
  let finalBackupPath: string | null = backupPath;
  let backupRemoved = false;
  if (verify === 'ok' && backupPath) {
    backupRemoved = await deleteBackup(backupPath);
    if (backupRemoved) finalBackupPath = null;
  }

  return { backupPath: finalBackupPath, profile, diff, finalSize, verify, backupRemoved };
}

// =============================================================================
// 가드
// =============================================================================

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
