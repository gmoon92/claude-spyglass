/**
 * logic.test.ts — 진단/Hook 상태 결정 순수함수 검증 (P2-06, TDD Red→Green)
 *
 * 원본: settings-view.js 인라인 분기. 각 케이스는 원본 파일:라인 근거를 동반(추측 없음).
 * 회귀 위험 5종 중 §4.2 라디오 유효성·상태 라벨 분기를 직접 커버.
 */
import { describe, it, expect } from 'vitest';
import {
  versionRowStatus,
  isCommentHint,
  diagHookRowStatus,
  hookHealthState,
  hookHealthBadgeVariant,
  hookHealthIcon,
  showProfilePicker,
  isValidHookProfile,
  canUndo,
  graphHealthState,
  graphHealthIcon,
  isValidGraphMode,
  graphSourceKey,
  proxyHealthState,
  proxyHealthBadgeVariant,
  proxyHealthIcon,
  isValidProxyShell,
  snippetShell,
  isInstallSuccess,
} from '../logic';
import type { GraphData, HookData, ProxyStatus, VersionInfo } from '../types';

function graph(p: Partial<GraphData>): GraphData {
  return {
    mode: 'primary',
    source: 'file',
    configFile: '/cfg',
    circuit: { state: 'CLOSED', consecutiveFailures: 0, fallbackRate: 0 },
    sync: { running: true, cursor: 0 },
    cacheDir: '/cache',
    cacheSizeBytes: 0,
    ...p,
  };
}

function proxy(p: Partial<ProxyStatus>): ProxyStatus {
  return {
    shell: 'zsh',
    profilePath: '/h/.zshrc',
    profileExisted: true,
    installed: false,
    corrupted: false,
    hasMarkerOpen: false,
    hasMarkerClose: false,
    ...p,
  };
}

function ver(available: boolean, installHint = ''): VersionInfo {
  return { name: 'x', available, version: available ? '1.0.0' : null, raw: null, installHint };
}

function hooks(p: Partial<HookData>): HookData {
  return {
    path: '/x/.claude/settings.json',
    exists: true,
    parsed: true,
    spyglassDir: '/spy',
    events: [],
    registeredCount: 10,
    expectedCount: 10,
    fileSize: 100,
    ...p,
  };
}

describe('versionRowStatus (settings-view.js:204)', () => {
  it('available → ok', () => expect(versionRowStatus(ver(true))).toBe('ok'));
  it('미설치 → warn', () => expect(versionRowStatus(ver(false))).toBe('warn'));
});

describe('isCommentHint (settings-view.js:209)', () => {
  it('# 시작 안내문 → true(복사버튼 생략)', () => {
    expect(isCommentHint('# brew install jq')).toBe(true);
    expect(isCommentHint('  # leading space comment')).toBe(true);
  });
  it('실제 명령 → false(복사버튼 노출)', () => {
    expect(isCommentHint('curl -fsSL https://bun.sh/install | bash')).toBe(false);
  });
});

describe('diagHookRowStatus (settings-view.js:219-227)', () => {
  it('미존재 → warn', () => expect(diagHookRowStatus(hooks({ exists: false }))).toBe('warn'));
  it('존재+파싱실패 → fail', () => expect(diagHookRowStatus(hooks({ parsed: false }))).toBe('fail'));
  it('등록=기대 → ok', () =>
    expect(diagHookRowStatus(hooks({ registeredCount: 10, expectedCount: 10 }))).toBe('ok'));
  it('부분 등록 → warn', () =>
    expect(diagHookRowStatus(hooks({ registeredCount: 4, expectedCount: 10 }))).toBe('warn'));
  it('0 등록 → warn', () =>
    expect(diagHookRowStatus(hooks({ registeredCount: 0, expectedCount: 10 }))).toBe('warn'));
});

