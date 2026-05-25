/**
 * main.js — Electron 메인 프로세스 진입점 (spyglass 데스크톱).
 *
 * @description
 *   웹 대시보드(`packages/web`)를 그대로 띄우는 macOS 데스크톱 셸.
 *   기능 추가 없이 마이그레이션만 수행한다.
 *
 * 책임:
 *   1) Bun spyglass 서버 준비 보장 (server-process.ensureServer).
 *   2) 보안 베스트 프랙티스를 적용한 BrowserWindow 생성 — contextIsolation/sandbox/noNodeIntegration.
 *   3) macOS 네이티브 라이프사이클 처리 — window-all-closed(non-quit), activate(re-open), before-quit(graceful).
 *   4) 외부 origin 이동/팝업 차단 (보안).
 *
 * 의존성:
 *   - electron 42.x
 *   - ./server-process.js  — Bun 서버 attach/spawn
 *   - ./menu.js            — macOS 메뉴바
 *   - ../preload/preload.js — Renderer 격리 통신 통로 (현재 노출 API 0개)
 *
 * 호출 흐름:
 *   electron .   →   app.whenReady()
 *                      → buildAppMenu()
 *                      → ensureServer()  (attach or spawn)
 *                      → createMainWindow()  → loadURL(http://127.0.0.1:9999)
 *   app.on('window-all-closed')  → macOS 외에서만 quit
 *   app.on('activate')           → 창 0개면 재생성
 *   app.on('before-quit')        → shutdownServer (spawned 모드만)
 */

import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureServer, shutdownServer } from './server-process.js';
import { buildAppMenu } from './menu.js';
import { checkForUpdates } from './auto-updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 9999;
const DEFAULT_HOST = '127.0.0.1';

let mainWindow = null;
let serverOrigin = null;

/**
 * 보안 기본값으로 단일 BrowserWindow 를 생성한다.
 * @returns {BrowserWindow}
 */
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1a1a1a', // favicon 다크 배경과 정합 — 초기 white flash 방지.
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    },
  });

  // 외부 origin 으로의 이동 차단 — 로컬 spyglass origin 만 허용.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(serverOrigin)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  // 팝업/window.open 차단 → 시스템 브라우저로 위임 (보안 + UX).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(serverOrigin)) {
      return { action: 'allow' };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

/**
 * 사용자에게 서버 기동 실패를 표시하는 최소 에러 창.
 * 별도 다이얼로그 모듈 없이 BrowserWindow + data: URL 로 처리한다.
 */
function showStartupError(message) {
  const win = new BrowserWindow({
    width: 560,
    height: 320,
    backgroundColor: '#1a1a1a',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const html = `
    <html><head><meta charset="utf-8"><title>spyglass</title>
    <style>
      body{background:#1a1a1a;color:#f0ede8;font-family:-apple-system,Segoe UI,sans-serif;padding:32px;margin:0;}
      h1{color:#d97757;font-size:18px;margin:0 0 12px;}
      pre{white-space:pre-wrap;font-size:12px;color:#a0a0a0;background:#0d0d0d;padding:12px;border-radius:6px;}
    </style></head>
    <body>
      <h1>spyglass server failed to start</h1>
      <pre>${String(message).replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>
    </body></html>
  `;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

app.whenReady().then(async () => {
  buildAppMenu();

  try {
    const port = parseInt(process.env.SPGLASS_PORT || `${DEFAULT_PORT}`, 10);
    const host = process.env.SPGLASS_HOST || DEFAULT_HOST;
    const result = await ensureServer({ port, host });
    serverOrigin = `http://${result.host}:${result.port}`;

    mainWindow = createMainWindow();
    await mainWindow.loadURL(serverOrigin);

    // 사일런트 업데이트 체크 — 새 버전 발견 시에만 dialog. 네트워크/비교 실패는 침묵.
    // BrowserWindow 표시 후에 호출해 사용자 첫 페인트를 막지 않는다. 실패는 흐름에 무관.
    checkForUpdates({ silent: true }).catch(() => {});
  } catch (err) {
    showStartupError(err?.stack || err?.message || String(err));
  }
});

// macOS: 모든 창이 닫혀도 앱은 dock 에 살아있는 게 표준 (Cmd+Q 로만 종료).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// macOS: dock 아이콘 클릭 시 창이 없으면 재생성.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverOrigin) {
    mainWindow = createMainWindow();
    mainWindow.loadURL(serverOrigin);
  }
});

// graceful shutdown — spawned 모드일 때만 Bun child SIGTERM.
let shuttingDown = false;
app.on('before-quit', async (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();
  try {
    await shutdownServer();
  } finally {
    app.exit(0);
  }
});

// 다중 인스턴스 방지 — 두 번째 인스턴스는 첫 번째를 활성화하고 자기 자신 종료.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
