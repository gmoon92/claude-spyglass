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
  const hookTail = <JumpButton tab="integration" label={t('ui.settings-view.diag.jump-page')} onJump={onJump} />;

  // Proxy row(원본 proxyRowHtml :248-271).
  const p = data.proxy;
  const proxyLabel = t('ui.settings-view.diag.proxy-label');
  const proxyJump = <JumpButton tab="integration" label={t('ui.settings-view.diag.jump-page')} onJump={onJump} />;
  let proxyRow: React.ReactNode;
  if (!p) {
    proxyRow = <SettingsRow label={proxyLabel} status="warn" value={t('ui.settings-view.diag.missing')} tail={proxyJump} />;
  } else if (p.corrupted) {
    proxyRow = <SettingsRow label={proxyLabel} status="fail" value={t('ui.settings-view.diag.proxy-corrupted')} tail={proxyJump} />;
  } else if (p.installed) {
    proxyRow = <SettingsRow label={proxyLabel} status="ok" value={t('ui.settings-view.diag.proxy-installed')} tail={proxyJump} />;
  } else if (!p.profileExisted) {
    proxyRow = <SettingsRow label={proxyLabel} status="warn" value={t('ui.settings-view.diag.proxy-no-profile')} tail={proxyJump} />;
  } else {
    proxyRow = <SettingsRow label={proxyLabel} status="warn" value={t('ui.settings-view.diag.missing')} tail={proxyJump} />;
  }

  // 관계 흐름 그래프 통합 row — 그래프는 항상 켜진 상태로 고정(v4.3.x). circuit/설치 기준만 판정.
  const ladybugInstalled = !!data.ladybug?.installed;
  let graphStatus: 'ok' | 'warn';
  let graphValueText: string;
  if (!ladybugInstalled) {
    graphStatus = 'warn';
    graphValueText = t('ui.settings-view.diag.missing');
  } else if (graph.circuit?.state !== 'CLOSED') {
    graphStatus = 'warn';
    graphValueText = t('ui.settings-view.diag.graph-circuit-open');
  } else {
    graphStatus = 'ok';
    graphValueText = t('ui.settings-view.diag.installed');
  }
  const graphTail = <JumpButton tab="storage" label={t('ui.settings-view.diag.jump-page')} onJump={onJump} />;

  // 대화·이벤트 기록(SQLite) row — Storage 탭으로 점프. 마이그레이션 상세(버전/파일명)는
  //   진단을 어수선하게 하므로 *저장소 페이지* 항목으로 이관 — 여기선 점프 링크만.
  const sqliteTail = <JumpButton tab="storage" label={t('ui.settings-view.diag.jump-page')} onJump={onJump} />;

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
