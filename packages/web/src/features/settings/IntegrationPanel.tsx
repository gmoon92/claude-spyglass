/**
 * features/settings/IntegrationPanel.tsx — Hook + Proxy 통합 "연동" sub-tab 컨테이너
 *
 * 분리됐던 Hook 설정·Proxy 설정 두 탭을 단일 "연동(Integration)" 패널로 통합한다.
 *   둘 다 *Claude Code 와 spyglass 를 연동*하는 설정이라 한 화면에 묶는다 —
 *     ① 이벤트 수집(Hook): Claude Code 라이프사이클 이벤트 훅 등록
 *     ② API 메트릭 수집(Proxy): 셸 프록시로 API 레이어 메트릭 수집
 *
 *   기존 HooksPanel/ProxyPanel 컨테이너 로직(페칭·핸들러·result 슬롯)을 한 컨테이너로 합치고
 *   순수 뷰(HooksPanelView/ProxyPanelView)는 그대로 재사용한다.
 *
 * 미리보기(개발용): 상단 토글로 hooks/proxy 상태를 mock(미설치/설치됨)으로 오버라이드해
 *   *시스템 변경 없이* 설치/미설치 UI 를 눈으로 확인한다. preview 모드에서는 실제 설치/적용
 *   핸들러를 no-op 으로 가드해 오작동을 막는다.
 *
 * @module features/settings/IntegrationPanel
 */
import { useCallback, useState, type ReactNode } from 'react';
import { StickyAlert } from '../../components/settings/StickyAlert';
import { HooksPanelView } from './HooksPanelView';
import { ProxyPanelView } from './ProxyPanelView';
import { fetchDiag, hookApply } from './hooks-api';
import { fetchProxySnippet, fetchProxyStatus, proxyInstall } from './graph-api';
import { useAsyncResource } from './use-settings-diag';
import type { ProxyShell, ProxySnippet, ProxyStatus } from './types';

export interface IntegrationPanelProps {
  t: (key: string, vars?: Record<string, unknown>) => string;
  onCopy?: (text: string) => void;
}

/**
 * 설치 진행 스트림 상태 — Ladybug 설치 SSE 와 동일한 "쉘 스크립트 진행" 비주얼.
 *   hook/proxy 설치는 즉시 끝나는 in-process 파일 작업이라 실제 subprocess SSE 는 없지만,
 *   실제 수행 단계를 동일 스타일(install-cmd / install-stream)로 *페이싱 렌더* 해 동일한 UX 제공.
 *   설치 로그 라인은 셸 출력 관례대로 영문 — i18n 미적용(주변 UI 라벨만 i18n).
 */
type StreamLine = { text: string; tone?: 'ok' | 'err' };
type StreamState =
  | { kind: 'idle' }
  | { kind: 'stream'; cmd: string; lines: StreamLine[]; running: boolean }
  | { kind: 'error'; message: string };

