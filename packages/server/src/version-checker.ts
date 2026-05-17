/**
 * 버전 체커 — 로컬 package.json 버전과 GitHub 최신 태그를 비교.
 *
 * 변경 이유: 캐싱 정책·갱신 주기·비교 로직 변경 시 한 곳만 수정.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';

const REPO_OWNER = 'gmoon92';
const REPO_NAME = 'claude-spyglass';
const GITHUB_TAGS_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/tags`;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1시간

export interface VersionCache {
  currentVersion: string;
  latestTag: string | null;
  updateAvailable: boolean;
}

let cache: VersionCache | null = null;
let checkTimer: ReturnType<typeof setInterval> | null = null;

/**
 * package.json 경로를 서버 실행 위치에 관계없이 찾는다.
 *   __dirname = .../packages/server/src
 *   package.json = 프로젝트 루트
 */
function findPackageJsonPath(): string {
  // __dirname 기준으로 프로젝트 루트의 package.json 찾기
  const fromSrc = join(dirname(__dirname), '..', '..', 'package.json');
  return fromSrc;
}

/**
 * 로컬 package.json에서 버전을 읽는다.
 */
function readCurrentVersion(): string {
  const path = findPackageJsonPath();
  const raw = readFileSync(path, 'utf-8');
  const pkg = JSON.parse(raw);
  return pkg.version ?? '0.0.0';
}

/**
 * GitHub API(비인증)로 최신 태그를 조회한다.
 * 실패하면 null을 반환하고 조용히 넘어간다(silent fail).
 */
async function fetchLatestTag(): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_TAGS_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      console.warn(`[VersionChecker] GitHub API failed: ${res.status}`);
      return null;
    }
    const tags = await res.json() as Array<{ name: string }>;
    if (!Array.isArray(tags) || tags.length === 0) return null;
    const semverNames = tags
      .map(t => t.name)
      .filter(n => /^v?\d+\.\d+\.\d+$/.test(n));
    if (semverNames.length === 0) return null;
    // isNewer(best, cur) === true 이면 cur이 더 큼.
    return semverNames.reduce<string | null>(
      (best, cur) => (best === null || isNewer(best, cur)) ? cur : best,
      null
    );
  } catch (err) {
    console.warn('[VersionChecker] Failed to fetch latest tag:', err);
    return null;
  }
}

/**
 * 버전 문자열에서 숫자와 점(.)만 추출해 정수 배열로 변환.
 *   - GitHub 태그 컨벤션: 'v1.0.0' (v prefix 의도적 유지)
 *   - npm/bun 컨벤션: '1.0.0' (v 없음)
 *   - prerelease/build metadata: 'v1.0.0-beta', '1.0.0+sha' 등도 안전 처리
 * 비교 시에만 정규화하고, 응답에 노출되는 원본 문자열은 그대로 보존한다.
 */
function parseVersion(v: string): number[] {
  const clean = v.replace(/[^0-9.]/g, '');
  return clean.split('.').filter(Boolean).map(Number);
}

/**
 * semver 기준으로 a < b 인지 비교. prerelease는 고려하지 않음.
 */
function isNewer(a: string, b: string): boolean {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const an = av[i] ?? 0;
    const bn = bv[i] ?? 0;
    if (an !== bn) return bn > an;
  }
  return false;
}

/**
 * 현재 버전과 최신 태그를 비교해 updateAvailable을 계산한다.
 *   1) 표시 문자열은 컨벤션 차이로 다를 수 있음('v1.0.0' vs '1.0.0').
 *      숫자/점만 남긴 정규화 문자열이 동일하면 즉시 false (빠른 경로).
 *   2) 그렇지 않으면 semver 비교(isNewer).
 */
function computeUpdateAvailable(current: string, latest: string | null): boolean {
  if (!latest) return false;
  const currentNum = current.replace(/[^0-9.]/g, '');
  const latestNum = latest.replace(/[^0-9.]/g, '');
  if (currentNum === latestNum) return false;
  return isNewer(current, latest);
}

/**
 * 캐시를 (재)구성한다. latestTag가 null이면 기존 캐시의 latestTag를 유지.
 */
function buildCache(currentVersion: string, latestTag: string | null): VersionCache {
  const effectiveLatest = latestTag ?? cache?.latestTag ?? null;
  return {
    currentVersion,
    latestTag: effectiveLatest,
    updateAvailable: computeUpdateAvailable(currentVersion, effectiveLatest),
  };
}

/**
 * 버전 체크를 1회 실행한다.
 *   - GitHub API 호출 (silent fail)
 *   - 캐시 갱신
 *
 * 서버 시작 시와 setInterval 콜백에서 호출.
 */
export async function check(): Promise<void> {
  const currentVersion = readCurrentVersion();
  const latestTag = await fetchLatestTag();
  cache = buildCache(currentVersion, latestTag);
  console.log(
    `[VersionChecker] current=${cache.currentVersion} latest=${cache.latestTag} updateAvailable=${cache.updateAvailable}`
  );
}

/**
 * git pull 성공 후 package.json을 다시 읽어 캐시를 갱신한다.
 * 서버 재시작 없이도 배지가 사라질 수 있도록 currentVersion을 업데이트.
 */
export function refreshAfterUpdate(): void {
  const currentVersion = readCurrentVersion();
  cache = buildCache(currentVersion, cache?.latestTag ?? null);
  console.log(
    `[VersionChecker] Refreshed after update: current=${cache.currentVersion} updateAvailable=${cache.updateAvailable}`
  );
}

/**
 * 현재 캐시된 버전 정보를 반환한다.
 * 캐시가 없으면 기본값(최신 태그 null, 업데이트 불가)을 반환.
 */
export function getVersionCache(): VersionCache {
  if (!cache) {
    const currentVersion = readCurrentVersion();
    return {
      currentVersion,
      latestTag: null,
      updateAvailable: false,
    };
  }
  return cache;
}

/**
 * 백그라운드 주기 체크를 시작한다.
 *   - 1시간마다 GitHub API 호출 (currentVersion 재읽기 포함)
 */
export function startVersionCheckSchedule(): void {
  // 즉시 1회 실행
  check().catch(() => {});

  checkTimer = setInterval(() => {
    check().catch(() => {});
  }, CHECK_INTERVAL_MS);
}

/**
 * 백그라운드 주기 체크를 중단한다.
 */
export function stopVersionCheckSchedule(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}
