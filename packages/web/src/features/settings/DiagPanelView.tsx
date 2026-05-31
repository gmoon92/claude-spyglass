/**
 * features/settings/DiagPanelView.tsx — 진단 카드 프레젠테이션 뷰 (P2-06, innerHTML#3 :310)
 *
 * 원본: settings-view.js renderDiagSection(:176-368). 데이터 페칭(useSettingsDiag, AbortController)과
 *   분리된 *순수 뷰* — DiagData 를 prop 으로 받아 3개 카드(버전/통합진단/서버)를 그린다.
 *   effect 미실행 환경(renderToStaticMarkup)에서 테스트 가능(panels.test.tsx).
 *
 * 무전역: i18n 은 t 콜백 prop 주입(FilterBar 선례). jump 버튼은 onJump(tab) 통지(§5.4 cross-tab —
 *   호출처 SettingsView 가 스토어 activeTab 갱신). inline 복사는 onCopy(text) 통지(무전역 clipboard).
 *
 * @module features/settings/DiagPanelView
 */
import { SettingsRow } from '../../components/settings/SettingsRow';
import { InlineCopyButton } from '../../components/settings/InlineCopyButton';
import { formatUptime } from '../../lib/settings-format';
import { diagHookRowStatus, isCommentHint, versionRowStatus } from './logic';
import type { DiagData, VersionInfo, VersionKey } from './types';

export interface DiagPanelViewProps {
  data: DiagData;
  /** i18n 라벨러(미존재 키는 key 그대로 — 원본 t 동일). */
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** jump 버튼 → sub-tab 전환 통지(§5.4). */
  onJump?: (tab: string) => void;
  /** inline 복사 통지(무전역 clipboard). */
  onCopy?: (text: string) => void;
}

/** jump 버튼 — diag 행 tail([→]). data-settings-jump 셀렉터 계약 보존(원본 :253). */
function JumpButton({ tab, label, onJump }: { tab: string; label: string; onJump?: (t: string) => void }) {
  return (
    <button className="settings-jump-btn" data-settings-jump={tab} onClick={() => onJump?.(tab)}>
      {label}
    </button>
  );
}

