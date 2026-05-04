/**
 * DB 체크 — 권한·스키마 버전·최근 수집 활동.
 *
 * 변경 이유: DB 권한 정책·스키마 버전 임계값·활동 윈도우 정책 변경 시 묶여서 손이 가는 묶음.
 */

import { existsSync, statSync } from 'fs';
import { getDatabase, getDefaultDbPath, closeDatabase } from '@spyglass/storage';
import type { CheckResult } from '../output';

/**
 * 5. DB 파일 권한 확인 (0o600 권장)
 */
export function checkDbPermissions(): CheckResult {
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
export function checkDbSchemaVersion(): CheckResult {
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
 * 8. 최근 수집 활동 확인 (5분 내)
 */
export function checkRecentActivity(): CheckResult {
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
