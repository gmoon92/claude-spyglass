/**
 * --fix 자동 수정 — chmod 등.
 *
 * 변경 이유: 자동 수정 가능한 항목 추가/제거 시.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { getDefaultDbPath } from '@spyglass/storage';
import { log } from './output';

/**
 * --fix 플래그로 chmod 등 자동 수정
 */
export function applyFixes(): boolean {
  let fixed = false;

  // 1. DB 파일 권한 수정
  const dbPath = getDefaultDbPath();
  if (existsSync(dbPath)) {
    try {
      const stat = statSync(dbPath);
      if (stat.mode & 0o077) {
        execSync(`chmod 600 ${dbPath}`);
        log('ok', `DB 권한 수정: chmod 600 ${dbPath}`);
        fixed = true;
      }
    } catch {
      log('fail', `DB 권한 수정 실패: ${dbPath}`);
    }
  }

  // 2. 훅 스크립트 권한 수정
  const settingsPath = `${process.env.HOME}/.claude/settings.json`;
  if (existsSync(settingsPath)) {
    try {
      const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const spyglassDir = content.env?.SPYGLASS_DIR;

      if (spyglassDir) {
        const hookScript = `${spyglassDir}/hooks/spyglass-collect.sh`;
        if (existsSync(hookScript)) {
          const stat = statSync(hookScript);
          if ((stat.mode & parseInt('0111', 8)) === 0) {
            execSync(`chmod +x ${hookScript}`);
            log('ok', `훅 스크립트 권한 수정: chmod +x ${hookScript}`);
            fixed = true;
          }
        }
      }
    } catch {
      log('fail', '훅 스크립트 권한 수정 실패');
    }
  }

  return fixed;
}
