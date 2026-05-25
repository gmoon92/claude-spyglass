/**
 * settings/proxy-installer.ts — 사용자 셸 프로필에 claude() 프록시 함수 자동 설치
 *
 * 책임 (Single Responsibility):
 *   `~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish` 같은 *사용자 셸 프로필* 에 spyglass
 *   프록시 함수를 *idempotent* 하게 주입/복원/제거. 사용자가 터미널을 열어 직접 편집하는
 *   마찰을 0 으로 줄이는 게 목표.
 *
 *   사용자 코드 영역과 충돌하지 않도록 *마커 페어* 로 spyglass 블록만 격리:
 *
 *     # >>> spyglass proxy >>>
 *     claude() { ... }
 *     # <<< spyglass proxy <<<
 *
 *   *멱등성*: 마커 페어가 존재하면 *교체*, 없으면 파일 끝에 *append*.
 *   *안전성*: 한쪽 마커만 손상된 비정상 상태는 *throw* — 자동 복구 시도 시 사용자 코드를
 *   덮어쓸 위험이 있어 거부가 더 안전.
 *
 *   파일 IO 는 `file-edit-toolkit.ts` (backupFile + writeAtomic) 위임 — SSoT.
 *
 * 의존성:
 *   - file-edit-toolkit (백업/원자쓰기/복원 SSoT)
 *   - node:fs/promises (readFile, stat)
 *   - node:os (homedir) — process.env.HOME 폴백 우선
 *
 * 호출 흐름:
 *   routes/settings.ts::handleProxyInstall  → installProxyHook({shell?, port})
 *     → 1) detectShellProfile(shell) — SHELL env / 홈 디렉토리 탐색
 *     → 2) readFile(profile) — 없으면 빈 문자열
 *     → 3) replaceOrAppendMarkerBlock(content, snippet)
 *     → 4) backupFile(profile) → writeAtomic(profile, next)
 *     → 5) cleanGraphModeExports(profile) — 부수 클리닝 (옵션)
 *
 *   routes/settings.ts::handleProxyRestore → restoreProxyHook(backupPath?, shell?)
 *     → 옵션 A: backupPath 가 있으면 file-edit-toolkit::restoreFromBackup
 *     → 옵션 B: 없으면 *마커 블록만 삭제* (단순 uninstall)
 *
 * 디자인 결정 (Gemini 리뷰 §3.1, §3.4):
 *   - 마커 페어가 *깨진* (한쪽만 존재) 상태는 *throw* — append/덮어쓰기 모두 위험.
 *   - 셸 탐지 우선순위: 명시 인자 → SHELL env → ~/.zshrc 존재 → ~/.bashrc 존재 → default zsh.
 *   - Fish 셸은 함수 문법이 다르므로 (`function ... end`) 별도 분기.
 *   - 모든 IO 는 file-edit-toolkit 위임 — 백업 + atomic 불변식 무료로 획득.
 */

import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  backupFile,
  writeAtomic,
  restoreFromBackup as toolkitRestoreFromBackup,
} from './file-edit-toolkit';

// =============================================================================
// 타입 / 상수
// =============================================================================

export type ShellKind = 'zsh' | 'bash' | 'fish';
export type ShellSelector = ShellKind | 'auto';

/** 마커 페어 — *반드시* 고정 문자열. 변경 시 기존 사용자의 마커 블록을 *찾지 못해* append. */
export const MARKER_OPEN = '# >>> spyglass proxy >>>';
export const MARKER_CLOSE = '# <<< spyglass proxy <<<';

/** 한 줄짜리 SPYGLASS_GRAPH_MODE export 매칭 — 셸 클리닝용. */
const SPYGLASS_GRAPH_MODE_EXPORT_RE = /^\s*export\s+SPYGLASS_GRAPH_MODE=\S+\s*$/gm;

// =============================================================================
// 셸 프로필 탐지
// =============================================================================

/**
 * 사용자의 1차 셸 프로필 절대 경로 반환.
 *
 *   탐지 우선순위:
 *     1) 명시 인자 (shell !== 'auto')
 *     2) process.env.SHELL basename ('zsh'|'bash'|'fish')
 *     3) ~/.zshrc 존재 여부
 *     4) ~/.bashrc 존재 여부
 *     5) default zsh — macOS 기본
 *
 *   각 셸의 정식 위치:
 *     zsh  → `~/.zshrc`
 *     bash → `~/.bashrc`  (macOS 는 `.bash_profile` 도 흔하지만 본 PR 범위에선 `.bashrc` 만)
 *     fish → `~/.config/fish/config.fish`
 *
 *   파일이 *없어도* 경로는 반환 — 호출 측이 append/write 로 처리.
 */
