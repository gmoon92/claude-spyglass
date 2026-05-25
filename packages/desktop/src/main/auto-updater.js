/**
 * auto-updater.js — 반자동 GitHub Releases 기반 업데이트 알림.
 *
 * @description
 *   electron-updater 는 macOS 에서 Apple Developer ID 코드 서명이 필수다.
 *   서명을 적용하지 않은 현 상태에서는 무료로 동작하는 반자동 방식을 채택:
 *
 *     1) GitHub Releases API 로 latest tag 조회.
 *     2) 현재 `app.getVersion()` 과 시맨틱 버전 비교.
 *     3) 새 버전이면 native dialog 알림.
 *     4) "다운로드 페이지 열기" 클릭 시 외부 브라우저로 release 페이지 이동.
 *     5) 사용자가 DMG 를 직접 받아 기존 앱을 덮어씌우는 것으로 업데이트 완료.
 *
 *   "백그라운드 다운로드 + 재시작 시 자동 적용" 은 electron-updater + 코드 서명이
 *   필요하므로 본 모듈 범위 밖이다.
 *
 * 책임:
 *   - `checkForUpdates({ silent })` 단일 진입점.
 *   - 네트워크 실패 / 비교 실패 / 최신 / 새 버전 4분기 처리.
 *   - "이 버전 건너뛰기" 메모리 기록 (앱 세션 동안만 — 재시작 시 초기화).
 *
 * 의존성:
 *   - electron.app          : `app.getVersion()` 현재 버전.
 *   - electron.dialog       : native message box.
 *   - electron.shell        : 외부 브라우저 호출.
 *   - global fetch (Node18+/Electron 28+ 내장).
 *
 * 호출 흐름:
 *   main.js (BrowserWindow ready 직후)
 *     → checkForUpdates({ silent: true })   — 사일런트: 최신/실패 시 dialog 없음.
 *   menu.js  Help > "Check for Updates…"
 *     → checkForUpdates({ silent: false })  — 명시 체크: 모든 결과를 dialog 로 표시.
 *
 * 비범위:
 *   - 주기적 폴링은 도입하지 않는다 (시작 시 1회 + 메뉴 클릭 시 즉시).
 *   - 자동 다운로드, code-sign 검증, delta update.
 */

import { app, dialog, shell } from 'electron';

const REPO_OWNER = 'gmoon92';
const REPO_NAME = 'claude-spyglass';
const RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const FETCH_TIMEOUT_MS = 5000;

// 사용자가 "이 버전 건너뛰기" 로 선택한 태그 — 메모리에만 유지 (재시작 시 초기화).
const skippedVersions = new Set();

/**
 * 'v2.9.0', 'V 2.9.0 ', '2.9.0' 등을 '2.9.0' 으로 정규화한다.
 * 비교/표시 양쪽에서 사용 — packages/web/assets/js/version-check.js 의 normalizeTag 와 동일 규칙.
 */
function normalizeTag(s) {
  if (typeof s !== 'string') return '';
  return s.trim().replace(/^[vV]/, '');
}

/**
 * '2.9.0' → [2, 9, 0]. pre-release 접미사(`-rc.1` 등)는 제거 후 비교.
 * 형식이 안 맞으면 null.
 */
function parseSemver(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(normalizeTag(s));
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * @returns {-1 | 0 | 1 | null} -1 = a<b, 0 = 같음, 1 = a>b, null = 비교 불가.
 */
function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * GitHub Releases API 의 latest release 조회. 5초 안에 200 응답이 없으면 null.
 * @returns {Promise<{tag_name: string, html_url: string, body: string} | null>}
 */
async function fetchLatestRelease() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 새 버전 발견 시 사용자에게 알림 다이얼로그를 띄운다.
 * 사용자 선택:
 *   - 0 "다운로드 페이지 열기"  → shell.openExternal(release.html_url)
 *   - 1 "이 버전 건너뛰기"     → skippedVersions 에 기록 (세션 한정)
 *   - 2 "나중에"               → no-op
 */
async function showUpdateDialog(release) {
  const current = app.getVersion();
  const latest = normalizeTag(release.tag_name);
  // body 가 매우 길 수 있어 다이얼로그 가독성을 위해 500자로 절단.
  const notes = (release.body || '').slice(0, 500);

  const result = await dialog.showMessageBox({
    type: 'info',
    title: '새 버전이 있습니다',
    message: `Claude Spyglass v${latest} 가 출시되었습니다.`,
    detail:
      `현재 버전: v${current}\n` +
      `최신 버전: v${latest}\n\n` +
      (notes ? '변경사항:\n' + notes : ''),
    buttons: ['다운로드 페이지 열기', '이 버전 건너뛰기', '나중에'],
    defaultId: 0,
    cancelId: 2,
  });

  if (result.response === 0) {
    await shell.openExternal(release.html_url).catch(() => {});
  } else if (result.response === 1) {
    skippedVersions.add(latest);
  }
}

/**
 * 명시 체크(메뉴) 시에만 사용 — 사일런트 호출에서는 표시하지 않는다.
 */
async function showLatestDialog() {
  await dialog.showMessageBox({
    type: 'info',
    title: '최신 버전입니다',
    message: `Claude Spyglass v${app.getVersion()} 는 최신 버전입니다.`,
    buttons: ['확인'],
  });
}

async function showNetworkErrorDialog() {
  await dialog.showMessageBox({
    type: 'warning',
    title: '업데이트 확인 실패',
    message: '네트워크 오류로 최신 버전을 확인하지 못했습니다.',
    detail: '잠시 후 다시 시도해주세요.',
    buttons: ['확인'],
  });
}

/**
 * 업데이트 체크 entry point.
 *
 * @param {{ silent?: boolean }} [opts]
 *   - silent === true  : 새 버전이 없거나 네트워크 실패면 dialog 표시 안 함 (시작 시 자동 체크).
 *   - silent === false : 모든 결과(최신/실패/새 버전)를 dialog 로 알림 (메뉴 클릭).
 * @returns {Promise<void>}
 */
export async function checkForUpdates(opts = {}) {
  const silent = opts.silent !== false;

  const release = await fetchLatestRelease();
  if (!release) {
    if (!silent) await showNetworkErrorDialog();
    return;
  }

  const cmp = compareSemver(app.getVersion(), release.tag_name);
  if (cmp === null) {
    if (!silent) {
      await dialog.showMessageBox({
        type: 'warning',
        title: '버전 비교 실패',
        message: '버전 정보를 해석할 수 없습니다.',
        detail: `현재: ${app.getVersion()}, 최신 tag: ${release.tag_name}`,
        buttons: ['확인'],
      });
    }
    return;
  }

  // 현재 == 최신 또는 현재 > 최신(개발 빌드 등) → 새 버전 아님.
  if (cmp >= 0) {
    if (!silent) await showLatestDialog();
    return;
  }

  // cmp < 0: 새 버전 발견. 사일런트 호출 중 사용자가 이미 skip 한 버전이면 침묵.
  const latest = normalizeTag(release.tag_name);
  if (silent && skippedVersions.has(latest)) return;

  await showUpdateDialog(release);
}
