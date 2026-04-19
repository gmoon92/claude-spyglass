/**
 * spyglass CLI
 *
 * @description 환경 검증 및 진단 도구
 * @usage
 *   bun run packages/server/src/cli.ts doctor
 *   bun run packages/server/src/cli.ts doctor --fix
 */

import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { readFileSync } from 'fs';
import { getDatabase, getDefaultDbPath, closeDatabase } from '@spyglass/storage';
import type { DatabaseStatus } from '@spyglass/storage';

// =============================================================================
// 색상 및 심볼
// =============================================================================

const COLOR_GREEN = '\x1b[32m';
const COLOR_RED = '\x1b[31m';
const COLOR_YELLOW = '\x1b[33m';
const COLOR_RESET = '\x1b[0m';

const CHECK = '✓';
const CROSS = '✗';
const WARN = '⚠';

// =============================================================================
// 타입 정의
// =============================================================================

interface CheckResult {
  status: 'ok' | 'fail' | 'warn';
  message: string;
  hint?: string;
}

// =============================================================================
// 출력 함수
// =============================================================================

function log(status: CheckResult['status'], message: string, hint?: string) {
  let symbol = '';
  let color = '';

  switch (status) {
    case 'ok':
      symbol = CHECK;
      color = COLOR_GREEN;
      break;
    case 'fail':
      symbol = CROSS;
      color = COLOR_RED;
      break;
    case 'warn':
      symbol = WARN;
      color = COLOR_YELLOW;
      break;
  }

  console.log(`${color}${symbol}${COLOR_RESET} ${message}`);
  if (hint) {
    console.log(`  → ${hint}`);
  }
}

// =============================================================================
// 체크 함수
// =============================================================================

/**
 * 1. Bun 버전 확인 (≥ 1.0)
 */
function checkBunVersion(): CheckResult {
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
function checkSettingsJson(): CheckResult {
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
function checkHooksRegistered(): CheckResult {
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
function checkHookExecutable(): CheckResult {
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

/**
 * 5. DB 파일 권한 확인 (0o600 권장)
 */
function checkDbPermissions(): CheckResult {
  const dbPath = getDefaultDbPath();

  if (!existsSync(dbPath)) {
    return {
      status: 'warn',
      message: 'DB 파일이 아직 없습니다',
      hint: '서버를 실행하면 자동으로 생성됩니다',
    };
  }

  try {
    const stat = statSync(dbPath);
    const octalPerms = ((stat.mode & parseInt('0777', 8)) >>> 0).toString(8);

    // 0o600 (rw-------)인지 확인
    if (stat.mode & 0o077) {
      // 다른 사용자에게 권한이 있음
      return {
        status: 'warn',
        message: `DB 권한: ${octalPerms} (권장: 600)`,
        hint: `chmod 600 ${dbPath}`,
      };
    }

    return {
      status: 'ok',
      message: `DB 권한: ${octalPerms}`,
    };
  } catch {
    return {
      status: 'fail',
      message: 'DB 파일 권한 확인 실패',
      hint: 'DB 파일이 손상되었을 수 있습니다',
    };
  }
}

/**
 * 6. DB 스키마 버전 확인 (≥ 12)
 */
function checkDbSchemaVersion(): CheckResult {
  if (!existsSync(getDefaultDbPath())) {
    return {
      status: 'warn',
      message: 'DB 파일이 없어 스키마 버전 확인 불가',
      hint: '서버를 실행하면 자동으로 생성됩니다',
    };
  }

  try {
    const db = getDatabase();
    const result = db.instance.prepare('PRAGMA user_version').all();
    const version = (result[0] as any)?.user_version || 0;
    closeDatabase();

    if (version === 0) {
      return {
        status: 'warn',
        message: 'DB 스키마 버전을 알 수 없음 (v0)',
        hint: 'DB가 초기화되지 않았을 수 있습니다',
      };
    }

    if (version < 12) {
      return {
        status: 'warn',
        message: `DB 스키마 v${version} (권장: v12+)`,
        hint: 'Track 1 마이그레이션이 아직 완료되지 않았거나, DB를 초기화하세요',
      };
    }

    return {
      status: 'ok',
      message: `DB 스키마 v${version}`,
    };
  } catch {
    return {
      status: 'warn',
      message: 'DB 스키마 버전 확인 실패',
      hint: 'DB 파일이 손상되었을 수 있습니다',
    };
  }
}

/**
 * 7. 서버 포트 (3000) 가용성 확인
 */
function checkServerPort(): CheckResult {
  const port = 3000; // 기본 포트

  try {
    const testServer = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: () => new Response('test'),
    });
    testServer.stop();

    return {
      status: 'ok',
      message: `포트 ${port} 가용`,
    };
  } catch {
    return {
      status: 'warn',
      message: `포트 ${port} 사용 중`,
      hint: `다른 프로세스가 포트를 사용 중입니다. lsof -i :${port}로 확인하세요`,
    };
  }
}

/**
 * 8. 최근 수집 활동 확인 (5분 내)
 */
function checkRecentActivity(): CheckResult {
  if (!existsSync(getDefaultDbPath())) {
    return {
      status: 'warn',
      message: '최근 수집 활동 확인 불가 (DB 없음)',
      hint: '서버를 실행하고 Claude Code에서 명령을 실행하세요',
    };
  }

  try {
    const db = getDatabase();
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;

    const result = db.instance.prepare(`
      SELECT timestamp FROM requests
      WHERE timestamp > ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).all(fiveMinutesAgo);

    closeDatabase();

    if (result.length > 0) {
      return {
        status: 'ok',
        message: '최근 5분 내 수집 활동 있음',
      };
    }

    // 최근 수집 시간 조회
    try {
      const db2 = getDatabase();
      const lastResult = db2.instance.prepare(`
        SELECT timestamp FROM requests
        ORDER BY timestamp DESC
        LIMIT 1
      `).all();
      closeDatabase();

      if (lastResult.length > 0) {
        const lastTimestamp = (lastResult[0] as any).timestamp;
        const minutesAgo = Math.floor((Date.now() / 1000 - lastTimestamp) / 60);
        return {
          status: 'warn',
          message: `최근 수집: ${minutesAgo}분 전`,
          hint: 'Claude Code를 실행하고 bun run dev를 실행하세요',
        };
      }
    } catch {
      // ignore
    }

    return {
      status: 'warn',
      message: '수집된 데이터 없음',
      hint: 'Claude Code를 실행하고 bun run dev를 실행하세요',
    };
  } catch {
    return {
      status: 'warn',
      message: '수집 활동 확인 중 오류 발생',
      hint: 'DB가 손상되었을 수 있습니다',
    };
  }
}

// =============================================================================
// 자동 수정 함수
// =============================================================================

/**
 * --fix 플래그로 chmod 등 자동 수정
 */
function applyFixes() {
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

// =============================================================================
// Doctor 커맨드
// =============================================================================

async function doctor(fix: boolean = false) {
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

// =============================================================================
// 메인 엔트리포인트
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const hasFixFlag = args.includes('--fix');

  if (command === 'doctor') {
    await doctor(hasFixFlag);
  } else {
    console.error('사용법: bun run packages/server/src/cli.ts doctor [--fix]');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('오류:', err.message);
  process.exit(1);
});