export async function detectShellProfile(
  shell: ShellSelector = 'auto',
): Promise<{ shell: ShellKind; profilePath: string; existed: boolean }> {
  const home = process.env.HOME || homedir();

  // 1) 명시 인자.
  if (shell === 'zsh' || shell === 'bash' || shell === 'fish') {
    const profilePath = profilePathFor(shell, home);
    return { shell, profilePath, existed: await fileExists(profilePath) };
  }

  // 2) SHELL env basename.
  const sh = (process.env.SHELL || '').split('/').pop()?.toLowerCase() ?? '';
  if (sh === 'zsh' || sh === 'bash' || sh === 'fish') {
    const profilePath = profilePathFor(sh as ShellKind, home);
    return { shell: sh as ShellKind, profilePath, existed: await fileExists(profilePath) };
  }

  // 3-4) 파일 존재 확인.
  const zshrc = join(home, '.zshrc');
  if (await fileExists(zshrc)) return { shell: 'zsh', profilePath: zshrc, existed: true };
  const bashrc = join(home, '.bashrc');
  if (await fileExists(bashrc)) return { shell: 'bash', profilePath: bashrc, existed: true };

  // 5) default — zsh.
  return { shell: 'zsh', profilePath: zshrc, existed: false };
}

function profilePathFor(shell: ShellKind, home: string): string {
  if (shell === 'fish') return join(home, '.config', 'fish', 'config.fish');
  if (shell === 'bash') return join(home, '.bashrc');
  return join(home, '.zshrc');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

// =============================================================================
// 스니펫 생성 — 셸별 문법
// =============================================================================

/**
 * `claude()` 조건부 프록시 함수의 *본문* (마커 제외) 을 셸 종류별로 생성.
 *
 *   조건부 로직: spyglass 가 LISTEN 중일 때만 ANTHROPIC_BASE_URL 주입 — 서버 다운 시 자동
 *   원 Anthropic API 로 폴백. 사용자가 spyglass 끄면 claude 가 영향 받지 않음.
 */
export function buildProxySnippet(shell: ShellKind, port: number): string {
  if (shell === 'fish') {
    return `function claude
  if curl -fsS http://localhost:${port}/health > /dev/null 2>&1
    ANTHROPIC_BASE_URL=http://localhost:${port} command claude $argv
  else
    command claude $argv
  end
end`;
  }
  // bash / zsh.
  return `claude() {
  if curl -fsS http://localhost:${port}/health > /dev/null 2>&1; then
    ANTHROPIC_BASE_URL=http://localhost:${port} command claude "$@"
  else
    command claude "$@"
  fi
}`;
}

/** 마커 페어로 감싼 *완전한 블록* 반환. install 시 파일에 주입되는 텍스트. */
export function buildMarkerBlock(shell: ShellKind, port: number): string {
  const snippet = buildProxySnippet(shell, port);
  return `${MARKER_OPEN}\n${snippet}\n${MARKER_CLOSE}`;
}

// =============================================================================
// 멱등 교체 — 마커 페어 기반
// =============================================================================

/**
 * 셸 프로필 본문 안에서 마커 페어를 찾아 *교체* 하거나, 없으면 *append*.
 *
 *   - 양쪽 마커 모두 있음 → 두 마커 *사이* 내용을 새 블록으로 교체. 마커 페어 자체도
 *     새 블록의 것으로 갱신 (사용자가 마커 줄에 손댄 경우 자동 정상화).
 *   - 양쪽 마커 모두 없음 → 파일 끝에 *개행 정규화 후 append*. 마지막 줄에 개행 없을 수도
 *     있어 항상 `\n` prefix 안전 추가.
 *   - *한쪽 마커만 손상* → throw. spyglass 가 사용자 코드 영역을 잘못 덮어쓸 위험 차단.
 *
 *   반환: { content, action } — action 은 'replaced' | 'appended'.
 */
export function replaceOrAppendMarkerBlock(
  current: string,
  newBlock: string,
): { content: string; action: 'replaced' | 'appended' } {
  const hasOpen = current.includes(MARKER_OPEN);
  const hasClose = current.includes(MARKER_CLOSE);

  // 한쪽만 있음 — 비정상 → 거부.
  if (hasOpen !== hasClose) {
    throw new Error(
      'Shell profile has a corrupted spyglass marker block (only one side present). ' +
        'Please fix or remove the stray marker manually before retrying.',
    );
  }

  // 양쪽 다 있음 — 두 마커 사이 (양쪽 마커 포함) 통째로 교체.
  if (hasOpen && hasClose) {
    const openIdx = current.indexOf(MARKER_OPEN);
    const closeIdx = current.indexOf(MARKER_CLOSE);
    // 동일 줄에 두 마커가 다 있는 비정상 케이스 (open 다음에 close) 도 거부.
    if (closeIdx < openIdx) {
      throw new Error(
        'Shell profile marker order is inverted (close before open). Please fix manually.',
      );
    }
    const closeEnd = closeIdx + MARKER_CLOSE.length;
    const before = current.slice(0, openIdx);
    const after = current.slice(closeEnd);
    return { content: `${before}${newBlock}${after}`, action: 'replaced' };
  }

  // 양쪽 다 없음 — append.
  const needsLeadingNewline = current.length > 0 && !current.endsWith('\n');
  const sep = needsLeadingNewline ? '\n\n' : current.length > 0 ? '\n' : '';
  return { content: `${current}${sep}${newBlock}\n`, action: 'appended' };
}

/**
 * 마커 블록 *제거만* — uninstall 흐름. 마커가 없으면 no-op (idempotent).
 *   한쪽만 손상된 비정상 상태는 동일하게 throw (사용자 의도 없는 자동 처리 차단).
 */
export function removeMarkerBlock(current: string): { content: string; removed: boolean } {
  const hasOpen = current.includes(MARKER_OPEN);
  const hasClose = current.includes(MARKER_CLOSE);
  if (hasOpen !== hasClose) {
    throw new Error('Shell profile has a corrupted spyglass marker block — fix manually.');
  }
  if (!hasOpen) return { content: current, removed: false };

  const openIdx = current.indexOf(MARKER_OPEN);
  const closeEnd = current.indexOf(MARKER_CLOSE) + MARKER_CLOSE.length;
  // 블록 직후 연속 개행 1개도 함께 제거 — append 시 우리가 추가한 trailing \n 보정.
  let after = current.slice(closeEnd);
  if (after.startsWith('\n')) after = after.slice(1);
  // 블록 직전 연속 개행 1개도 정리 — append 시 우리가 추가한 leading \n\n 중 하나.
  let before = current.slice(0, openIdx);
  if (before.endsWith('\n\n')) before = before.slice(0, -1);
  return { content: `${before}${after}`, removed: true };
}

// =============================================================================
// SPYGLASS_GRAPH_MODE export 클리닝 — 부수 셸 최적화
// =============================================================================

/**
 * 셸 프로필 안의 `export SPYGLASS_GRAPH_MODE=...` 줄을 *주석 처리* (삭제 X).
 *
 *   PR 1 의 server-config.json 영속화가 도입되면서, 사용자의 셸 프로필에 남아 있는 export 가
 *   *env override* 로 GUI 변경을 막는 케이스를 자동 해결. 단 *삭제는 위험* — 사용자가 의도적
 *   으로 둔 케이스도 있으므로 `#` 주석 처리 + 안내 코멘트만 추가 (사용자가 영구 제거하려면
 *   본인이 직접 해당 줄 삭제).
 *
 *   반환: { content, cleanedCount } — 주석 처리된 줄 수.
 */
export function cleanGraphModeExports(current: string): { content: string; cleanedCount: number } {
  let cleanedCount = 0;
  const note = ` # commented by spyglass — was overriding GUI graphMode`;
  const next = current.replace(SPYGLASS_GRAPH_MODE_EXPORT_RE, (line) => {
    // 이미 주석 처리됐으면 스킵 (정규식 자체가 `export` 시작이라 매칭 안 됨 — 방어).
    if (line.trim().startsWith('#')) return line;
    cleanedCount++;
    return `# ${line.trim()}${note}`;
  });
  return { content: next, cleanedCount };
}

// =============================================================================
// 고수준 — install / restore / uninstall 진입점
// =============================================================================

/**
 * 현재 셸 프로필의 spyglass 프록시 설치 상태 확인.
 *
 *   - 양쪽 마커 모두 있음 → installed:true (정상 설치).
 *   - 한쪽만 있음 → installed:false + corrupted:true (사용자 안내 필요).
 *   - 둘 다 없음 → installed:false.
 *   - 파일 자체 없음 → installed:false + profileExisted:false.
 *
 *   읽기 전용 — *어떤 파일도 수정하지 않음*. 진단 카드의 통합 상태 배지 입력으로 사용.
 */
export async function checkProxyInstalled(
  shell: ShellSelector = 'auto',
): Promise<{
  shell: ShellKind;
  profilePath: string;
  profileExisted: boolean;
  installed: boolean;
  corrupted: boolean;
  hasMarkerOpen: boolean;
  hasMarkerClose: boolean;
}> {
  const { shell: detected, profilePath, existed } = await detectShellProfile(shell);
  if (!existed) {
    return {
      shell: detected,
      profilePath,
      profileExisted: false,
      installed: false,
      corrupted: false,
      hasMarkerOpen: false,
      hasMarkerClose: false,
    };
  }
  let text = '';
  try {
    text = await readFile(profilePath, 'utf-8');
  } catch {
    // 권한 등으로 읽기 실패 — installed:false 로 처리.
    return {
      shell: detected,
      profilePath,
      profileExisted: existed,
      installed: false,
      corrupted: false,
      hasMarkerOpen: false,
      hasMarkerClose: false,
    };
  }
  const hasOpen = text.includes(MARKER_OPEN);
  const hasClose = text.includes(MARKER_CLOSE);
  return {
    shell: detected,
    profilePath,
    profileExisted: existed,
    installed: hasOpen && hasClose,
    corrupted: hasOpen !== hasClose,
    hasMarkerOpen: hasOpen,
    hasMarkerClose: hasClose,
  };
}

export interface InstallResult {
  installedTo: string;
  shell: ShellKind;
  backupPath: string | null;
  action: 'replaced' | 'appended';
  cleanedGraphModeExports: number;
  nextAction: string;
}

/**
 * 셸 프로필에 spyglass 프록시 블록을 idempotent 설치.
 *
 *   1) detectShellProfile(shell) — 자동/명시 분기.
 *   2) 현재 파일 읽기 (없으면 빈 문자열).
 *   3) cleanGraphModeExports — 부수 클리닝.
 *   4) replaceOrAppendMarkerBlock(content, marker block).
 *   5) backupFile (원본 있으면) + writeAtomic.
 *   6) 응답 — nextAction 문구로 *셸 재시작 또는 source* 안내.
 */
export async function installProxyHook(args: {
  shell?: ShellSelector;
  port: number;
}): Promise<InstallResult> {
  const { shell: detectedShell, profilePath, existed } = await detectShellProfile(args.shell ?? 'auto');
  const current = existed ? await readFile(profilePath, 'utf-8') : '';

  // 부수 클리닝 — graph mode export 잔존 시 주석화.
  const cleaned = cleanGraphModeExports(current);

  // 마커 블록 idempotent 교체/추가.
  const block = buildMarkerBlock(detectedShell, args.port);
  const replaced = replaceOrAppendMarkerBlock(cleaned.content, block);

  // 백업 + atomic write.
  const backupPath = await backupFile(profilePath);
  await writeAtomic(profilePath, replaced.content);

  return {
    installedTo: profilePath,
    shell: detectedShell,
    backupPath,
    action: replaced.action,
    cleanedGraphModeExports: cleaned.cleanedCount,
    nextAction:
      detectedShell === 'fish'
        ? `Open a new terminal or run: source ${profilePath}`
        : `Open a new terminal or run: source ${profilePath}`,
  };
}

/**
 * 셸 프로필 원복 — 두 모드.
 *
 *   - backupPath 가 주어지면 file-edit-toolkit::restoreFromBackup 으로 *백업 전체 복원*.
 *     이 경우 path traversal 가드는 *호출 측* (settings.ts) 가 책임 — 본 함수는 백업 prefix
 *     매칭만 확인 (셸 프로필 형식: `.bak-YYYYMMDD-HHMMSS`).
 *   - backupPath 가 없으면 *마커 블록만 제거* (단순 uninstall — 다른 사용자 코드는 보존).
 */
export async function restoreProxyHook(args: {
  backupPath?: string;
  shell?: ShellSelector;
}): Promise<{
  targetPath: string;
  mode: 'restore-backup' | 'uninstall-block';
  restoredFrom: string | null;
  preRestoreBackup: string | null;
  removedBlock: boolean;
}> {
  const { profilePath } = await detectShellProfile(args.shell ?? 'auto');

  if (args.backupPath) {
    // 백업 복원 — toolkit 위임. path traversal 가드: 백업 경로가 *같은 디렉토리* + .bak- prefix.
    if (!args.backupPath.startsWith(`${profilePath}.bak-`)) {
      throw new Error('backupPath must be a backup of the detected shell profile (.bak- prefix)');
    }
    const r = await toolkitRestoreFromBackup(args.backupPath, profilePath);
    return {
      targetPath: profilePath,
      mode: 'restore-backup',
      restoredFrom: r.restoredFrom,
      preRestoreBackup: r.preRestoreBackup,
      removedBlock: false,
    };
  }

  // 마커 블록만 제거.
  const current = await readFile(profilePath, 'utf-8').catch(() => '');
  const { content, removed } = removeMarkerBlock(current);
  if (!removed) {
    return {
      targetPath: profilePath,
      mode: 'uninstall-block',
      restoredFrom: null,
      preRestoreBackup: null,
      removedBlock: false,
    };
  }
  // 변경 발생 — 백업 + atomic write.
  const pre = await backupFile(profilePath);
  await writeAtomic(profilePath, content);
  return {
    targetPath: profilePath,
    mode: 'uninstall-block',
    restoredFrom: null,
    preRestoreBackup: pre,
    removedBlock: true,
  };
}
