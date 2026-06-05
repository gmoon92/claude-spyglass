/**
 * settings/file-edit-toolkit.ts — 민감 파일 편집 공용 SSoT
 *
 * 책임 (Single Responsibility):
 *   사용자의 *민감 파일* 을 spyglass 서버가 안전하게 수정할 때 따라야 하는 *3가지 불변식* 을
 *   한 곳에서 보장하는 도메인-중립 유틸리티 묶음.
 *
 *     [불변식 1] 변경 전 *반드시* 백업 (덮어쓰지 않는 unique suffix)
 *     [불변식 2] 같은 디스크 파티션의 격리 tmp 디렉토리 사용 (사용자 홈 오염 X)
 *     [불변식 3] tmp → 원본 atomic rename — cross-platform 분기 (Windows EPERM 흡수)
 *
 *   `claude-hooks.ts` 와 `proxy-installer.ts` 가 본 모듈을 공유 — feedback_avoid_spaghetti 준수.
 *   도메인 로직 (Hook 병합, 마커 페어 교체) 은 각 도메인 파일이 담당, 본 파일은 *파일 IO 원시* 만.
 *
 * 의존성:
 *   - node:fs/promises (readFile, writeFile, rename, mkdir, copyFile, stat, unlink)
 *   - node:os (homedir) / node:path (join, dirname)
 *
 * 호출 흐름:
 *   1) claude-hooks.ts::applyHookProfile → backupFile + writeAtomic
 *   2) proxy-installer.ts::installProxyHook → backupFile + writeAtomic
 *   3) restoreFromBackup 류 호출자 → restoreFromBackup helper
 *
 * 디자인 결정 (Gemini 리뷰 §3.3, §3.6):
 *   - tmp 위치를 `~/.spyglass/tmp/` 로 격리 — `~/.zshrc.tmp-xxx` 같은 홈 오염 방지.
 *   - 같은 파티션 보장 — `~/.spyglass/` 와 사용자 홈은 동일 디스크가 일반적.
 *   - Windows: destination 존재 시 rename 이 EPERM → unlink 후 rename. 1-step atomic 깨지지만
 *     부분 회복 가능 (tmp 가 남으면 사용자가 수동 복원).
 */

import {
  readFile,
  writeFile,
  rename,
  mkdir,
  copyFile,
  stat,
  unlink,
} from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';

// =============================================================================
// tmp 경로 SSoT — ~/.spyglass/tmp/ 격리
// =============================================================================

const SPYGLASS_HOME_DIRNAME = '.spyglass';
const TMP_SUBDIR = 'tmp';

/**
 * 사용자 홈. process.env.HOME 우선 (테스트가 임시 dir 로 redirect 가능),
 * 없으면 USERPROFILE (Windows), 그것도 없으면 /tmp 폴백.
 */
function getUserHome(): string {
  return process.env.HOME || process.env.USERPROFILE || '/tmp';
}

/**
 * `~/.spyglass/tmp/` 디렉토리 절대 경로.
 *   - `getTmpDir()` 호출자는 항상 같은 파티션 가정 가능.
 *   - 외부에서도 사용 가능하도록 export — 테스트가 위치 검증 등에 활용.
 */
export function getTmpDir(): string {
  const home = getUserHome();
  // SPYGLASS_HOME 환경변수가 직접 `~/.spyglass` 를 가리키는 케이스 호환.
  const alreadyRoot = home.endsWith(`/${SPYGLASS_HOME_DIRNAME}`);
  const spyglassRoot = alreadyRoot ? home : join(home, SPYGLASS_HOME_DIRNAME);
  return join(spyglassRoot, TMP_SUBDIR);
}

