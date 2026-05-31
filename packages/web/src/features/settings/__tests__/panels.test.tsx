/**
 * panels.test.tsx — DiagPanel/HooksPanel/ServerPanel 프레젠테이션 뷰 계약 (P2-06)
 *
 * 원본 innerHTML: #3(diag :310), #4(hooks :471), #23(server :493).
 * 전략: 데이터 페칭(useSettingsDiag, AbortController)과 분리된 *뷰* 컴포넌트를 data prop 으로
 *   주입해 renderToStaticMarkup 으로 마크업/셀렉터/jump 배선을 검증(effect 미실행 환경 우회).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { DiagPanelView } from '../DiagPanelView';
import { HooksPanelView } from '../HooksPanelView';
import { ServerPanelView } from '../ServerPanelView';
import { GraphPanelView } from '../GraphPanelView';
import { SqlitePanelView } from '../SqlitePanelView';
import { ProxyPanelView } from '../ProxyPanelView';
import type {
  DiagData,
  GraphData,
  HookData,
  LadybugStatus,
  LogsData,
  ProxySnippet,
  ProxyStatus,
  ServerInfo,
  SqliteInfo,
} from '../types';

// 식별 가능한 i18n 라벨러 — 무전역(filter-bar 선례).
const t = (key: string) => `t:${key}`;

/**
 * 깊이우선 탐색 — 합성 컴포넌트(JumpButton/OptionCard 등 함수형 element)를 만나면 그 함수를
 * props 로 호출해 렌더 결과까지 펼쳐 탐색한다(renderToStaticMarkup 와 동일한 호스트 DOM 도달).
 * 이로써 패널이 leaf 의 onClick/onSelect 콜백을 어떻게 배선했는지 호스트 button 까지 추적 가능.
 */
function findNode(node: unknown, pred: (el: ReactElement) => boolean): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as ReactElement & { type?: unknown; props?: { children?: unknown } };
  if (el.props && pred(el)) return el;
  // 함수형 컴포넌트 element → 호출해 렌더 결과 펼침.
  if (typeof el.type === 'function') {
    const rendered = (el.type as (p: unknown) => unknown)(el.props ?? {});
    const hit = findNode(rendered, pred);
    if (hit) return hit;
  }
  const children = el.props?.children;
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr.flat(Infinity)) {
    const hit = findNode(c, pred);
    if (hit) return hit;
  }
  return null;
}

const versions = {
  bun: { name: 'bun', available: true, version: '1.2.18', raw: null, installHint: '' },
  claude: { name: 'claude', available: false, version: null, raw: null, installHint: 'curl x | bash' },
  git: { name: 'git', available: true, version: '2.49', raw: null, installHint: '' },
  curl: { name: 'curl', available: true, version: '8.7', raw: null, installHint: '' },
  jq: { name: 'jq', available: false, version: null, raw: null, installHint: '# brew install jq' },
};

const hookData: HookData = {
  path: '/x/.claude/settings.json',
  exists: true, parsed: true, spyglassDir: '/spy',
  events: [{ event: 'PreToolUse', count: 1, expected: true }, { event: 'Stop', count: 0, expected: true }],
  registeredCount: 4, expectedCount: 10, fileSize: 100,
};

const server: ServerInfo = {
  port: 9999, pid: 1234, uptimeSec: 3661, bunVersion: '1.2.18',
  spyglassHome: '/h/.spyglass', logsDir: '/h/.spyglass/logs', cwd: '/proj',
};

const diag: DiagData = {
  versions, hooks: hookData, server,
  graph: {
    mode: 'primary', source: 'file', configFile: '/cfg',
    circuit: { state: 'CLOSED', consecutiveFailures: 0, fallbackRate: 0 },
    sync: { running: true, cursor: 42 }, cacheDir: '/h/.spyglass/graph', cacheSizeBytes: 4096,
  },
  ladybug: { installed: true },
  proxy: { shell: 'zsh', profilePath: '/h/.zshrc', profileExisted: true, installed: true, corrupted: false },
  sqlite: { migration: { version: 3, filename: '003.sql' } },
};

