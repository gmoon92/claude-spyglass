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
import { StoragePanelView } from '../StoragePanelView';
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
    configFile: '/cfg',
    circuit: { state: 'CLOSED', consecutiveFailures: 0, fallbackRate: 0 },
    sync: { running: true, cursor: 42 }, cacheDir: '/h/.spyglass/graph', cacheSizeBytes: 4096,
  },
  ladybug: { installed: true },
  proxy: { shell: 'zsh', profilePath: '/h/.zshrc', profileExisted: true, installed: true, corrupted: false },
  sqlite: { migration: { version: 3, filename: '003.sql' } },
  retention: { days: 30 },
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

  const countJumps = (html: string, tab: string) =>
    (html.match(new RegExp(`data-settings-jump="${tab}"`, 'g')) ?? []).length;

  it('jump 버튼(integration/storage) data-settings-jump 보존 — Hook·Proxy→integration, SQLite·Graph→storage', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    expect(html).toContain('data-settings-jump="integration"'); // hook row
    expect(html).toContain('data-settings-jump="storage"');
    // 통합으로 hooks/proxy/sqlite/graph 개별 jump 타깃은 사라짐.
    expect(html).not.toContain('data-settings-jump="hooks"');
    expect(html).not.toContain('data-settings-jump="proxy"');
  });

  it('모든 점프 라벨은 "페이지 이동"으로 통일 (jump-page 단일 문구)', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    // 4개 행(proxy/hook/sqlite/graph) 모두 동일 라벨 키 사용.
    const labels = html.match(/t:ui\.settings-view\.diag\.jump-page/g) ?? [];
    expect(labels.length).toBe(4);
    // 옛 per-destination 라벨(연동/저장소 개별 문구) 미사용.
    expect(html).not.toContain('jump-integration');
    expect(html).not.toContain('jump-storage');
    expect(html).not.toContain('jump-hooks');
    expect(html).not.toContain('jump-proxy');
  });

  it('Hook·Proxy→integration, SQLite·Graph→storage 점프 타깃 유지(설치 상태 무관)', () => {
    expect(countJumps(renderToStaticMarkup(<DiagPanelView data={diag} t={t} />), 'integration')).toBe(2);
    expect(countJumps(renderToStaticMarkup(<DiagPanelView data={diag} t={t} />), 'storage')).toBe(2);
  });

  it('진단 행 메트릭(10/10, zsh, 마이그레이션 v/파일명) 제거 — 점프 링크만', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    expect(html).not.toContain(`${hookData.registeredCount}/${hookData.expectedCount}`); // 10/10 류 제거
    expect(html).not.toContain('003.sql'); // 마이그레이션 파일명 제거
    // proxy installed shell(zsh) 메트릭 제거 — diag.proxy.shell.
    expect(html).not.toContain('>zsh<');
  });

  it('jump 버튼 onClick → onJump(tab) 배선(§5.4 cross-tab)', () => {
    let jumped = '';
    const tree = DiagPanelView({ data: diag, t, onJump: (tab) => { jumped = tab; } });
    const btn = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-settings-jump'] === 'integration');
    expect(btn).not.toBeNull();
    (btn!.props.onClick as () => void)();
    expect(jumped).toBe('integration');
  });

  it('서버 메타 카드: port/PID/uptime/logsDir', () => {
    const html = renderToStaticMarkup(<DiagPanelView data={diag} t={t} />);
    expect(html).toContain('9999');
    expect(html).toContain('1234');
    expect(html).toContain('1h 1m'); // formatUptime(3661)
  });
});