export function DiagPanelView({ data, t, onJump, onCopy }: DiagPanelViewProps) {
  const { versions, hooks, graph, server } = data;

  // 외부 도구 row(원본 versionRow :202-216) — 미설치+명령형 installHint 면 inline 복사.
  const versionRow = (key: VersionKey, label: string) => {
    const v: VersionInfo = versions[key];
    const status = versionRowStatus(v);
    const valueText = v.available ? v.version || v.raw || '?' : t('ui.settings-view.diag.missing');
    let tail: React.ReactNode = null;
    if (!v.available && v.installHint) {
      const comment = isCommentHint(v.installHint);
      tail = (
        <>
          <code className="settings-cmd">{v.installHint}</code>
          {!comment && (
            <InlineCopyButton text={v.installHint} title={t('ui.settings-view.proxy.copy')} onCopy={onCopy} />
          )}
        </>
      );
    }
    return <SettingsRow label={label} status={status} value={valueText} tail={tail} />;
  };

  // hook 요약 row(원본 :219-240).
  const hookStatus = diagHookRowStatus(hooks);
  const hookValue = hooks.exists
    ? hooks.parsed
      ? hooks.registeredCount === hooks.expectedCount
        ? t('ui.settings-view.diag.configured')
        : hooks.registeredCount === 0
          ? t('ui.settings-view.diag.hook-missing')
          : t('ui.settings-view.diag.hook-partial')
      : t('ui.settings-view.diag.hook-broken')
    : t('ui.settings-view.diag.hook-missing');
  const hookTail = (
    <>
      <JumpButton tab="hooks" label={t('ui.settings-view.diag.jump-hooks')} onJump={onJump} />
      {hooks.exists && hooks.parsed && (
        <span className="settings-meta">{hooks.registeredCount}/{hooks.expectedCount}</span>
      )}
    </>
  );

  // Proxy row(원본 proxyRowHtml :248-271).
  const p = data.proxy;
  const proxyLabel = t('ui.settings-view.diag.proxy-label');
  const proxyJump = <JumpButton tab="proxy" label={t('ui.settings-view.diag.jump-proxy')} onJump={onJump} />;
  let proxyRow: React.ReactNode;
  if (!p) {
    proxyRow = <SettingsRow label={proxyLabel} status="warn" value={t('ui.settings-view.diag.missing')} tail={proxyJump} />;
  } else if (p.corrupted) {
    proxyRow = <SettingsRow label={proxyLabel} status="fail" value={t('ui.settings-view.diag.proxy-corrupted')} tail={proxyJump} />;
  } else if (p.installed) {
    proxyRow = (
      <SettingsRow
        label={proxyLabel}
        status="ok"
        value={t('ui.settings-view.diag.proxy-installed')}
        tail={
          <>
            <span className="settings-meta">{p.shell}</span>
            {p.profilePath && <code className="settings-meta">{p.profilePath}</code>}
          </>
        }
      />
    );
  } else if (!p.profileExisted) {
    proxyRow = <SettingsRow label={proxyLabel} status="warn" value={t('ui.settings-view.diag.proxy-no-profile')} tail={proxyJump} />;
  } else {
    proxyRow = <SettingsRow label={proxyLabel} status="warn" value={t('ui.settings-view.diag.missing')} tail={proxyJump} />;
  }

  // Graph DB 통합 row(원본 :285-340).
  const ladybugInstalled = !!data.ladybug?.installed;
  let graphStatus: 'ok' | 'warn';
  let graphValueText: string;
  if (!ladybugInstalled) {
    graphStatus = 'warn';
    graphValueText = t('ui.settings-view.diag.missing');
  } else if (graph.mode === 'off') {
    graphStatus = 'warn';
    graphValueText = t('ui.settings-view.diag.graph-off');
  } else if (graph.circuit?.state !== 'CLOSED') {
    graphStatus = 'warn';
    graphValueText = t('ui.settings-view.diag.graph-circuit-open');
  } else {
    graphStatus = 'ok';
    graphValueText = t('ui.settings-view.diag.installed');
  }
  const graphSource = graph.source || 'default';
  const graphSourceClass = graphSource === 'env' ? 'is-env' : graphSource === 'file' ? 'is-saved' : 'is-default';
  const graphSourceLabel = t(`ui.settings-view.graph.source.${graphSource === 'file' ? 'saved' : graphSource}`);
  const graphTail = (
    <>
      <JumpButton tab="graph" label={t('ui.settings-view.diag.jump-graph')} onJump={onJump} />
      {ladybugInstalled && (
        <>
          <span className={`settings-source-badge ${graphSourceClass}`} title={graph.configFile || ''}>
            {graphSourceLabel}
          </span>
          <span className="settings-meta">{graph.mode}</span>
        </>
      )}
    </>
  );

  // SQLite row(원본 :325-337).
  const mig = data.sqlite?.migration ?? null;
  const sqliteTail = (
    <>
      <JumpButton tab="sqlite" label={t('ui.settings-view.diag.jump-sqlite')} onJump={onJump} />
      {mig?.version != null && <span className="settings-meta">v{mig.version}</span>}
      {mig?.filename && <code className="settings-meta">{mig.filename}</code>}
    </>
  );

  return (
    <>
      <h3 className="settings-section-title">{t('ui.settings-view.diag.title')}</h3>
      <div className="settings-card">
        {versionRow('bun', 'Bun')}
        {versionRow('claude', 'Claude Code')}
        {versionRow('git', 'Git')}
        {versionRow('curl', 'curl')}
        {versionRow('jq', 'jq')}
      </div>
      <div className="settings-card">
        {/* Row order matches left sub-tab menu: Proxy → Hook → SQLite → Graph DB(원본 :320). */}
        {proxyRow}
        <SettingsRow label={t('ui.settings-view.diag.hook-label')} status={hookStatus} value={hookValue} tail={hookTail} />
        <SettingsRow label="SQLite" status="ok" value={t('ui.settings-view.diag.installed')} tail={sqliteTail} />
        <SettingsRow label="Graph DB" status={graphStatus} value={graphValueText} tail={graphTail} />
      </div>
      <div className="settings-card">
        <SettingsRow label={t('ui.settings-view.diag.port')} status="ok" value={String(server.port)} />
        <SettingsRow
          label="PID"
          status="ok"
          value={String(server.pid)}
          tail={<span className="settings-meta">uptime {formatUptime(server.uptimeSec)}</span>}
        />
        <SettingsRow label={t('ui.settings-view.diag.logs-dir')} status="ok" value={server.logsDir} />
      </div>
    </>
  );
}