/** 진행 라인 간 페이싱(ms) — 쉘 진행처럼 한 줄씩 타이핑되는 효과. */
const STEP_DELAY = 130;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function IntegrationPanel({ t, onCopy }: IntegrationPanelProps) {

  // ── 페칭 ──────────────────────────────────────────────────────────────────
  const hookFetcher = useCallback((signal: AbortSignal) => fetchDiag(signal), []);
  const { status: hookStatus, data: diag, error: hookError, refetch: refetchHooks } = useAsyncResource(hookFetcher);
  const [showRestart, setShowRestart] = useState(false);

  const [selectedShell, setSelectedShell] = useState<ProxyShell>('auto');
  const proxyFetcher = useCallback(
    (signal: AbortSignal): Promise<{ snippet: ProxySnippet; status: ProxyStatus }> =>
      Promise.all([fetchProxySnippet(selectedShell, signal), fetchProxyStatus(selectedShell, signal)]).then(
        ([snippet, status]) => ({ snippet, status }),
      ),
    [selectedShell],
  );
  const { status: proxyFetchStatus, data: proxyData, error: proxyError, refetch: refetchProxy } = useAsyncResource(proxyFetcher);

  // ── 통합 원클릭 설치 — Hook(full) → Proxy 를 하나의 쉘 스크립트 스트림으로 ───────
  const [installStream, setInstallStream] = useState<StreamState>({ kind: 'idle' });

  const onInstallAll = useCallback(async () => {
    const cmd = '$ spyglass install — hook + proxy';
    const lines: StreamLine[] = [];
    const push = async (l: StreamLine, running = true) => {
      await sleep(STEP_DELAY);
      lines.push(l);
      setInstallStream({ kind: 'stream', cmd, lines: [...lines], running });
    };
    setInstallStream({ kind: 'stream', cmd, lines: [], running: true });

    // ── ① Hook (이벤트 수집) ──
    await push({ text: '── hook (event collection) ──' });
    await push({ text: '→ read   ~/.claude/settings.json' });
    await push({ text: '→ merge  full profile (env.SPYGLASS_DIR + hooks)' });
    await push({ text: '→ write  settings.json (atomic)' });
    try {
      const h = await hookApply('full');
      await push({ text: `✓ verify: settings.json ${h.verify === 'ok' ? 'valid JSON' : 'FAILED'}`, tone: h.verify === 'ok' ? 'ok' : 'err' });
      if (h.backupRemoved) await push({ text: '✓ backup removed (confirmed)', tone: 'ok' });
      const total = diag?.hooks.expectedCount ?? 0;
      await push({ text: `✓ hook: ${total}/${total} events registered`, tone: 'ok' });
      if (h.nextAction === 'restart-claude-code') setShowRestart(true);
    } catch (err) {
      await push({ text: `✗ hook: ${err instanceof Error ? err.message : String(err)}`, tone: 'err' }, false);
      refetchHooks();
      return;
    }

    // ── ② Proxy (API 메트릭 수집) ──
    await push({ text: '' });
    await push({ text: '── proxy (api metric collection) ──' });
    await push({ text: '→ detect shell profile' });
    await push({ text: '→ replace marker block' });
    await push({ text: '→ write  profile (atomic)' });
    try {
      const p = await proxyInstall(selectedShell);
      const vtxt = p.verify === 'ok' ? `${p.shell} -n OK` : p.verify === 'skipped' ? 'skipped (shell n/a)' : 'FAILED';
      await push({ text: `✓ verify: ${vtxt}`, tone: p.verify === 'failed' ? 'err' : 'ok' });
      if (p.backupRemoved) await push({ text: '✓ backup removed (confirmed)', tone: 'ok' });
      if (p.legacyUnmarked) await push({ text: '⚠ stray claude() outside markers — manual cleanup advised', tone: 'err' });
      await push({ text: `✓ proxy: ${p.shell} (${p.action})`, tone: 'ok' });
      lines.push({ text: `✓ done — ${p.nextAction}`, tone: 'ok' });
      setInstallStream({ kind: 'stream', cmd, lines: [...lines], running: false });
    } catch (err) {
      lines.push({ text: `✗ proxy: ${err instanceof Error ? err.message : String(err)}`, tone: 'err' });
      setInstallStream({ kind: 'stream', cmd, lines: [...lines], running: false });
    }
    refetchHooks();
    refetchProxy();
  }, [selectedShell, diag, refetchHooks, refetchProxy]);

  // 최초 로드(데이터 없음)에만 loading 셸. 셸 변경 등 *refetch* 시에는 stale 데이터를 유지해
  //   패널을 언마운트하지 않는다 — 그래야 <details> 아코디언 열림 상태가 보존된다(refetch 시
  //   useAsyncResource 가 data 를 비우지 않음). proxyFetchStatus==='loading' 로 게이트하면
  //   셸 선택마다 패널이 통째로 사라졌다 다시 그려져 아코디언이 닫히는 버그가 생긴다.
  const loading = !diag || !proxyData;
  if (loading) {
    return <div className="settings-loading">{t('ui.settings-view.loading')}</div>;
  }
  if (hookStatus === 'error') return <div className="settings-error">⚠ {hookError}</div>;
  if (proxyFetchStatus === 'error') return <div className="settings-error">⚠ {proxyError}</div>;

  // ── 설치 진행 스트림 렌더 — Ladybug SSE 와 동일한 install-cmd / install-stream 스타일 ───
  const streamNode: ReactNode = (() => {
    const s = installStream;
    if (s.kind === 'idle') return null;
    if (s.kind === 'error') return <div className="settings-error">⚠ {s.message}</div>;
    return (
      <>
        <div className="install-cmd">{s.cmd}</div>
        <pre className="install-stream">
          {s.lines.map((l, i) => (
            <span key={i} className={l.tone === 'err' ? 'stream-stderr' : undefined}>{l.text}{'\n'}</span>
          ))}
        </pre>
        {s.running && <div className="install-running">{t('ui.settings-view.proxy.installing')}</div>}
      </>
    );
  })();

  const installing = installStream.kind === 'stream' && installStream.running;

  return (
    <>
      {showRestart && (
        <StickyAlert
          message={t('ui.settings-view.hooks.restart-required-banner')}
          kind="restart"
          onDismissed={() => setShowRestart(false)}
        />
      )}

      {/* 상단 통합 원클릭 설치 카드 — Hook + Proxy 를 한 번에. */}
      <div className="settings-card">
        <div className="storage-section-head">
          <div className="storage-section-head-text">
            <div className="settings-card-title">{t('ui.settings-view.integration.install-title')}</div>
            <div className="settings-card-sub">{t('ui.settings-view.integration.install-sub')}</div>
          </div>
          <button
            type="button"
            className="settings-action-btn settings-action-primary"
            id="integrationInstallBtn"
            onClick={onInstallAll}
            disabled={installing}
          >
            {t('ui.settings-view.integration.install-all')}
          </button>
        </div>
        <div className="settings-result" id="integrationResult">{streamNode}</div>
      </div>

      {/* ① 이벤트 수집 (Hook) — 상태 + 상세 아코디언만(설치는 상단 통합 버튼) */}
      <HooksPanelView hooks={diag.hooks} t={t} />

      {/* ② API 메트릭 수집 (Proxy) — 상태 + 셸 선택/상세 아코디언만 */}
      <ProxyPanelView
        status={proxyData.status}
        snippet={proxyData.snippet}
        selectedShell={selectedShell}
        t={t}
        onSelectShell={setSelectedShell}
        onCopy={onCopy}
      />
    </>
  );
}
