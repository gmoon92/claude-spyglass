/**
 * menu.js — macOS 네이티브 메뉴바 정의.
 *
 * 책임:
 *   - macOS HIG 를 따르는 표준 메뉴 구조(App / Edit / View / Window / Help)를 만든다.
 *   - 기능 추가는 하지 않는다 (마이그레이션 범위) — Electron 기본 role 들로만 구성.
 *
 * 의존성: electron.Menu, electron.app
 * 호출 흐름: main.js → buildAppMenu() → Menu.setApplicationMenu()
 */

import { Menu, app, shell } from 'electron';
import { checkForUpdates } from './auto-updater.js';

/**
 * macOS 표준 메뉴를 빌드해서 활성화한다. macOS 외 플랫폼에서는 메뉴 자체를 비활성(null)으로 둔다.
 */
export function buildAppMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          // 명시 체크 — 최신 버전이어도 "최신입니다" 알림으로 사용자에게 결과를 확실히 전달.
          label: 'Check for Updates…',
          click: () => { checkForUpdates({ silent: false }).catch(() => {}); },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'spyglass GitHub',
          click: async () => {
            await shell.openExternal('https://github.com/');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