describe('HooksPanelView (컴팩트 — full 단일·원클릭·아코디언)', () => {
  it('미설치/부분 등록 → 컴팩트 상태 warn + [자동 설치] 버튼(onInstall 제공 시)', () => {
    const html = renderToStaticMarkup(<HooksPanelView hooks={hookData} t={t} onInstall={() => {}} />);
    expect(html).toContain('settings-inline-status is-warn');
    expect(html).toContain('id="hookApplyBtn"');
    // 프로필 선택/미니멀·큰 배지·미리보기 버튼 제거됨.
    expect(html).not.toContain('data-hook-profile');
    expect(html).not.toContain('settings-health-badge');
    expect(html).not.toContain('id="hookPreviewBtn"');
  });

  it('onInstall 없으면 버튼 숨김 (통합 설치 모드 — 상태만)', () => {
    const html = renderToStaticMarkup(<HooksPanelView hooks={hookData} t={t} />);
    expect(html).toContain('settings-inline-status');
    expect(html).not.toContain('id="hookApplyBtn"');
  });

  it('전 이벤트 등록(ok) → 상태 ok + [재설치] 라벨', () => {
    const okHooks: HookData = { ...hookData, registeredCount: 10, expectedCount: 10, spyglassDir: '/spy' };
    const html = renderToStaticMarkup(<HooksPanelView hooks={okHooks} t={t} onInstall={() => {}} />);
    expect(html).toContain('settings-inline-status is-ok');
    expect(html).toContain('t:ui.settings-view.hooks.reinstall');
  });

  it('상세 진단은 아코디언(details) 안에 — 경로 + SPYGLASS_DIR + 이벤트 row', () => {
    const html = renderToStaticMarkup(<HooksPanelView hooks={hookData} t={t} />);
    expect(html).toContain('settings-engineering'); // <details>
    expect(html).toContain('SPYGLASS_DIR');
    expect(html).toContain('PreToolUse');
    expect(html).toContain('/x/.claude/settings.json');
  });

  it('자동 설치 버튼 onClick → onInstall() 배선', () => {
    let installed = false;
    const tree = HooksPanelView({ hooks: hookData, t, onInstall: () => { installed = true; } });
    const btn = findNode(tree, (el) => (el.props as Record<string, unknown>).id === 'hookApplyBtn');
    (btn!.props.onClick as () => void)();
    expect(installed).toBe(true);
  });

  it('disabled(미리보기) → 버튼 비활성', () => {
    const tree = HooksPanelView({ hooks: hookData, t, onInstall: () => {}, disabled: true });
    const btn = findNode(tree, (el) => (el.props as Record<string, unknown>).id === 'hookApplyBtn');
    expect((btn!.props as Record<string, unknown>).disabled).toBe(true);
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

// ── Storage 통합 패널 (SQLite + Graph) / Proxy ───────────────────────────────
const graphData: GraphData = {
  configFile: '/cfg',
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
const sqliteInfo: SqliteInfo = {
  dbPath: '/h/.spyglass/spyglass.db', dbSizeBytes: 8192,
  migration: { version: 3, filename: '003_add_index.sql' },
  cliVersion: { name: 'sqlite3', available: true, version: '3.43', raw: '3.43', installHint: '' },
};

describe('StoragePanelView (SQLite + Graph 통합)', () => {
  it('요약 카드: 총 용량 = SQLite + Graph 합 + 비율 바', () => {
    const html = renderToStaticMarkup(
      <StoragePanelView sqlite={sqliteInfo} graph={graphData} ladybug={ladybugInstalled} retentionDays={30} t={t} />,
    );
    // 8192 + 4096 = 12288 → 12.0 KB
    expect(html).toContain('12.0 KB');
    expect(html).toContain('storage-usage-bar');
  });

  it('보관 기간 노출(diag.retention.days)', () => {
    const html = renderToStaticMarkup(
      <StoragePanelView sqlite={sqliteInfo} graph={graphData} ladybug={ladybugInstalled} retentionDays={30} t={t} />,
    );
    expect(html).toContain('t:ui.settings-view.storage.retention-days');
  });

  it('대화·이벤트 기록(SQLite) 섹션: 경로 + 크기 + 마이그레이션 + 엔진 스펙', () => {
    const html = renderToStaticMarkup(
      <StoragePanelView sqlite={sqliteInfo} graph={graphData} ladybug={ladybugInstalled} retentionDays={30} t={t} />,
    );
    expect(html).toContain('/h/.spyglass/spyglass.db');
    expect(html).toContain('8.0 KB'); // formatBytes(8192)
    expect(html).toContain('v3');
    expect(html).toContain('003_add_index.sql');
    expect(html).toContain('t:ui.settings-view.storage.rdb.engine-value'); // 기술 스펙 행
  });

  it('관계 흐름 그래프(Graph) 섹션: 친화적 상태값 + Ladybug 스펙. raw circuit/cursor·모드·env 배너 없음', () => {
    const html = renderToStaticMarkup(
      <StoragePanelView sqlite={sqliteInfo} graph={graphData} ladybug={ladybugInstalled} retentionDays={30} t={t} />,
    );
    expect(html).toContain('t:ui.settings-view.storage.graph.connection-ok'); // 연결 정상 (CLOSED → 친화적)
    expect(html).toContain('t:ui.settings-view.storage.graph.sync-on'); // 동기화 작동 중 (running → 친화적)
    expect(html).toContain('4.0 KB'); // formatBytes(4096) 캐시 크기
    expect(html).toContain('Ladybug v0.16.1'); // 엔진 스펙 행
    // 엔지니어링 raw 수치/용어는 표면에서 제거.
    expect(html).not.toContain('CLOSED');
    expect(html).not.toContain('fallback');
    expect(html).not.toContain('cursor');
    // 모드 선택/ env override 개념 제거 검증.
    expect(html).not.toContain('data-graph-mode');
    expect(html).not.toContain('env-override-warning');
  });

  it('Ladybug 설치됨 → 설치 카드 숨김(자동 설치 보장)', () => {
    const html = renderToStaticMarkup(
      <StoragePanelView sqlite={sqliteInfo} graph={graphData} ladybug={ladybugInstalled} retentionDays={30} t={t} />,
    );
    expect(html).not.toContain('data-ladybug-install');
  });

  it('Ladybug 미설치 + 패키지매니저 가용 → 자동설치 버튼', () => {
    const html = renderToStaticMarkup(
      <StoragePanelView sqlite={sqliteInfo} graph={graphData} ladybug={ladybugMissing} retentionDays={30} t={t} />,
    );
    expect(html).toContain('data-ladybug-install="auto"');
  });

  it('SQLite CLI 미설치 → brew install + inline 복사버튼', () => {
    const cliMissing: SqliteInfo = {
      ...sqliteInfo,
      cliVersion: { name: 'sqlite3', available: false, version: null, raw: null, installHint: 'brew install sqlite' },
    };
    const html = renderToStaticMarkup(
      <StoragePanelView sqlite={cliMissing} graph={graphData} ladybug={ladybugInstalled} retentionDays={30} t={t} />,
    );
    expect(html).toContain('data-copy-text="brew install sqlite"');
  });

  it('자동설치 버튼 onClick → onInstall(auto) 배선', () => {
    let strategy = '';
    const tree = StoragePanelView({ sqlite: sqliteInfo, graph: graphData, ladybug: ladybugMissing, retentionDays: 30, t, onInstall: (s) => { strategy = s; } });
    const btn = findNode(tree, (el) => (el.props as Record<string, unknown>)['data-ladybug-install'] === 'auto');
    (btn!.props.onClick as () => void)();
    expect(strategy).toBe('auto');
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

  it('미설치 + onInstall 제공 → 자동등록 버튼 노출', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({ installed: false })} snippet={snippet} selectedShell="auto" t={t} onInstall={() => {}} />);
    expect(html).toContain('id="proxyInstallBtn"');
  });

  it('onInstall 없으면 버튼 숨김 (통합 설치 모드 — 상태만)', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({ installed: false })} snippet={snippet} selectedShell="auto" t={t} />);
    expect(html).not.toContain('id="proxyInstallBtn"');
    expect(html).toContain('settings-inline-status');
  });

  it('설치됨(ok) + onInstall → 컴팩트 상태 ok + [재설치] 버튼(큰 배지 제거)', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({ installed: true, hasMarkerOpen: true, hasMarkerClose: true })} snippet={snippet} selectedShell="auto" t={t} onInstall={() => {}} />);
    expect(html).toContain('settings-inline-status is-ok');
    expect(html).toContain('t:ui.settings-view.proxy.reinstall');
    expect(html).not.toContain('settings-health-badge');
  });

  it('손상(corrupted) → 인라인 상태 ✕ warn 톤', () => {
    const html = renderToStaticMarkup(<ProxyPanelView status={pstatus({ corrupted: true, hasMarkerOpen: true })} snippet={snippet} selectedShell="auto" t={t} />);
    expect(html).toContain('✕');
    expect(html).toContain('settings-inline-status is-warn');
    expect(html).not.toContain('settings-health-badge');
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