describe('hookHealthState (settings-view.js:409-413)', () => {
  it('미존재 → missing', () => expect(hookHealthState(hooks({ exists: false }))).toBe('missing'));
  it('파싱실패 → broken', () => expect(hookHealthState(hooks({ parsed: false }))).toBe('broken'));
  it('등록=기대 + spyglassDir → ok', () =>
    expect(hookHealthState(hooks({ registeredCount: 10, expectedCount: 10, spyglassDir: '/spy' }))).toBe('ok'));
  it('등록=기대 but spyglassDir 누락 → warn', () =>
    expect(hookHealthState(hooks({ registeredCount: 10, expectedCount: 10, spyglassDir: null }))).toBe('warn'));
  it('부분 등록 → warn', () =>
    expect(hookHealthState(hooks({ registeredCount: 4, expectedCount: 10 }))).toBe('warn'));
});

describe('hookHealthBadgeVariant (settings-view.js:476)', () => {
  it('ok → ok', () => expect(hookHealthBadgeVariant('ok')).toBe('ok'));
  it('broken → warn(시각 톤 공유)', () => expect(hookHealthBadgeVariant('broken')).toBe('warn'));
  it('missing → warn', () => expect(hookHealthBadgeVariant('missing')).toBe('warn'));
  it('warn → warn', () => expect(hookHealthBadgeVariant('warn')).toBe('warn'));
});

describe('hookHealthIcon (settings-view.js:414)', () => {
  it('ok → ✓', () => expect(hookHealthIcon('ok')).toBe('✓'));
  it('broken → ✕', () => expect(hookHealthIcon('broken')).toBe('✕'));
  it('missing → ⚠', () => expect(hookHealthIcon('missing')).toBe('⚠'));
  it('warn → ⚠', () => expect(hookHealthIcon('warn')).toBe('⚠'));
});

describe('showProfilePicker (settings-view.js:425)', () => {
  it('ok → 숨김(false)', () => expect(showProfilePicker('ok')).toBe(false));
  it('warn → 노출(true)', () => expect(showProfilePicker('warn')).toBe(true));
  it('missing → 노출(true)', () => expect(showProfilePicker('missing')).toBe(true));
  it('broken → 노출(true)', () => expect(showProfilePicker('broken')).toBe(true));
});

describe('isValidHookProfile (settings-view.js:504)', () => {
  it('full/minimal 만 허용', () => {
    expect(isValidHookProfile('full')).toBe(true);
    expect(isValidHookProfile('minimal')).toBe(true);
  });
  it('그 외 거부(타입가드)', () => {
    expect(isValidHookProfile('off')).toBe(false);
    expect(isValidHookProfile('')).toBe(false);
    expect(isValidHookProfile('FULL')).toBe(false);
  });
});

describe('canUndo (settings-view.js:614,660)', () => {
  it('실제 백업 경로 → true', () => expect(canUndo('/x/.claude/settings.json.bak.123')).toBe(true));
  it('"(none — 첫 설치)" placeholder → false', () =>
    expect(canUndo('(none — 첫 설치)')).toBe(false));
  it('null/undefined/빈 → false', () => {
    expect(canUndo(null)).toBe(false);
    expect(canUndo(undefined)).toBe(false);
    expect(canUndo('')).toBe(false);
  });
});

// ── Graph DB (P2-07) ──────────────────────────────────────────────────────────
describe('graphHealthState (settings-view.js:748-749)', () => {
  it('mode=off → off', () => expect(graphHealthState(graph({ mode: 'off' }))).toBe('off'));
  it('mode!=off + circuit CLOSED + sync running → ok', () =>
    expect(graphHealthState(graph({ mode: 'primary', circuit: { state: 'CLOSED', consecutiveFailures: 0, fallbackRate: 0 }, sync: { running: true, cursor: 1 } }))).toBe('ok'));
  it('circuit OPEN → warn', () =>
    expect(graphHealthState(graph({ mode: 'primary', circuit: { state: 'OPEN', consecutiveFailures: 3, fallbackRate: 1 } }))).toBe('warn'));
  it('sync 정지 → warn', () =>
    expect(graphHealthState(graph({ mode: 'shadow', sync: { running: false, cursor: null } }))).toBe('warn'));
});

