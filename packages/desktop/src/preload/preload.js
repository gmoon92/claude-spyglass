/**
 * preload.js — Renderer 격리 통신 통로 (security bridge).
 *
 * @description
 *   contextIsolation:true + sandbox:true + nodeIntegration:false 환경에서
 *   메인 프로세스 ↔ 렌더러 사이의 안전한 통신 통로를 정의한다.
 *
 *   기능 추가 없이 그대로 마이그레이션이 이번 작업 범위이므로,
 *   노출 API 는 의도적으로 비어 있다 (`window.electronAPI = {}`).
 *   향후 네이티브 기능을 추가할 때 이 파일이 단일 진입점이 된다.
 *
 * 책임:
 *   - `window.electronAPI` 객체를 contextBridge 를 통해 안전하게 노출한다.
 *   - 어떠한 Node.js / Electron 내부 객체도 렌더러로 직접 흘리지 않는다.
 *
 * 의존성: electron.contextBridge (sandbox 환경에서만 사용 가능한 화이트리스트 API)
 *
 * 호출 흐름:
 *   BrowserWindow webPreferences.preload  →  이 파일이 렌더러 로딩 직전 실행
 *     →  contextBridge.exposeInMainWorld('electronAPI', {})
 *     →  렌더러(packages/web) 에서 `window.electronAPI` 로 접근 가능
 *
 * 보안 원칙:
 *   - ipcRenderer 를 그대로 노출하지 않는다.
 *   - 추가 메서드를 정의할 때는 인자 검증 + 화이트리스트 채널만 허용한다.
 *   - 새 메서드 추가 시 main.js 측 ipcMain.handle 핸들러도 같은 파일에서 같이 추가한다.
 */

import { contextBridge } from 'electron';

// 노출 API — 현재는 마이그레이션 범위라 빈 객체. 향후 확장 시 이 객체에 메서드를 추가한다.
contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  // 예시 (현재 비활성):
  //   notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  //   openExternal: (url) => ipcRenderer.invoke('open-external', url),
}));
