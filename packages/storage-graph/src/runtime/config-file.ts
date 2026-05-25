/**
 * config-file.ts — `~/.spyglass/server-config.json` SSoT
 *
 * 책임 (Single Responsibility):
 *   spyglass 서버의 *영속 설정* 을 JSON 파일에 저장/조회한다. 사용자가 웹 대시보드 설정
 *   페이지에서 graph mode 같은 값을 변경하면 본 파일이 변경되어 *다음 서버 시작에도 유지*
 *   된다. 셸 환경변수(`SPYGLASS_GRAPH_MODE` 등) 영속화의 대안 — IDE 터미널/Electron/
 *   launchctl/systemd 컨텍스트에서 셸 export 가 무력화되는 케이스를 해소.
 *
 * 의존성:
 *   - node:fs/promises (readFile, writeFile, rename, mkdir)
 *   - paths.ts::getUserSpyglassDir 같은 헬퍼는 의도적으로 미사용 — 본 모듈은 storage-graph
 *     의 다른 모듈에 의존하지 않는 *독립적 SSoT* (테스트 격리 + 순환 의존 방지).
 *
 * 호출 흐름:
 *   flag.ts::getGraphMode()              // env > file > default 평가 시 file 읽기
 *     → loadServerConfig()
 *   routes/settings.ts::handleGraphMode  // persistent:true 시 파일 저장
 *     → saveServerConfig({graphMode})
 *
 * 디자인 결정 — Gemini 리뷰 §3.3:
 *   - 임시 파일은 *같은 파일 시스템* 의 `~/.spyglass/tmp/` 에 생성 후 rename.
 *     사용자 홈 디렉토리에 `.tmp-xxx` 파일을 두면 셸의 와일드카드 sourcing 패턴이나
 *     `ls -la ~` 에 노이즈로 남는다. 격리 디렉토리가 *사용자 보호* 측면에서 안전.
 *   - 파일은 항상 *같은 디스크 파티션* (사용자 홈) 안에 있어 rename atomic 보장.
 *
 * 스키마 버전 (`version: 1`):
 *   향후 port / plugin enabled / theme 등 다른 영속 설정도 본 파일에 통합 가능. 새 필드
 *   추가는 *기존 필드 보존 + 누락된 필드 default 주입* 방식의 마이그레이션으로 처리.
 */

import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { GraphMode } from './flag';

// =============================================================================
// 경로 / 상수
// =============================================================================

/** 디렉토리 이름 — paths.ts 의 SPYGLASS_HOME_DIRNAME 과 동일. 순환 의존 없도록 자체 상수. */
const SPYGLASS_HOME_DIRNAME = '.spyglass';
const CONFIG_FILENAME = 'server-config.json';
const TMP_SUBDIR = 'tmp';

/** 현재 스키마 버전. 새 필드 추가 시에도 1 유지 (마이그레이션은 누락 필드 주입 방식). */
export const SERVER_CONFIG_VERSION = 1;

/**
 * 사용자 홈 디렉토리 — `SPYGLASS_HOME` override 또는 OS 표준.
 *
 *   paths.ts 의 동일 헬퍼와 *의도적으로 중복 구현*. 본 모듈을 paths.ts 에 의존시키면
 *   서버 부팅 시 paths.ts 가 graph 디렉토리를 *자동 생성* 하는 부수효과가 config 읽기
 *   시점에 발동 — config 만 읽고 싶은데 graph 폴더가 미리 생기는 회귀 가능성. 격리 유지.
 */
function getUserHome(): string {
  const override = process.env.SPYGLASS_HOME;
  if (override && override.length > 0) return override;
  return process.env.HOME || process.env.USERPROFILE || '/tmp';
}

/** 사용자의 spyglass 루트 디렉토리 (`~/.spyglass/`). 환경에 따라 home 이 직접 가리킬 수도 있음. */
function getSpyglassRoot(): string {
  const home = getUserHome();
  const alreadyRoot = home.endsWith(`/${SPYGLASS_HOME_DIRNAME}`);
  return alreadyRoot ? home : join(home, SPYGLASS_HOME_DIRNAME);
}

/** server-config.json 절대 경로. 테스트/외부 노출용. */
export function getServerConfigPath(): string {
  return join(getSpyglassRoot(), CONFIG_FILENAME);
}

/** atomic write 용 격리 tmp 디렉토리. */
export function getServerConfigTmpDir(): string {
  return join(getSpyglassRoot(), TMP_SUBDIR);
}

// =============================================================================
// 스키마
// =============================================================================

/**
 * 영속 설정 스키마 v1.
 *
 *   - version : 마이그레이션 분기용. 항상 SERVER_CONFIG_VERSION 으로 저장.
 *   - graphMode: 'off' | 'shadow' | 'primary'. 누락 시 getGraphMode 가 default 폴백.
 *   - updatedAt: 마지막 쓰기 시각 (unix ms). 디버깅용.
 *
 *   *graphMode 가 undefined* 인 케이스가 가능 — 파일은 있지만 graphMode 필드만 없을 때.
 *   getGraphMode() 가 file source 에서 undefined 면 default 로 진행.
 */