describe('DiagPanelView (settings-view.js:310 innerHTML#3)', () => {
  it('5개 도구 row 렌더(available/미설치)', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    expect(html).toContain('Bun');
    expect(html).toContain('1.2.18');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Git');
  });

  it('미설치 도구(claude) installHint 명령에 inline 복사버튼 노출', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    expect(html).toContain('settings-inline-copy');
    expect(html).toContain('data-copy-text="curl x | bash"');
  });

  it('#-주석 installHint(jq)는 복사버튼 생략(원본 :209)', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    expect(html).not.toContain('data-copy-text="# brew install jq"');
  });

  it('jump 버튼(hooks/sqlite/graph) data-settings-jump 보존', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    expect(html).toContain('data-settings-jump="hooks"');
    expect(html).toContain('data-settings-jump="sqlite"');
    expect(html).toContain('data-settings-jump="graph"');
  });

  it('proxy 설치됨 → jump 버튼 생략(원본 :259-263 installed 분기)', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    // diag.proxy.installed=true → ok 행, jump 버튼 없음
    expect(html).not.toContain('data-settings-jump="proxy"');
  });

  it('proxy 미설치 → jump-proxy 버튼 노출(원본 :269)', () => {
    const notInstalled = { ...diag, proxy: { ...diag.proxy!, installed: false, profileExisted: true, corrupted: false } };
    const html = renderToStaticMarkup(<DiagPanelView data={notInstalled} t={t} />);
    expect(html).toContain('data-settings-jump="proxy"');
  });

  it('jump 버튼 onClick → onJump(tab) 배선(§5.4 cross-tab)', () => {
    let jumped = '';
    const tree = DiagPanelView({ data: diag, t, onJump: (tab) => { jumped = tab; } });
    const btn = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-settings-jump'] === 'hooks');
    expect(btn).not.toBeNull();
    (btn!.props.onClick as () => void)();
    expect(jumped).toBe('hooks');
  });

  it('서버 메타 카드: port/PID/uptime/logsDir', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    expect(html).toContain('9999');
    expect(html).toContain('1234');
    expect(html).toContain('1h 1m'); // formatUptime(3661)
  });
});

describe('HooksPanelView (settings-view.js:471 innerHTML#4)', () => {
  it('통합 헬스 배지(부분 등록 → warn)', () => {
    const html = renderToStaticMarkup(<HooksPanelView hooks={hookData} selectedProfile="full" t={t} />);
    expect(html).toContain('settings-health-badge is-warn');
  });

  it('healthState!==ok 면 프로필 선택 카드 2개(full/minimal) 노출', () => {
    const html = renderToStaticMarkup(<HooksPanelView hooks={hookData} selectedProfile="full" t={t} />);
    expect(html).toContain('data-hook-profile="full"');
    expect(html).toContain('data-hook-profile="minimal"');
    expect(html).toContain('id="hookPreviewBtn"');
    expect(html).toContain('id="hookApplyBtn"');
  });

  it('healthState===ok 면 프로필 카드 숨김(원본 :425)', () => {
    const okHooks: HookData = { ...hookData, registeredCount: 10, expectedCount: 10, spyglassDir: '/spy' };
    const html = renderToStaticMarkup(<HooksPanelView hooks={okHooks} selectedProfile="full" t={t} />);
    expect(html).not.toContain('data-hook-profile');
  });

  it('엔지니어링 카드: 경로 + SPYGLASS_DIR + 이벤트 row 항상 노출', () => {
    const html = renderToStaticMarkup(<HooksPanelView hooks={hookData} selectedProfile="full" t={t} />);
    expect(html).toContain('SPYGLASS_DIR');
    expect(html).toContain('PreToolUse');
    expect(html).toContain('/x/.claude/settings.json');
  });

  it('선택된 프로필 카드만 is-active + aria-checked true', () => {
    const html = renderToStaticMarkup(<HooksPanelView hooks={hookData} selectedProfile="minimal" t={t} />);
    expect(html).toMatch(/data-hook-profile="minimal"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-hook-profile="minimal"/);
  });

  it('프로필 카드 onClick → onSelectProfile(value) 배선', () => {
    let picked = '';
    const tree = HooksPanelView({ hooks: hookData, selectedProfile: 'full', t, onSelectProfile: (p) => { picked = p; } });
    const card = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-hook-profile'] === 'minimal');
    (card!.props.onClick as () => void)();
    expect(picked).toBe('minimal');
  });
});

