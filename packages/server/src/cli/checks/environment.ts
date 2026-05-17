/**
 * 환경/설정 체크 — Bun, settings.json, 훅 등록, 훅 스크립트 권한.
 *
 * 변경 이유: 설치 가이드·훅 키 목록·SPYGLASS_DIR 정책 변경 시 묶여서 손이 가는 묶음.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import type { CheckResult } from '../output';
import { t } from '../../i18n';

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
        message: t('checks.environment.bun.ok', { version }),
      };
    }

    return {
      status: 'fail',
      message: t('checks.environment.bun.fail', { version }),
      hint: t('checks.environment.bun.hint-upgrade'),
    };
  } catch {
    return {
      status: 'fail',
      message: t('checks.environment.bun.fail-not-installed'),
      hint: t('checks.environment.bun.hint-install'),
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
      message: t('checks.environment.settings-json.fail-missing'),
      hint: t('checks.environment.settings-json.hint-install'),
    };
  }

  try {
    JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return {
      status: 'ok',
      message: t('checks.environment.settings-json.ok'),
    };
  } catch {
    return {
      status: 'fail',
      message: t('checks.environment.settings-json.fail-parse'),
      hint: t('checks.environment.settings-json.hint-fix-json'),
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
      message: t('checks.environment.hooks-registered.fail-unavailable'),
      hint: t('checks.environment.hooks-registered.hint-need-settings'),
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
          message: t('checks.environment.hooks-registered.warn-no-dir'),
          hint: t('checks.environment.hooks-registered.hint-set-dir'),
        };
      }

      return {
        status: 'ok',
        message: t('checks.environment.hooks-registered.ok', { dir: spyglassDir }),
      };
    }

    return {
      status: 'fail',
      message: t('checks.environment.hooks-registered.fail-not-registered'),
      hint: t('checks.environment.hooks-registered.hint-add-hooks'),
    };
  } catch {
    return {
      status: 'fail',
      message: t('checks.environment.settings-json.fail-parse'),
      hint: t('checks.environment.settings-json.hint-fix-json'),
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
      message: t('checks.environment.hook-executable.fail-unavailable'),
      hint: t('checks.environment.hook-executable.hint-need-settings'),
    };
  }

  try {
    const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const spyglassDir = content.env?.SPYGLASS_DIR;

    if (!spyglassDir) {
      return {
        status: 'warn',
        message: t('checks.environment.hook-executable.warn-no-dir'),
        hint: t('checks.environment.hook-executable.hint-set-dir'),
      };
    }

    const hookScript = `${spyglassDir}/hooks/spyglass-collect.sh`;

    if (!existsSync(hookScript)) {
      return {
        status: 'fail',
        message: t('checks.environment.hook-executable.fail-missing', { path: hookScript }),
        hint: t('checks.environment.hook-executable.hint-check-path'),
      };
    }

    const stat = statSync(hookScript);
    const isExecutable = (stat.mode & parseInt('0111', 8)) !== 0;

    if (!isExecutable) {
      return {
        status: 'fail',
        message: t('checks.environment.hook-executable.fail-no-permission', { path: hookScript }),
        hint: t('checks.environment.hook-executable.hint-chmod', { path: hookScript }),
      };
    }

    return {
      status: 'ok',
      message: t('checks.environment.hook-executable.ok'),
    };
  } catch {
    return {
      status: 'fail',
      message: t('checks.environment.hook-executable.fail-check-failed'),
      hint: t('checks.environment.hook-executable.hint-check-format'),
    };
  }
}
