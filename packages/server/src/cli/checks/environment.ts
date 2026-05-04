/**
 * 환경/설정 체크 — Bun, settings.json, 훅 등록, 훅 스크립트 권한.
 *
 * 변경 이유: 설치 가이드·훅 키 목록·SPYGLASS_DIR 정책 변경 시 묶여서 손이 가는 묶음.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import type { CheckResult } from '../output';

/**
 * 1. Bun 버전 확인 (≥ 1.0)
 */
export function checkBunVersion(): CheckResult {
  try {
    const output = execSync('bun --version', { encoding: 'utf-8' }).trim();
    const version = output.replace(/^v/, '');
    const [major] = version.split('.');

    if (parseInt(major, 10) >= 1) {
      return {
        status: 'ok',
        message: `Bun ${version}`,
      };
    }

    return {
      status: 'fail',
      message: `Bun ${version} (require ≥ 1.0)`,
      hint: 'bun upgrade를 실행하세요',
    };
  } catch {
    return {
      status: 'fail',
      message: 'Bun이 설치되지 않았습니다',
      hint: 'https://bun.sh/install에서 설치하세요',
    };
  }
}

/**
 * 2. ~/.claude/settings.json 존재 및 JSON 파싱 확인
 */
export function checkSettingsJson(): CheckResult {
  const settingsPath = `${process.env.HOME}/.claude/settings.json`;

  if (!existsSync(settingsPath)) {
    return {
      status: 'fail',
      message: 'settings.json이 없습니다',
      hint: `다음을 실행하세요: curl -fsSL https://raw.githubusercontent.com/gmoon92/claude-spyglass/main/scripts/install.sh | bash`,
    };
  }

  try {
    JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return {
      status: 'ok',
      message: 'settings.json 정상',
    };
  } catch {
    return {
      status: 'fail',
      message: 'settings.json JSON 파싱 실패',
      hint: '올바른 JSON 형식으로 수정하세요',
    };
  }
}

/**
 * 3. 훅 등록 여부 확인 (spyglass-collect.sh 경로 포함)
 */
export function checkHooksRegistered(): CheckResult {
  const settingsPath = `${process.env.HOME}/.claude/settings.json`;

  if (!existsSync(settingsPath)) {
    return {
      status: 'fail',
      message: '훅 설정 확인 불가 (settings.json 없음)',
      hint: 'settings.json이 필요합니다',
    };
  }

  try {
    const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const hooks = content.hooks || {};

    // 최소 6개 훅 중 하나라도 spyglass-collect.sh를 포함하는지 확인
    const hookKeys = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd', 'Stop'];
    const hasSpyglassHook = Object.entries(hooks).some(([key, value]: [string, any]) => {
      if (!hookKeys.includes(key)) return false;
      const hookArray = Array.isArray(value) ? value : [value];
      return hookArray.some((h: any) => {
        const hooks_list = h.hooks || [];
        return hooks_list.some((hook: any) => hook.command?.includes('spyglass-collect.sh'));
      });
    });

    if (hasSpyglassHook) {
      const spyglassDir = content.env?.SPYGLASS_DIR;
      if (!spyglassDir) {
        return {
          status: 'warn',
          message: '훅 설정 있음, 하지만 SPYGLASS_DIR 미설정',
          hint: `env.SPYGLASS_DIR을 설정하세요 (예: ~/.spyglass-src 또는 /path/to/claude-spyglass)`,
        };
      }

      return {
        status: 'ok',
        message: `훅 등록됨 (SPYGLASS_DIR: ${spyglassDir})`,
      };
    }

    return {
      status: 'fail',
      message: '훅이 등록되지 않았습니다',
      hint: 'settings.json에 spyglass-collect.sh 훅을 추가하세요',
    };
  } catch {
    return {
      status: 'fail',
      message: 'settings.json 파싱 실패',
      hint: '올바른 JSON 형식으로 수정하세요',
    };
  }
}

/**
 * 4. 훅 스크립트 실행 권한 확인
 */
export function checkHookExecutable(): CheckResult {
  const settingsPath = `${process.env.HOME}/.claude/settings.json`;

  if (!existsSync(settingsPath)) {
    return {
      status: 'fail',
      message: '훅 스크립트 위치 확인 불가',
      hint: 'settings.json이 필요합니다',
    };
  }

  try {
    const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const spyglassDir = content.env?.SPYGLASS_DIR;

    if (!spyglassDir) {
      return {
        status: 'warn',
        message: 'SPYGLASS_DIR이 미설정되어 훅 스크립트 확인 불가',
        hint: 'settings.json에서 env.SPYGLASS_DIR을 설정하세요',
      };
    }

    const hookScript = `${spyglassDir}/hooks/spyglass-collect.sh`;

    if (!existsSync(hookScript)) {
      return {
        status: 'fail',
        message: `훅 스크립트가 없습니다: ${hookScript}`,
        hint: 'SPYGLASS_DIR 경로를 확인하세요',
      };
    }

    const stat = statSync(hookScript);
    const isExecutable = (stat.mode & parseInt('0111', 8)) !== 0;

    if (!isExecutable) {
      return {
        status: 'fail',
        message: `훅 스크립트 실행 권한 없음: ${hookScript}`,
        hint: `chmod +x ${hookScript}`,
      };
    }

    return {
      status: 'ok',
      message: '훅 스크립트 실행 권한 OK',
    };
  } catch {
    return {
      status: 'fail',
      message: '훅 스크립트 확인 실패',
      hint: 'settings.json 형식을 확인하세요',
    };
  }
}