export interface ServerConfig {
  version: number;
  graphMode?: GraphMode;
  updatedAt: number;
}

const DEFAULT_CONFIG: ServerConfig = {
  version: SERVER_CONFIG_VERSION,
  graphMode: undefined,
  updatedAt: 0,
};

// =============================================================================
// 로드 — 안전한 폴백
// =============================================================================

/**
 * `~/.spyglass/server-config.json` 을 읽어 ServerConfig 반환.
 *
 *   다음 모든 케이스에 *예외를 던지지 않고* DEFAULT_CONFIG 폴백:
 *     - 파일 없음 (첫 부팅)
 *     - 권한 거부
 *     - JSON 파싱 실패 (사용자가 손댄 케이스 / 디스크 손상)
 *     - root 가 plain object 아님 (array / primitive)
 *     - graphMode 가 알 수 없는 문자열
 *
 *   파일이 있고 graphMode 가 정상이면 그 값을 신뢰. version 이 미래값(>1) 이어도
 *   현재 알고 있는 필드만 읽어 진행 — 다운그레이드 호환.
 */
export async function loadServerConfig(): Promise<ServerConfig> {
  const path = getServerConfigPath();
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_CONFIG };
  }

  const obj = parsed as Record<string, unknown>;
  const version = typeof obj.version === 'number' && obj.version >= 1 ? obj.version : SERVER_CONFIG_VERSION;
  const graphMode = isValidGraphMode(obj.graphMode) ? obj.graphMode : undefined;
  const updatedAt = typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : 0;

  return { version, graphMode, updatedAt };
}

function isValidGraphMode(v: unknown): v is GraphMode {
  return v === 'off' || v === 'shadow' || v === 'primary';
}

// =============================================================================
// 저장 — Atomic write via ~/.spyglass/tmp/
// =============================================================================

/**
 * ServerConfig 의 *부분 업데이트* 를 atomic 하게 저장.
 *
 *   1) 현재 파일을 loadServerConfig 로 불러옴 (없으면 DEFAULT).
 *   2) patch 의 필드만 덮어쓴 새 객체 생성 + version/updatedAt 갱신.
 *   3) `~/.spyglass/tmp/server-config.json.<random>` 에 작성.
 *   4) tmp → 본 경로 rename (POSIX atomic). 같은 파티션 보장.
 *   5) 실패 시 tmp cleanup (best-effort).
 *
 *   Cross-platform (hardening Phase A 와 동일 패턴): Windows 는 destination 존재 시
 *   rename 이 실패하므로 unlink 후 rename. 1-step atomic 은 깨지지만 부분 회복 보장.
 *
 *   반환: 저장된 최종 ServerConfig (호출 측이 즉시 사용 가능).
 */
export async function saveServerConfig(patch: Partial<Omit<ServerConfig, 'version' | 'updatedAt'>>): Promise<ServerConfig> {
  const current = await loadServerConfig();
  const next: ServerConfig = {
    ...current,
    ...patch,
    version: SERVER_CONFIG_VERSION,
    updatedAt: Date.now(),
  };

  const targetPath = getServerConfigPath();
  const tmpDir = getServerConfigTmpDir();
  await mkdir(tmpDir, { recursive: true });
  // 목적지 디렉토리도 보장 (SPYGLASS_HOME override 환경에서 spyglass root 가 없을 수도).
  await mkdir(getSpyglassRoot(), { recursive: true });

  const tmpPath = join(tmpDir, `${CONFIG_FILENAME}.${Math.random().toString(36).slice(2, 10)}`);
  const body = JSON.stringify(next, null, 2) + '\n';

  try {
    await writeFile(tmpPath, body, 'utf-8');
    await atomicReplace(tmpPath, targetPath);
  } catch (err) {
    try { await unlink(tmpPath); } catch { /* best-effort cleanup */ }
    throw err;
  }

  return next;
}

/**
 * tmp → target atomic replace — Windows 호환 분기.
 *
 *   POSIX: `rename` 한 번 — kernel atomic.
 *   Win32: target 이 있으면 rename 이 EPERM/EEXIST → unlink 후 rename.
 *     하드닝 #1 의 claude-hooks.ts::atomicReplace 와 동일 정책.
 */
async function atomicReplace(tmpPath: string, targetPath: string): Promise<void> {
  if (process.platform === 'win32') {
    try { await unlink(targetPath); } catch { /* target 이 원래 없거나 권한 — rename 단계서 다시 throw */ }
    await rename(tmpPath, targetPath);
    return;
  }
  await rename(tmpPath, targetPath);
}
