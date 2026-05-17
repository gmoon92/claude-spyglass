/**
 * 서버 체크 — 포트 가용성.
 *
 * 변경 이유: 서버 포트·바인딩 정책 변경 시.
 */

import type { CheckResult } from '../output';
import { t } from '../../i18n';

/**
 * 7. 서버 포트 (3000) 가용성 확인
 */
export function checkServerPort(): CheckResult {
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
      message: t('checks.server.port.ok', { port }),
    };
  } catch {
    return {
      status: 'warn',
      message: t('checks.server.port.warn', { port }),
      hint: t('checks.server.port.hint', { port }),
    };
  }
}
