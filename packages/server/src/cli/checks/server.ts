/**
 * 서버 체크 — 포트 가용성.
 *
 * 변경 이유: 서버 포트·바인딩 정책 변경 시.
 */

import type { CheckResult } from '../output';

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