describe('ServerPanelView (settings-view.js:493 innerHTML#23)', () => {
  const logs: LogsData = {
    dir: '/h/.spyglass/logs',
    files: [{ name: 'app.log', sizeBytes: 2048, mtimeMs: Date.now() - 60_000 }],
  };

  it('서버 정보 row(port/PID/uptime/Bun/cwd)', () => {
    const html = renderToStaticMarkup(<ServerPanelView server={server} logs={logs} t={t} />);
    expect(html).toContain('9999');
    expect(html).toContain('1234');
    expect(html).toContain('1h 1m');
    expect(html).toContain('/proj');
  });

  it('포트 변경 명령 CodeCopyBox(원본 :1483 토글 포트)', () => {
    const html = renderToStaticMarkup(<ServerPanelView server={server} logs={logs} t={t} />);
    // port 9999 → 8888 토글
    expect(html).toContain('SPYGLASS_PORT=8888 bun run dev');
    expect(html).toContain('settings-code-copy');
  });

  it('로그 파일 목록(이름+크기+상대시각)', () => {
    const html = renderToStaticMarkup(<ServerPanelView server={server} logs={logs} t={t} />);
    expect(html).toContain('app.log');
    expect(html).toContain('2.0 KB');
  });

  it('로그 0건 → no-logs 안내', () => {
    const empty: LogsData = { dir: '/h/.spyglass/logs', files: [] };
    const html = renderToStaticMarkup(<ServerPanelView server={server} logs={empty} t={t} />);
    expect(html).toContain('t:ui.settings-view.server.no-logs');
  });
});

// ── P2-07: Graph / SQLite / Proxy ────────────────────────────────────────────
const graphData: GraphData = {
  mode: 'primary', source: 'file', configFile: '/cfg',
  circuit: { state: 'CLOSED', consecutiveFailures: 0, fallbackRate: 0 },
  sync: { running: true, cursor: 42 }, cacheDir: '/h/.spyglass/graph', cacheSizeBytes: 4096,
};
const ladybugInstalled: LadybugStatus = {
  method: 'brew', installed: true, version: '0.16.1', path: '/node_modules/@ladybugdb/core',
  bunAvailable: true, brewAvailable: true, npmAvailable: true,
};
const ladybugMissing: LadybugStatus = {
  method: 'none', installed: false, version: null,
  bunAvailable: false, brewAvailable: true, npmAvailable: true,
};

