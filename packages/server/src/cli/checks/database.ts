/**
 * DB 체크 — 권한·스키마 버전·최근 수집 활동.
 *
 * 변경 이유: DB 권한 정책·스키마 버전 임계값·활동 윈도우 정책 변경 시 묶여서 손이 가는 묶음.
 */

import { existsSync, statSync } from 'fs';
import { getDatabase, getDefaultDbPath, closeDatabase } from '@spyglass/storage';
import type { CheckResult } from '../output';
import { t } from '../../i18n';

/**
 * 5. DB 파일 권한 확인 (0o600 권장)
 */
export function checkDbPermissions(): CheckResult {
  const dbPath = getDefaultDbPath();

  if (!existsSync(dbPath)) {
    return {
      status: 'warn',
      message: t('checks.database.permissions.warn-no-db'),
      hint: t('checks.database.permissions.hint-auto-create'),
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
        message: t('checks.database.permissions.warn', { perms: octalPerms }),
        hint: t('checks.database.permissions.hint-chmod', { path: dbPath }),
      };
    }

    return {
      status: 'ok',
      message: t('checks.database.permissions.ok', { perms: octalPerms }),
    };
  } catch {
    return {
      status: 'fail',
      message: t('checks.database.permissions.fail'),
      hint: t('checks.database.permissions.hint-corrupted'),
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
      message: t('checks.database.schema-version.warn-no-db'),
      hint: t('checks.database.schema-version.hint-auto-create'),
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
        message: t('checks.database.schema-version.warn-unknown'),
        hint: t('checks.database.schema-version.hint-corrupted'),
      };
    }

    if (version < 12) {
      return {
        status: 'warn',
        message: t('checks.database.schema-version.warn-old', { version }),
        hint: t('checks.database.schema-version.hint-migrate'),
      };
    }

    return {
      status: 'ok',
      message: t('checks.database.schema-version.ok', { version }),
    };
  } catch {
    return {
      status: 'warn',
      message: t('checks.database.schema-version.warn-check-failed'),
      hint: t('checks.database.schema-version.hint-corrupted'),
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
      message: t('checks.database.recent-activity.warn-unavailable'),
      hint: t('checks.database.recent-activity.hint-auto-create'),
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
        message: t('checks.database.recent-activity.ok'),
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
          message: t('checks.database.recent-activity.warn', { minutes: minutesAgo }),
          hint: t('checks.database.recent-activity.hint-run'),
        };
      }
    } catch {
      // ignore
    }

    return {
      status: 'warn',
      message: t('checks.database.recent-activity.warn-no-data'),
      hint: t('checks.database.recent-activity.hint-run'),
    };
  } catch {
    return {
      status: 'warn',
      message: t('checks.database.recent-activity.warn-error'),
      hint: t('checks.database.recent-activity.hint-corrupted'),
    };
  }
}