describe('graphHealthIcon (settings-view.js:750)', () => {
  it('ok → ✓', () => expect(graphHealthIcon('ok')).toBe('✓'));
  it('warn → ⚠', () => expect(graphHealthIcon('warn')).toBe('⚠'));
  it('off → ⏸', () => expect(graphHealthIcon('off')).toBe('⏸'));
});

describe('isValidGraphMode (settings-view.js:723)', () => {
  it('off/shadow/primary 허용', () => {
    expect(isValidGraphMode('off')).toBe(true);
    expect(isValidGraphMode('shadow')).toBe(true);
    expect(isValidGraphMode('primary')).toBe(true);
  });
  it('그 외 거부', () => {
    expect(isValidGraphMode('on')).toBe(false);
    expect(isValidGraphMode('')).toBe(false);
  });
});

describe('graphSourceKey (settings-view.js:764)', () => {
  it('file → saved', () => expect(graphSourceKey('file')).toBe('saved'));
  it('env → env', () => expect(graphSourceKey('env')).toBe('env'));
  it('default → default', () => expect(graphSourceKey('default')).toBe('default'));
});

// ── Proxy (P2-07) ─────────────────────────────────────────────────────────────
describe('proxyHealthState (settings-view.js:1196-1200)', () => {
  it('corrupted → broken', () => expect(proxyHealthState(proxy({ corrupted: true }))).toBe('broken'));
  it('installed → ok', () => expect(proxyHealthState(proxy({ installed: true }))).toBe('ok'));
  it('프로필 미존재 → missing', () => expect(proxyHealthState(proxy({ profileExisted: false }))).toBe('missing'));
  it('프로필 존재 + 미설치 → warn', () => expect(proxyHealthState(proxy({ profileExisted: true, installed: false }))).toBe('warn'));
  it('corrupted 가 installed 보다 우선', () =>
    expect(proxyHealthState(proxy({ corrupted: true, installed: true }))).toBe('broken'));
});

describe('proxyHealthBadgeVariant (settings-view.js:1205)', () => {
  it('ok → ok', () => expect(proxyHealthBadgeVariant('ok')).toBe('ok'));
  it('broken/missing/warn → warn', () => {
    expect(proxyHealthBadgeVariant('broken')).toBe('warn');
    expect(proxyHealthBadgeVariant('missing')).toBe('warn');
    expect(proxyHealthBadgeVariant('warn')).toBe('warn');
  });
});

describe('proxyHealthIcon (settings-view.js:1201)', () => {
  it('ok → ✓', () => expect(proxyHealthIcon('ok')).toBe('✓'));
  it('broken → ✕', () => expect(proxyHealthIcon('broken')).toBe('✕'));
  it('missing → ⚠', () => expect(proxyHealthIcon('missing')).toBe('⚠'));
  it('warn → ⚠', () => expect(proxyHealthIcon('warn')).toBe('⚠'));
});

describe('isValidProxyShell (settings-view.js:1208)', () => {
  it('auto/zsh/bash/fish 허용', () => {
    expect(isValidProxyShell('auto')).toBe(true);
    expect(isValidProxyShell('zsh')).toBe(true);
    expect(isValidProxyShell('bash')).toBe(true);
    expect(isValidProxyShell('fish')).toBe(true);
  });
  it('그 외 거부', () => expect(isValidProxyShell('sh')).toBe(false));
});

describe('snippetShell (settings-view.js:1177)', () => {
  it('auto → zsh', () => expect(snippetShell('auto')).toBe('zsh'));
  it('명시 셸 그대로', () => {
    expect(snippetShell('bash')).toBe('bash');
    expect(snippetShell('fish')).toBe('fish');
  });
});

describe('isInstallSuccess (settings-view.js:989)', () => {
  it('installed / already-installed → true', () => {
    expect(isInstallSuccess('installed')).toBe(true);
    expect(isInstallSuccess('already-installed')).toBe(true);
  });
  it('failed → false', () => expect(isInstallSuccess('failed')).toBe(false));
});
