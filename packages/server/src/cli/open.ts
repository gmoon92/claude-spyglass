/**
 * cli/open.ts — `spyglass open` 명령.
 *
 * 책임:
 *   - 로컬 spyglass 데몬의 health 를 확인하고 대시보드를 시스템 브라우저로 연다.
 *   - 미실행 시 actionable guidance 출력 (interactive prompt 금지).
 *
 * 의존성:
 *   - runtime/config 의 PORT/HOST (env 변경을 그대로 따른다)
 *   - macOS `open`, Linux `xdg-open`, Windows `cmd /c start` 분기로 외부 브라우저 호출
 *
 * 호출 흐름:
 *   daemon.ts dispatchDaemonCommand('open')
 *     → openCommand()
 *         → waitForServer() — 1초 timeout × 5회 (200ms 간격) retry
 *             ├─ 200 OK   → openBrowser → Case A 또는 Case D
 *             └─ 모두 fail → Case B 안내 (exit 1)
 *
 * 비범위:
 *   - daemon 자동 시작, interactive prompt, lifecycle 추론.
 *   - update banner / OS notification.
 */

import { spawn } from 'node:child_process';
import { PORT, HOST } from '../runtime/config';

const FETCH_TIMEOUT_MS = 1000;
const RETRY_INTERVAL_MS = 200;
// 5회(=1s)는 정상 Apple Silicon 에선 충분하나, 첫 부팅 시 ~/.spyglass/spyglass.db 생성 +
// 42 migrations 적용이 느린 디스크에서 1초를 초과할 수 있다. 15회(=3s)로 cold-start buffer 확보.
//   정상 시나리오는 첫 probe 에서 성공 → 사용자 체감 영향 없음.
const MAX_RETRIES = 15;

/** /health 단발 호출 — 1초 안에 200 응답이 없으면 false. */
async function probeHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`http://${HOST}:${PORT}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * `spyglass start && spyglass open` 흐름에서 detached child 가 listen 시작하기 전에
 * open 이 도달하는 startup race 대응 — 200ms × 5회 retry 로 ~1초까지 기다린다.
 */
async function waitForServer(): Promise<boolean> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (await probeHealth()) return true;
    if (i < MAX_RETRIES - 1) {
      if (i === 0) process.stdout.write('[Open] Waiting for spyglass...\n');
      await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
    }
  }
  return false;
}

/** OS 별 시스템 브라우저로 URL open. spawn detached + unref 하여 부모 즉시 종료 가능. */
function openBrowser(url: string): boolean {
  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32'  ? 'cmd'  :
    'xdg-open';
  const args =
    process.platform === 'win32' ? ['/c', 'start', '', url] :
    [url];

  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * `spyglass open` 진입점.
 *
 * 출력 정책:
 *   - Case A (서버 실행 중)   : "[Open] Opened <url>"           exit 0
 *   - Case B (서버 미실행)    : actionable guidance              exit 1
 *   - Case C (startup race)   : "[Open] Waiting..." 1회 + 위 처리
 *   - Case D (브라우저 실패)  : URL 출력 fallback                exit 0
 */
export async function openCommand(): Promise<void> {
  const url = `http://${HOST}:${PORT}`;
  const ready = await waitForServer();

  if (!ready) {
    console.log('[Open] spyglass is not running.');
    console.log('');
    console.log('To start:');
    console.log('  brew services start spyglass');
    console.log('  spyglass start');
    process.exit(1);
  }

  if (openBrowser(url)) {
    console.log(`[Open] Opened ${url}`);
    return;
  }
  console.log('[Open] spyglass is running, but browser open failed.');
  console.log(`[Open] Dashboard: ${url}`);
}