/** tmp 디렉토리가 없으면 생성. idempotent. */
async function ensureTmpDir(): Promise<string> {
  const dir = getTmpDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

// =============================================================================
// [불변식 1] backupFile — 절대 덮어쓰지 않는 백업
// =============================================================================

/**
 * 대상 파일을 `<target>.bak-YYYYMMDD-HHMMSS` 로 복사.
 *
 *   - 대상 파일이 없으면 *null 반환* — 백업할 게 없는 상태.
 *   - 동일 초 안에 두 번 호출되면 `-${random}` 추가 suffix 로 충돌 회피.
 *   - 백업 파일은 *원본과 같은 디렉토리* 에 둔다 — 사용자가 직접 보고 식별 가능.
 *   - 실패 시 throw — 호출 측이 변경을 *중단* 해야 (불변식 1 의 핵심: backup 없이 변경 X).
 *
 *   @returns 생성된 백업 절대 경로, 또는 원본 미존재 시 null.
 */
export async function backupFile(targetPath: string): Promise<string | null> {
  // 원본 존재 확인.
  try {
    const st = await stat(targetPath);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }

  const ts = formatTimestamp(new Date());
  let backupPath = `${targetPath}.bak-${ts}`;
  // 충돌 회피 — 동일 ts 이미 있으면 random 6글자 suffix 폴백.
  try {
    await stat(backupPath);
    backupPath = `${targetPath}.bak-${ts}-${randomSuffix(6)}`;
  } catch {
    // 정상 — backupPath 사용 가능.
  }

  await copyFile(targetPath, backupPath);
  return backupPath;
}

/** `YYYYMMDD-HHMMSS` 로컬 시각 포맷 — 사용자가 자기 시계 기준으로 식별 가능. */
function formatTimestamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function randomSuffix(len: number): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

// =============================================================================
// [불변식 2 + 3] writeAtomic — tmp → rename, cross-platform
// =============================================================================

/**
 * 텍스트를 `targetPath` 에 atomic 쓰기.
 *
 *   1) `targetPath` 의 dirname 디렉토리 보장 (mkdir recursive).
 *   2) `~/.spyglass/tmp/<basename>.<random>` 에 새 내용 작성.
 *   3) tmp → targetPath 로 cross-platform atomic rename.
 *   4) 실패 시 tmp cleanup (best-effort).
 *
 *   `~/.spyglass/tmp/` 격리 — Gemini §3.3 권고. 사용자 홈에 `.zshrc.tmp-xxx` 같은 파일이
 *   남지 않게 한다. 같은 파일시스템 가정 — 대부분의 사용자가 ~/.spyglass 와 홈이 동일 디스크.
 *
 *   @returns 작성된 바이트 수 (Buffer.byteLength).
 */
export async function writeAtomic(targetPath: string, content: string): Promise<{ bytes: number }> {
  // 대상 디렉토리 보장.
  await mkdir(dirname(targetPath), { recursive: true });
  // tmp 디렉토리 보장 + tmp 파일 경로 생성.
  const tmpDir = await ensureTmpDir();
  const tmpPath = join(tmpDir, `${basename(targetPath)}.${randomSuffix(10)}`);

  try {
    await writeFile(tmpPath, content, 'utf-8');
    await atomicReplace(tmpPath, targetPath);
  } catch (err) {
    // tmp 가 남아있다면 cleanup.
    try { await unlink(tmpPath); } catch { /* best-effort */ }
    throw err;
  }

  return { bytes: Buffer.byteLength(content, 'utf-8') };
}

/**
 * tmp → target atomic replace — cross-platform.
 *
 *   POSIX (linux/macOS): `rename` 한 번 — kernel 보장 atomic, target overwrite 정상.
 *   Win32: target 존재 시 `rename` 이 EPERM/EEXIST → unlink 후 rename. 1-step atomic
 *     깨지지만 부분 회복 가능 (tmp 가 남으면 사용자가 수동 복원).
 */
async function atomicReplace(tmpPath: string, targetPath: string): Promise<void> {
  if (process.platform === 'win32') {
    try { await unlink(targetPath); } catch { /* target 없거나 권한 — rename 단계서 재 throw */ }
    await rename(tmpPath, targetPath);
    return;
  }
  await rename(tmpPath, targetPath);
}

// =============================================================================
// restoreFromBackup — 일반화된 Undo 헬퍼
// =============================================================================

/**
 * 백업 파일의 내용을 *원본 경로* 로 복원.
 *
 *   호출 측이 *backupPath 의 안전성* 을 책임 (prefix 검증, 도메인별 path traversal 가드).
 *   본 함수는 단순히: 백업 파일 읽기 → 텍스트로 writeAtomic. 만약 원본이 존재하면 *pre-restore
 *   백업* 도 만들어 Undo 의 Undo 를 보장한다.
 *
 *   @returns { restoredFrom, preRestoreBackup, bytes }
 *     preRestoreBackup 은 원본 미존재 시 null.
 */
export async function restoreFromBackup(
  backupPath: string,
  targetPath: string,
): Promise<{ restoredFrom: string; preRestoreBackup: string | null; bytes: number }> {
  // 백업 파일 검증 — 존재 + 읽기 가능 + binary 아님은 호출 측이 별도 검증.
  let text: string;
  try {
    text = await readFile(backupPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to read backup: ${msg}`);
  }

  // 원본을 pre-restore 백업 — 원복 자체가 사용자 실수일 수도 있으므로 한 번 더 안전망.
  let preRestoreBackup: string | null = null;
  try {
    const st = await stat(targetPath);
    if (st.isFile()) {
      const ts = formatTimestamp(new Date());
      let pre = `${targetPath}.bak-${ts}-pre-restore`;
      try {
        await stat(pre);
        pre += `-${randomSuffix(4)}`;
      } catch { /* unused */ }
      await copyFile(targetPath, pre);
      preRestoreBackup = pre;
    }
  } catch {
    // 원본 미존재 — pre-restore 백업 불필요.
  }

  const { bytes } = await writeAtomic(targetPath, text);
  return { restoredFrom: backupPath, preRestoreBackup, bytes };
}

/**
 * 백업 파일 삭제 — *검증 성공 후 확정* 시 호출해 백업 누적을 방지.
 *   - backupPath 가 null/빈값이면 no-op (백업 없던 케이스).
 *   - 삭제 실패(이미 없음/권한)는 흡수 — 백업 정리는 best-effort 이지 치명 동작 아님.
 *   - 안전: spyglass 가 backupFile 로 만든 `.bak-…` 만 호출 측이 넘긴다(임의 경로 삭제 아님).
 *   반환: 실제 삭제했으면 true.
 */
export async function deleteBackup(backupPath: string | null | undefined): Promise<boolean> {
  if (!backupPath) return false;
  try {
    await unlink(backupPath);
    return true;
  } catch {
    return false; // 이미 없거나 권한 — 무시.
  }
}
