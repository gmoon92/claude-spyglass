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

export async function doctor(fix: boolean = false): Promise<void> {
  console.log('\n🔍 spyglass 환경 검증\n');

  const checks = [
    { name: 'Bun 버전', fn: checkBunVersion },
    { name: 'settings.json', fn: checkSettingsJson },
    { name: '훅 등록', fn: checkHooksRegistered },
    { name: '훅 스크립트 권한', fn: checkHookExecutable },
    { name: 'DB 파일 권한', fn: checkDbPermissions },
    { name: 'DB 스키마 버전', fn: checkDbSchemaVersion },
    { name: '서버 포트', fn: checkServerPort },
    { name: '최근 수집 활동', fn: checkRecentActivity },
    // ADR-001 P1: turn 무결성 체크
    { name: 'orphan 행 (turn_id NULL)', fn: checkOrphanRows },
    { name: 'response 0개 turn', fn: checkZeroResponseTurns },
    { name: '120s 초과 proxy 응답', fn: checkLongProxyResponses },
    { name: '중복 response 행', fn: checkDuplicateResponses },
    { name: 'mismatched turn_id', fn: checkMismatchedTurnIds },
    // ADR-001 P1-E (v23): proxy_tool_uses 정확 매칭 도입 후 신규 체크
    { name: 'tool_call api_request_id 매칭', fn: checkUnlinkedToolCalls },
    { name: 'proxy_tool_uses orphan', fn: checkOrphanProxyToolUses },
  ];

  let failCount = 0;
  let warnCount = 0;

  for (const check of checks) {
    const result = check.fn();
    log(result.status, result.message, result.hint);

    if (result.status === 'fail') failCount++;
    if (result.status === 'warn') warnCount++;
  }

  console.log('');

  if (fix) {
    const fixed = applyFixes();
    if (fixed) {
      console.log('');
      log('ok', '자동 수정 완료. 다시 doctor를 실행하세요');
    }
  }

  // 결과 요약
  if (failCount > 0) {
    log(
      'fail',
      `${failCount}개 항목 실패, ${warnCount}개 항목 경고`,
      '위의 힌트를 따라 문제를 해결하세요'
    );
    process.exit(1);
  }

  if (warnCount > 0) {
    log(
      'warn',
      `${warnCount}개 항목 경고`,
      '필요시 위의 힌트를 참고하세요'
    );
  }

  if (failCount === 0 && warnCount === 0) {
    log('ok', '모든 검사 통과!');
  }

  console.log('');
}
