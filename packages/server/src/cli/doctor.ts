/**
 * doctor 커맨드 오케스트레이터 — 체크 목록을 차례로 실행하고 결과 요약.
 *
 * 변경 이유: 체크 목록 추가/제거·요약 정책 변경 시.
 */

import { log } from './output';
import {
  checkBunVersion,
  checkSettingsJson,
  checkHooksRegistered,
  checkHookExecutable,
} from './checks/environment';
import {
  checkDbPermissions,
  checkDbSchemaVersion,
  checkRecentActivity,
} from './checks/database';
import { checkServerPort } from './checks/server';
import {
  checkOrphanRows,
  checkZeroResponseTurns,
  checkLongProxyResponses,
  checkDuplicateResponses,
  checkMismatchedTurnIds,
  checkUnlinkedToolCalls,
  checkOrphanProxyToolUses,
} from './checks/integrity';
import { applyFixes } from './fix';
import { t } from '../i18n';

export async function doctor(fix: boolean = false): Promise<void> {
  console.log(`\n${t('doctor.title')}\n`);

  const checks = [
    checkBunVersion,
    checkSettingsJson,
    checkHooksRegistered,
    checkHookExecutable,
    checkDbPermissions,
    checkDbSchemaVersion,
    checkServerPort,
    checkRecentActivity,
    // ADR-001 P1: turn 무결성 체크
    checkOrphanRows,
    checkZeroResponseTurns,
    checkLongProxyResponses,
    checkDuplicateResponses,
    checkMismatchedTurnIds,
    // ADR-001 P1-E (v23): proxy_tool_uses 정확 매칭 도입 후 신규 체크
    checkUnlinkedToolCalls,
    checkOrphanProxyToolUses,
  ];

  let failCount = 0;
  let warnCount = 0;

  for (const checkFn of checks) {
    const result = checkFn();
    log(result.status, result.message, result.hint);

    if (result.status === 'fail') failCount++;
    if (result.status === 'warn') warnCount++;
  }

  console.log('');

  if (fix) {
    const fixed = applyFixes();
    if (fixed) {
      console.log('');
      log('ok', t('doctor.auto-fix-done'));
    }
  }

  // 결과 요약
  if (failCount > 0) {
    log(
      'fail',
      t('doctor.fail-summary', { fail: failCount, warn: warnCount }),
      t('doctor.fail-hint'),
    );
    process.exit(1);
  }

  if (warnCount > 0) {
    log(
      'warn',
      t('doctor.warn-summary', { warn: warnCount }),
      t('doctor.warn-hint'),
    );
  }

  if (failCount === 0 && warnCount === 0) {
    log('ok', t('doctor.all-pass'));
  }

  console.log('');
}
