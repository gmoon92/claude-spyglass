/**
 * features/settings/logic.ts — 진단/Hook 상태 결정 순수함수 (P2-06)
 *
 * 원본: assets/js/settings-view.js 안에 *인라인* 되어 있던 상태/헬스 계산 분기를 순수함수로
 *   추출한다. JSX 렌더와 분리해 단위 테스트 가능하게 만든다(아키텍처 §4.2 검증 — 라디오 선택값
 *   유효성·상태 라벨 분기). 출력값(RowStatus/HookHealthState)은 원본 분기와 1:1.
 *
 * SSoT: i18n 키 문자열은 여기 두지 않는다(원본도 t() 호출은 렌더부에서만). 본 모듈은 *상태 분류*
 *   (✓⚠✕ 결정)만 담당하고, 라벨 텍스트는 컴포넌트가 i18n 으로 채운다.
 */

import type {
  GraphData,
  GraphMode,
  HookData,
  HookHealthState,
  HookProfile,
  ProxyShell,
  ProxyStatus,
  RowStatus,
  VersionInfo,
} from './types';

// ── 외부 도구 row 상태 (settings-view.js:204 versionRow) ──────────────────────
/** 도구 available → 'ok', 미설치 → 'warn'(원본 :204). */
export function versionRowStatus(v: VersionInfo): RowStatus {
  return v.available ? 'ok' : 'warn';
}

/**
 * 미설치 installHint 가 `#`-주석이면 안내문(복사 버튼 생략), 아니면 명령(복사 버튼 노출).
 * 원본 settings-view.js:209 `installHint.trim().startsWith('#')`.
 */
export function isCommentHint(installHint: string): boolean {
  return installHint.trim().startsWith('#');
}

// ── 진단 카드 hook row 상태 (settings-view.js:219-227 hookStatus) ─────────────
/**
 * 진단 카드의 hook 요약 row 상태.
 *   - 미존재          → 'warn'
 *   - 존재+파싱실패    → 'fail'
 *   - 등록=기대        → 'ok'
 *   - 그 외(부분/0)    → 'warn'
 * 원본 :219-227 의 중첩 삼항을 평탄화(동치).
 */
export function diagHookRowStatus(hooks: HookData): RowStatus {
  if (!hooks.exists) return 'warn';
  if (!hooks.parsed) return 'fail';
  if (hooks.registeredCount === hooks.expectedCount) return 'ok';
  return 'warn';
}

// ── Hook 섹션 통합 헬스 상태 (settings-view.js:409-413 healthState) ───────────
/**
 * Hook 섹션 상단 통합 헬스 배지 상태.
 *   - 미존재               → 'missing'
 *   - 존재+파싱실패         → 'broken'
 *   - 등록=기대 AND spyglassDir 설정 → 'ok'
 *   - 그 외                → 'warn'
 * 원본 :409-413 1:1.
 */
export function hookHealthState(hooks: HookData): HookHealthState {
  if (!hooks.exists) return 'missing';
  if (!hooks.parsed) return 'broken';
  if (hooks.registeredCount === hooks.expectedCount && hooks.spyglassDir) return 'ok';
  return 'warn';
}

/**
 * 헬스 배지의 CSS 변형 클래스 — broken/missing 은 시각적으로 'warn' 톤 공유(원본 :476).
 *   `is-${healthState === 'broken' ? 'warn' : healthState === 'missing' ? 'warn' : healthState}`.
 */
export function hookHealthBadgeVariant(state: HookHealthState): 'ok' | 'warn' {
  return state === 'ok' ? 'ok' : 'warn';
}

/** 헬스 배지 글리프 — ok '✓' / broken '✕' / 그 외 '⚠'(원본 :414). */
export function hookHealthIcon(state: HookHealthState): string {
  return state === 'ok' ? '✓' : state === 'broken' ? '✕' : '⚠';
}

/**
 * 프로필 선택 카드 노출 여부 — 정상(ok)이면 숨김(원본 :425 showProfilePicker = healthState!=='ok').
 */
export function showProfilePicker(state: HookHealthState): boolean {
  return state !== 'ok';
}

/**
 * 라디오 선택값 유효성 가드 — 'full' | 'minimal' 만 허용(원본 :504).
 * 아키텍처 §4.2: 입력 폼이 아니므로 클라 검증 최소 — 라디오 유효성만 타입가드.
 */
