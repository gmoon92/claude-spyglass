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
      hint: t('checks.environment.bun.hintUpgrade'),
    };
  } catch {
    return {
      status: 'fail',
      message: t('checks.environment.bun.failNotInstalled'),
      hint: t('checks.environment.bun.hintInstall'),
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
      message: t('checks.environment.settingsJson.failMissing'),
      hint: t('checks.environment.settingsJson.hintInstall'),
    };
  }

  try {
    JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return {
      status: 'ok',
      message: t('checks.environment.settingsJson.ok'),
    };
  } catch {
    return {
      status: 'fail',
      message: t('checks.environment.settingsJson.failParse'),
      hint: t('checks.environment.settingsJson.hintFixJson'),
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
      message: t('checks.environment.hooksRegistered.failUnavailable'),
      hint: t('checks.environment.hooksRegistered.hintNeedSettings'),
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
          message: t('checks.environment.hooksRegistered.warnNoDir'),
          hint: t('checks.environment.hooksRegistered.hintSetDir'),
        };
      }

      return {
        status: 'ok',
        message: t('checks.environment.hooksRegistered.ok', { dir: spyglassDir }),
      };
    }

    return {
      status: 'fail',
      message: t('checks.environment.hooksRegistered.failNotRegistered'),
      hint: t('checks.environment.hooksRegistered.hintAddHooks'),
    };
  } catch {
    return {
      status: 'fail',
      message: t('checks.environment.settingsJson.failParse'),
      hint: t('checks.environment.settingsJson.hintFixJson'),
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
      message: t('checks.environment.hookExecutable.failUnavailable'),
      hint: t('checks.environment.hookExecutable.hintNeedSettings'),
    };
  }

  try {
    const content = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const spyglassDir = content.env?.SPYGLASS_DIR;

    if (!spyglassDir) {
      return {
        status: 'warn',
        message: t('checks.environment.hookExecutable.warnNoDir'),
        hint: t('checks.environment.hookExecutable.hintSetDir'),
      };
    }

    const hookScript = `${spyglassDir}/hooks/spyglass-collect.sh`;

    if (!existsSync(hookScript)) {
      return {
        status: 'fail',
        message: t('checks.environment.hookExecutable.failMissing', { path: hookScript }),
        hint: t('checks.environment.hookExecutable.hintCheckPath'),
      };
    }

    const stat = statSync(hookScript);
    const isExecutable = (stat.mode & parseInt('0111', 8)) !== 0;

    if (!isExecutable) {
      return {
        status: 'fail',
        message: t('checks.environment.hookExecutable.failNoPermission', { path: hookScript }),
        hint: t('checks.environment.hookExecutable.hintChmod', { path: hookScript }),
      };
    }

    return {
      status: 'ok',
      message: t('checks.environment.hookExecutable.ok'),
    };
  } catch {
    return {
      status: 'fail',
      message: t('checks.environment.hookExecutable.failCheckFailed'),
      hint: t('checks.environment.hookExecutable.hintCheckFormat'),
    };
  }
}
