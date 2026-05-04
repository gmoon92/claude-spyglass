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
 * 포트를 점유한 프로세스 ID 목록 찾기
 */
export function findProcessesByPort(port: number): number[] {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
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
