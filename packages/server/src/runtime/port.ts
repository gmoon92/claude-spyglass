/**
 * 포트/프로세스 유틸리티 — 가용성 확인, lsof 기반 PID 탐색, 종료 대기.
 *
 * 변경 이유: 포트 점유 처리 정책(lsof/SIGTERM/SIGKILL/대기 시간) 변경 시 묶여서 손이 가는 묶음.
 */

import { HOST } from './config';

/**
 * 포트 사용 가능 여부 확인 (테스트 서버로 검증)
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const testServer = Bun.serve({
      port,
      hostname: HOST,
      fetch: () => new Response("test"),
    });
    testServer.stop();
    return true;
  } catch {
    return false;
  }
}

/**
 * 포트를 LISTEN 중인 프로세스 ID 목록 찾기.
 *
 * `-sTCP:LISTEN` 필터가 없으면 lsof는 해당 포트로 ESTABLISHED 연결을 가진
 * 클라이언트 PID까지 함께 돌려준다. spyglass 프록시 특성상 Claude Code·TUI 등
 * 클라이언트가 항상 붙어 있기 때문에, 필터 없이 결과를 kill 대상으로 쓰면
 * 서버뿐 아니라 작업 중인 Claude Code 세션까지 SIGTERM/SIGKILL 당하는 사고가 발생한다.
 * LISTEN 상태 프로세스만 골라 서버 한 명만 종료시킨다.
 */
export function findProcessesByPort(port: number): number[] {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf-8' }).trim();
    return out ? out.split('\n').map(Number).filter((n: number) => !isNaN(n) && n > 0) : [];
  } catch {
    return [];
  }
}

/**
 * 프로세스가 완전히 종료될 때까지 대기
 */
export async function waitForProcessExit(pid: number, timeoutMs: number = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * 포트 해제 대기 (OS 레벨 TIME_WAIT 등)
 */
export async function waitForPortRelease(port: number, timeoutMs: number = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortAvailable(port)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}