describe('GraphPanelView (settings-view.js:813 innerHTML#13)', () => {
  it('모드 옵션 카드 3개(off/shadow/primary) + data-graph-mode', () => {
    const html = renderToStaticMarkup(<GraphPanelView graph={graphData} ladybug={ladybugInstalled} t={t} />);
    expect(html).toContain('data-graph-mode="off"');
    expect(html).toContain('data-graph-mode="shadow"');
    expect(html).toContain('data-graph-mode="primary"');
  });

  it('현재 모드 카드만 is-active + aria-checked true', () => {
    const html = renderToStaticMarkup(<GraphPanelView graph={graphData} ladybug={ladybugInstalled} t={t} />);
    expect(html).toMatch(/data-graph-mode="primary"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-graph-mode="primary"/);
  });

  it('Ladybug 설치됨 → 설치 카드 숨김(원본 :865-868), 버튼 없음', () => {
    const html = renderToStaticMarkup(<GraphPanelView graph={graphData} ladybug={ladybugInstalled} t={t} />);
    expect(html).not.toContain('data-ladybug-install');
  });

  it('Ladybug 미설치 + 패키지매니저 가용 → 자동설치 버튼(원본 :874)', () => {
    const html = renderToStaticMarkup(<GraphPanelView graph={graphData} ladybug={ladybugMissing} t={t} />);
    expect(html).toContain('data-ladybug-install="auto"');
  });

  it('mode=off → 헬스 배지 is-off(원본 :819 .is-off CSS)', () => {
    const offGraph = { ...graphData, mode: 'off' };
    const html = renderToStaticMarkup(<GraphPanelView graph={offGraph} ladybug={ladybugInstalled} t={t} />);
    expect(html).toContain('settings-health-badge is-off');
  });

  it('source=env → env override 경고 배너(원본 :755)', () => {
    const envGraph = { ...graphData, source: 'env' as const };
    const html = renderToStaticMarkup(<GraphPanelView graph={envGraph} ladybug={ladybugInstalled} t={t} />);
    expect(html).toContain('settings-warn-banner');
    expect(html).toContain('t:ui.settings-view.graph.env-override-warning');
  });

  it('엔지니어링 카드: circuit/sync/cache row + Ladybug 구현체 노출', () => {
    const html = renderToStaticMarkup(<GraphPanelView graph={graphData} ladybug={ladybugInstalled} t={t} />);
    expect(html).toContain('CLOSED'); // circuit state
    expect(html).toContain('running'); // sync worker
    expect(html).toContain('4.0 KB'); // formatBytes(4096)
    expect(html).toContain('Homebrew'); // method brew → Homebrew
  });

  it('모드 카드 onClick → onSelectMode(value) 배선', () => {
    let picked = '';
    const tree = GraphPanelView({ graph: graphData, ladybug: ladybugInstalled, t, onSelectMode: (m) => { picked = m; } });
    const card = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-graph-mode'] === 'shadow');
    (card!.props.onClick as () => void)();
    expect(picked).toBe('shadow');
  });

  it('자동설치 버튼 onClick → onInstall(auto) 배선', () => {
    let strategy = '';
    const tree = GraphPanelView({ graph: graphData, ladybug: ladybugMissing, t, onInstall: (s) => { strategy = s; } });
    const btn = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-ladybug-install'] === 'auto');
    (btn!.props.onClick as () => void)();
    expect(strategy).toBe('auto');
  });
});

describe('SqlitePanelView (settings-view.js:1111 innerHTML#17)', () => {
  const cliAvail: SqliteInfo = {
    dbPath: '/h/.spyglass/spyglass.db', dbSizeBytes: 8192,
    migration: { version: 3, filename: '003_add_index.sql' },
    cliVersion: { name: 'sqlite3', available: true, version: '3.43', raw: '3.43', installHint: '' },
  };
  const cliMissing: SqliteInfo = {
    ...cliAvail,
    cliVersion: { name: 'sqlite3', available: false, version: null, raw: null, installHint: 'brew install sqlite' },
  };

  it('헬스 배지 항상 is-ok(Bun 내장, 원본 :1116)', () => {
    const html = renderToStaticMarkup(<SqlitePanelView info={cliAvail} t={t} />);
    expect(html).toContain('settings-health-badge is-ok');
  });

  it('DB 파일 경로 + 크기 + 마이그레이션 version/filename', () => {
    const html = renderToStaticMarkup(<SqlitePanelView info={cliAvail} t={t} />);
    expect(html).toContain('/h/.spyglass/spyglass.db');
    expect(html).toContain('8.0 KB'); // formatBytes(8192)
    expect(html).toContain('v3');
    expect(html).toContain('003_add_index.sql');
  });

  it('CLI 설치됨 → 버전 노출, 복사버튼 없음', () => {
    const html = renderToStaticMarkup(<SqlitePanelView info={cliAvail} t={t} />);
    expect(html).toContain('3.43');
    expect(html).not.toContain('data-copy-text="brew install sqlite"');
  });

  it('CLI 미설치 → brew install + inline 복사버튼(원본 :1106)', () => {
    const html = renderToStaticMarkup(<SqlitePanelView info={cliMissing} t={t} />);
    expect(html).toContain('brew install sqlite');
    expect(html).toContain('data-copy-text="brew install sqlite"');
  });

  it('cliVersion=null → CLI 카드 자체 생략(원본 :1138)', () => {
    const noCli: SqliteInfo = { ...cliAvail, cliVersion: null };
    const html = renderToStaticMarkup(<SqlitePanelView info={noCli} t={t} />);
    expect(html).not.toContain('t:ui.settings-view.sqlite.cli-title');
  });
});

