/**
 * settings/version-probe.ts — 외부 도구 버전 진단
 *
 * 책임 (Single Responsibility):
 *   spyglass 가 의존하는 외부 CLI 도구(`bun`, `claude`, `git`, `curl`, `jq`)의 설치 여부와
 *   버전을 시스템 PATH 기준으로 조회한다. 도구가 없거나 실행 실패해도 *예외를 던지지 않고*
 *   해당 항목을 null 로 반환 — 설정 페이지의 진단 카드 한 줄에 ⚠ 미설치 로 노출되기 위함.
 *
 * 의존성:
 *   - Bun.spawn (외부 프로세스 실행) — 가벼움 + stderr/stdout 별도 캡쳐.
 *
 * 호출 흐름:
 *   routes/settings.ts::handleDiag → probeAllVersions()
 *     → Promise.all([probeBun, probeClaude, probeGit, probeCurl, probeJq])
 *     → 각 항목 { name, available, version, raw } 반환
 *
 * 디자인 결정:
 *   - 각 도구별 `--version` 출력 포맷이 달라(첫 줄·다음 줄·괄호 등) 정규식으로 SemVer 추출.
 *   - 정규식 매칭 실패 시에도 `raw` 필드에 원본 stdout 첫 100자 보존 — 사용자가 직접 보고
 *     상황 판단 가능.
 *   - timeout 2초 — 정상 환경에선 100ms 안에 끝나야 함. 그 이상이면 hang 으로 간주.
 *
 * 비범위:
 *   - 버전 SemVer 비교 (최소 버전 요구) — 본 모듈은 *현재 버전 보고* 만. 비교/판정은 호출 측.
 */

// =============================================================================
// 타입 — 설정 페이지 진단 카드와 1:1 대응
// =============================================================================

export interface VersionProbeResult {
  /** 도구 이름 — UI 라벨로도 사용. */
  name: string;
  /** 시스템 PATH 에 도구가 존재하고 `--version` 이 0 으로 종료했는지. */
  available: boolean;
  /** SemVer 추출 결과 (`1.2.18` 형식). 매칭 실패 시 null. */
  version: string | null;
  /** stdout 원본 첫 100자 — 정규식 실패 케이스의 사용자 디버깅용. */
  raw: string | null;
  /** 미설치 시 사용자에게 보여줄 설치 안내 명령 (없으면 빈 문자열). */
  installHint: string;
}

export interface AllVersionsResult {
  bun: VersionProbeResult;
  claude: VersionProbeResult;
  git: VersionProbeResult;
  curl: VersionProbeResult;
  jq: VersionProbeResult;
  // sqlite3 CLI 는 SQLite 탭 전용으로 분리 — probeSqlite3() 가 책임.
  //   분리 이유: /api/settings/diag 가 5개 탭에서 중복 호출되는데 sqlite3 결과는 SQLite 탭만 사용.
  //   불필요한 6번째 spawn 을 모든 diag 응답에서 절감 (방안 B).
}

// =============================================================================
// 도구별 정의 (정규식 + 설치 힌트)
// =============================================================================

/**
 * 각 도구의 `--version` stdout 첫 줄에서 SemVer 를 뽑는 정규식.
 *
 *   bun     → "1.2.18"           — 단순 SemVer.
 *   claude  → "1.0.95 (Claude Code)" — 괄호 앞 SemVer.
 *   git     → "git version 2.49.0" — prefix 다음.
 *   curl    → "curl 8.7.1 (..."   — prefix 다음.
 *   jq      → "jq-1.7.1"          — prefix '-' 다음.
 *
 * 정규식 첫 capture group 이 SemVer (X.Y[.Z][...]) 가 되도록 설계.
 */
const TOOL_DEFS: ReadonlyArray<{
  key: keyof AllVersionsResult;
  bin: string;
  args: string[];
  re: RegExp;
  installHint: string;
}> = [
  {
    key: 'bun',
    bin: 'bun',
    args: ['--version'],
    re: /(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)/,
    installHint: 'curl -fsSL https://bun.sh/install | bash',
  },
  {
    key: 'claude',
    bin: 'claude',
    args: ['--version'],
    re: /(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)/,
    installHint: 'curl -fsSL https://claude.ai/install.sh | bash',
  },
  {
    key: 'git',
    bin: 'git',
    args: ['--version'],
    re: /(\d+\.\d+(?:\.\d+)?)/,
    installHint: '# macOS: brew install git  /  Linux: apt-get install git',
  },
  {
    key: 'curl',
    bin: 'curl',
    args: ['--version'],
    re: /(\d+\.\d+(?:\.\d+)?)/,
    installHint: '# pre-installed on most systems — use your OS package manager',
  },
  {
    key: 'jq',
    bin: 'jq',
    args: ['--version'],
    re: /(\d+\.\d+(?:\.\d+)?)/,
    installHint: '# macOS: brew install jq  /  Linux: apt-get install jq',
  },
];