export function isValidHookProfile(value: string): value is HookProfile {
  return value === 'full' || value === 'minimal';
}

/**
 * Undo(복구) 버튼 노출 가능 여부 — 백업 경로가 있고 "(none...)" placeholder 가 아닐 때(원본 :614,660).
 * "(none — 첫 설치)" 같은 케이스는 복구 불가라 버튼 생략.
 */
export function canUndo(backupPath: string | null | undefined): boolean {
  return !!backupPath && !backupPath.startsWith('(');
}

// ── Graph DB (P2-07) ─────────────────────────────────────────────────────────

/** Graph 섹션 통합 헬스 상태(원본 renderGraphSection :748-749). */
export type GraphHealthState = 'ok' | 'warn' | 'off';

/**
 * Graph 통합 상태 배지.
 *   - mode=off                              → 'off'
 *   - circuit=CLOSED AND sync.running       → 'ok'
 *   - 그 외(circuit OPEN/HALF || !running)  → 'warn'
 * 원본 :748-749 1:1.
 */
export function graphHealthState(graph: GraphData): GraphHealthState {
  if (graph.mode === 'off') return 'off';
  return graph.circuit?.state === 'CLOSED' && graph.sync?.running ? 'ok' : 'warn';
}

/** Graph 헬스 배지 변형 클래스 — 원본 `is-${healthState}`(:819). off 는 별도 톤. */
export function graphHealthBadgeVariant(state: GraphHealthState): 'ok' | 'warn' | 'off' {
  return state;
}

/** Graph 헬스 글리프 — ok '✓' / warn '⚠' / off '⏸'(원본 :750). */
export function graphHealthIcon(state: GraphHealthState): string {
  return state === 'ok' ? '✓' : state === 'warn' ? '⚠' : '⏸';
}

/** Graph 모드 라디오 유효성 가드 — off/shadow/primary(원본 modes :723). */
export function isValidGraphMode(value: string): value is GraphMode {
  return value === 'off' || value === 'shadow' || value === 'primary';
}

/** graph source → i18n 키 접미사(원본 :764 `source==='file'?'saved':source`). */
export function graphSourceKey(source: string): string {
  return source === 'file' ? 'saved' : source;
}

// ── Proxy (P2-07) ────────────────────────────────────────────────────────────

/** Proxy 섹션 통합 헬스 상태(원본 renderProxySection :1196-1200). */
export type ProxyHealthState = 'ok' | 'warn' | 'broken' | 'missing';

/**
 * Proxy 통합 상태 배지.
 *   - corrupted          → 'broken'
 *   - installed          → 'ok'
 *   - !profileExisted    → 'missing'
 *   - 그 외(미설치)       → 'warn'
 * 원본 :1196-1200 1:1.
 */
export function proxyHealthState(status: ProxyStatus): ProxyHealthState {
  if (status.corrupted) return 'broken';
  if (status.installed) return 'ok';
  if (!status.profileExisted) return 'missing';
  return 'warn';
}

/** Proxy 헬스 배지 변형 — ok 만 'is-ok', 나머지 'is-warn'(원본 :1205). */
export function proxyHealthBadgeVariant(state: ProxyHealthState): 'ok' | 'warn' {
  return state === 'ok' ? 'ok' : 'warn';
}

/** Proxy 헬스 글리프 — ok '✓' / broken '✕' / 그 외 '⚠'(원본 :1201). */
export function proxyHealthIcon(state: ProxyHealthState): string {
  return state === 'ok' ? '✓' : state === 'broken' ? '✕' : '⚠';
}

/** Proxy 셸 선택 유효성 가드 — auto/zsh/bash/fish(원본 shells :1208). */
export function isValidProxyShell(value: string): value is ProxyShell {
  return value === 'auto' || value === 'zsh' || value === 'bash' || value === 'fish';
}

/** snippet fetch 용 셸 정규화 — 'auto' 는 'zsh' 로(원본 :1177). */
export function snippetShell(shell: ProxyShell): string {
  return shell === 'auto' ? 'zsh' : shell;
}

/** install 결과 status 가 성공(설치/이미설치)인지(원본 :989). */
export function isInstallSuccess(status: string): boolean {
  return status === 'installed' || status === 'already-installed';
}