describe('ProxyPanelView (settings-view.js:1285 innerHTML#18)', () => {
  const snippet: ProxySnippet = { shell: 'zsh', port: 9999, snippet: 'claude() {\n  ...\n}' };
  function pstatus(p: Partial<ProxyStatus>): ProxyStatus {
    return { shell: 'zsh', profilePath: '/h/.zshrc', profileExisted: true, installed: false, corrupted: false, hasMarkerOpen: false, hasMarkerClose: false, ...p };
  }

  it('셸 옵션 카드 4개(auto/zsh/bash/fish) + data-proxy-shell', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({})} snippet={snippet} selectedShell="auto" t={t} />);
    expect(html).toContain('data-proxy-shell="auto"');
    expect(html).toContain('data-proxy-shell="zsh"');
    expect(html).toContain('data-proxy-shell="bash"');
    expect(html).toContain('data-proxy-shell="fish"');
  });

  it('미설치 → 자동등록 버튼 노출(원본 :1315)', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({ installed: false })} snippet={snippet} selectedShell="auto" t={t} />);
    expect(html).toContain('id="proxyInstallBtn"');
  });

  it('설치됨(ok) → 자동등록 버튼 숨김(원본 :1313)', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({ installed: true, hasMarkerOpen: true, hasMarkerClose: true })} snippet={snippet} selectedShell="auto" t={t} />);
    expect(html).not.toContain('id="proxyInstallBtn"');
    expect(html).toContain('settings-health-badge is-ok');
  });

  it('손상(corrupted) → 헬스 ✕ is-warn 톤(원본 :1201,1205)', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({ corrupted: true, hasMarkerOpen: true })} snippet={snippet} selectedShell="auto" t={t} />);
    expect(html).toContain('✕');
    expect(html).toContain('settings-health-badge is-warn');
  });

  it('스니펫 미리보기 코드박스 — 마커 페어 포함(원본 :1240,1275)', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({})} snippet={snippet} selectedShell="zsh" t={t} />);
    expect(html).toContain('# &gt;&gt;&gt; spyglass proxy &gt;&gt;&gt;');
    expect(html).toContain('# &lt;&lt;&lt; spyglass proxy &lt;&lt;&lt;');
    expect(html).toContain('settings-code-copy');
  });

  it('마커 검출 row(open/close) + Port row(원본 :1259-1271)', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({ hasMarkerOpen: true, hasMarkerClose: false })} snippet={snippet} selectedShell="zsh" t={t} />);
    expect(html).toContain('9999'); // Port
    expect(html).toContain('t:ui.settings-view.proxy.marker-found');
    expect(html).toContain('t:ui.settings-view.proxy.marker-not-found');
  });

  it('선택 셸만 is-active', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({})} snippet={snippet} selectedShell="bash" t={t} />);
    expect(html).toMatch(/data-proxy-shell="bash"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-proxy-shell="bash"/);
  });

  it('셸 카드 onClick → onSelectShell(value) 배선', () => {
    let picked = '';
    const tree = ProxyPanelView({ status: pstatus({}), snippet, selectedShell: 'auto', t, onSelectShell: (s) => { picked = s; } });
    const card = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-proxy-shell'] === 'fish');
    (card!.props.onClick as () => void)();
    expect(picked).toBe('fish');
  });

  it('자동등록 버튼 onClick → onInstall() 배선', () => {
    let installed = false;
    const tree = ProxyPanelView({ status: pstatus({ installed: false }), snippet, selectedShell: 'auto', t, onInstall: () => { installed = true; } });
    const btn = findNode(tree, (el) => (el.props as Record<string, unknown>).id === 'proxyInstallBtn');
    (btn!.props.onClick as () => void)();
    expect(installed).toBe(true);
  });
});