/**
 * sqlite3 CLI 전용 정의 — TOOL_DEFS 와 분리.
 *
 *   Spyglass 자체는 Bun 내장 SQLite 만 사용. 본 항목은 *디버깅용* 외부 CLI
 *   (`sqlite3 ~/.spyglass/spyglass.db "SELECT ..."`) 의 설치 여부 진단.
 *   미설치여도 Spyglass 동작에는 영향 없음 → installHint 도 #-prefix 주석 형식.
 *
 *   `key` 는 AllVersionsResult 와 시그니처를 맞추기 위해 string 으로 두되, 본 def 는
 *   AllVersionsResult 에 들어가지 않는다 (probeSqlite3 이 별도 반환).
 */
const SQLITE3_TOOL_DEF = {
  key: 'sqlite3' as const,
  bin: 'sqlite3',
  args: ['--version'],
  re: /(\d+\.\d+(?:\.\d+)?)/,
  installHint: '# 선택: brew install sqlite (DB 직접 조회용 CLI)',
};

// =============================================================================
// 메인 진입점
// =============================================================================

/**
 * 5개 도구를 *동시* 조회. 각 spawn 이 독립 프로세스이므로 Promise.all 로 fan-out.
 *
 * 평균 처리 시간: 50~150ms (5개 도구 병렬, 가장 느린 것 = wall-clock).
 * 미설치 도구가 있어도 다른 도구의 결과는 정상 반환 — 부분 실패 허용.
 */
export async function probeAllVersions(): Promise<AllVersionsResult> {
  const entries = await Promise.all(TOOL_DEFS.map((def) => probeOne(def)));
  const out = {} as AllVersionsResult;
  for (const [def, res] of entries.map((r, i) => [TOOL_DEFS[i], r] as const)) {
    out[def.key] = res;
  }
  return out;
}

/**
 * sqlite3 CLI 단독 조회 — SQLite 탭 전용 진입점.
 *
 * 방안 B (분석 보고서 2026-05-26): /api/settings/diag 가 5개 탭에서 중복 호출되는데
 * sqlite3 결과는 SQLite 탭만 사용. probeAllVersions 에서 sqlite3 를 빼내 SQLite 탭의
 * /api/settings/sqlite/info 응답에 직접 포함시킴으로써 diag 호출 자체를 제거 가능.
 *
 * 반환: VersionProbeResult — handleDiag 의 versions 와 동일한 형식.
 */
export async function probeSqlite3(): Promise<VersionProbeResult> {
  return probeOne(SQLITE3_TOOL_DEF);
}

// =============================================================================
// 단일 도구 조회 — 예외를 던지지 않는다
// =============================================================================

/**
 * 단일 도구를 `Bun.spawn` 으로 실행하고 결과를 표준 형식으로 정규화.
 *
 * 실패 케이스 (모두 `available: false` 로 폴백):
 *   - `Bun.spawn` 자체가 throw (binary 가 PATH 에 없음) → catch 로 흡수
 *   - 종료 코드 ≠ 0 → available: false
 *   - 2초 timeout → kill 후 available: false
 *
 * stdout/stderr 모두 캡쳐 후 *어느 쪽이든* SemVer 가 매칭되면 채택 — 일부 도구는 stderr 로 버전 출력.
 */
async function probeOne(def: {
  // key 는 외부 매핑용일 뿐 probeOne 자체는 사용하지 않음 — 시그니처에서 제외해 TOOL_DEFS 외의
  // 단일 도구 def(SQLITE3_TOOL_DEF 등) 도 그대로 전달 가능하게 한다.
  bin: string;
  args: string[];
  re: RegExp;
  installHint: string;
}): Promise<VersionProbeResult> {
  const base: VersionProbeResult = {
    name: def.bin,
    available: false,
    version: null,
    raw: null,
    installHint: def.installHint,
  };

  try {
    const proc = Bun.spawn([def.bin, ...def.args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // 2초 timeout — race 패턴.
    const exitOrTimeout = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), 2000)),
    ]);
    if (exitOrTimeout === -1) {
      try { proc.kill(); } catch { /* already dead */ }
      return base;
    }
    if (exitOrTimeout !== 0) return base;

    // stdout 우선, 비어 있으면 stderr (git/curl 등 일부는 stderr).
    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const raw = (stdoutText || stderrText).trim();
    const match = def.re.exec(raw);

    return {
      ...base,
      available: true,
      version: match ? match[1] : null,
      raw: raw.slice(0, 100),
    };
  } catch {
    // Bun.spawn 이 ENOENT 등으로 throw — 미설치 케이스 그대로 폴백.
    return base;
  }
}
