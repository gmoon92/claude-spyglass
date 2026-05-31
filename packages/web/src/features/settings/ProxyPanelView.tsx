/**
 * features/settings/ProxyPanelView.tsx — Proxy 설정 프레젠테이션 뷰 (P2-07, innerHTML#18 :1285)
 *
 * 원본: settings-view.js renderProxySection(:1168-1340). 데이터 페칭과 분리된 *순수 뷰* —
 *   proxy/status + proxy/snippet 을 prop 으로 받아 헬스 배지 + health-target 경로 + 셸 옵션 카드
 *   4개 + 자동 등록 버튼 + 엔지니어링 카드(마커 검출 + 스니펫 미리보기 코드박스)를 그린다.
 *   install/restore 핸들러·result 슬롯은 컨테이너(ProxyPanel)가 주입(§5.2).
 *
 * 무전역: i18n 은 t 콜백. 셸 선택은 onSelectShell(value) 통지(controlled, 원본 명령형 :1331).
 *   공용 leaf 재사용: HealthBadge / OptionCard / SettingsRow / CodeCopyBox / TooltipHost(아키텍처 §1.1).
 *
 * @module features/settings/ProxyPanelView
 */
import type { ReactNode } from 'react';
import { CodeCopyBox } from '../../components/settings/CodeCopyBox';
import { HealthBadge } from '../../components/settings/HealthBadge';
import { OptionCard } from '../../components/settings/OptionCard';
import { SettingsRow } from '../../components/settings/SettingsRow';
import { TooltipHost } from '../../components/settings/TooltipHost';
import { proxyHealthBadgeVariant, proxyHealthIcon, proxyHealthState } from './logic';
import type { ProxyShell, ProxySnippet, ProxyStatus } from './types';

/** 마커 페어 — 원본 :1238-1239 상수 1:1. */
const MARKER_OPEN = '# >>> spyglass proxy >>>';
const MARKER_CLOSE = '# <<< spyglass proxy <<<';

export interface ProxyPanelViewProps {
  status: ProxyStatus;
  snippet: ProxySnippet;
  /** 현재 선택 셸(controlled, 원본 _proxyShell :1160). */
  selectedShell: ProxyShell;
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** 셸 카드 선택 통지 — 호출처가 재페치(원본 :1331 재렌더). */
  onSelectShell?: (shell: ProxyShell) => void;
  /** 자동 등록 통지(원본 onProxyInstall :1348). */
  onInstall?: () => void;
  /** 스니펫 복사 통지(무전역 clipboard). */
  onCopy?: (text: string) => void;
  /** install/restore result 슬롯(#proxyResult, §5.2). */
  result?: ReactNode;
}

const SHELLS: ProxyShell[] = ['auto', 'zsh', 'bash', 'fish'];

export function ProxyPanelView({
  status,
  snippet,
  selectedShell,
  t,
  onSelectShell,
  onInstall,
  onCopy,
  result,
}: ProxyPanelViewProps) {
  const state = proxyHealthState(status);
  const healthLabel = t(`ui.settings-view.proxy.health.${state}`, { shell: status.shell });
  const fullSnippet = `${MARKER_OPEN}\n${snippet.snippet}\n${MARKER_CLOSE}`;

  return (
    <>
      <h3 className="settings-section-title">{t('ui.settings-view.proxy.title')}</h3>

      <div className="settings-card">
        <HealthBadge variant={proxyHealthBadgeVariant(state)} icon={proxyHealthIcon(state)} label={healthLabel} />
        {/* 백엔드가 본 경로 — "왜 미설치인지" 즉시 진단(원본 :1296-1300). */}
        <div className="settings-health-target">
          {t('ui.settings-view.proxy.health-target')} <code>{status.profilePath}</code>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-title">{t('ui.settings-view.proxy.shell-pick-title')}</div>
        <div className="settings-card-sub">{t('ui.settings-view.proxy.intro')}</div>
        <div className="settings-option-grid" role="radiogroup" aria-label={t('ui.settings-view.proxy.shell-pick-title')}>
          {SHELLS.map((s) => (
            <OptionCard
              key={s}
              dataAttr="proxy-shell"
              value={s}
              active={selectedShell === s}
              label={t(`ui.settings-view.proxy.shells.${s}.label`)}
              desc={t(`ui.settings-view.proxy.shells.${s}.desc`)}
              tooltip={t(`ui.settings-view.proxy.shells.${s}.tooltip`)}
              onSelect={(v) => onSelectShell?.(v as ProxyShell)}
            />
          ))}
        </div>
        {/* 자동 등록 — 이미 설치(ok)면 버튼+안내 숨김(원본 :1313). */}
        {state !== 'ok' && (
          <>
            <div className="settings-actions">
              <button className="settings-action-btn settings-action-primary" id="proxyInstallBtn" onClick={onInstall}>
                {t('ui.settings-view.proxy.install')}
              </button>
            </div>
            <div className="settings-card-sub settings-action-help">{t('ui.settings-view.proxy.action-help')}</div>
          </>
        )}
        <div className="settings-result" id="proxyResult">{result}</div>
      </div>

      {/* 엔지니어링 카드 — 마커 검출 + 스니펫 미리보기(원본 :1242-1283). */}
      <div className="settings-card">
        <div className="settings-card-title">
          {t('ui.settings-view.proxy.engineering-title')}{' '}
          <TooltipHost text={t('ui.settings-view.proxy.marker-explain-body')} />
        </div>

        <SettingsRow label={t('ui.settings-view.proxy.detected-shell')} status="ok" value={status.shell} />
        <SettingsRow
          label={t('ui.settings-view.proxy.profile-path')}
          status={status.profileExisted ? 'ok' : 'warn'}
          value={status.profileExisted ? t('ui.settings-view.proxy.profile-exists') : t('ui.settings-view.proxy.profile-not-found')}
          tail={<code className="settings-meta">{status.profilePath}</code>}
        />
        <SettingsRow label="Port" status="ok" value={String(snippet.port)} />
        <SettingsRow
          label={t('ui.settings-view.proxy.marker-open-label')}
          status={status.hasMarkerOpen ? 'ok' : 'warn'}
          value={status.hasMarkerOpen ? t('ui.settings-view.proxy.marker-found') : t('ui.settings-view.proxy.marker-not-found')}
          tail={<code className="settings-meta">{MARKER_OPEN}</code>}
        />
        <SettingsRow
          label={t('ui.settings-view.proxy.marker-close-label')}
          status={status.hasMarkerClose ? 'ok' : 'warn'}
          value={status.hasMarkerClose ? t('ui.settings-view.proxy.marker-found') : t('ui.settings-view.proxy.marker-not-found')}
          tail={<code className="settings-meta">{MARKER_CLOSE}</code>}
        />

        <div className="settings-card-sub" style={{ margin: '12px 0 6px' }}>{t('ui.settings-view.proxy.preview-summary')}</div>
        <CodeCopyBox code={fullSnippet} copyLabel={t('ui.settings-view.proxy.copy')} onCopy={onCopy} />
        <div className="settings-card-sub">{t('ui.settings-view.proxy.outro')}</div>
      </div>
    </>
  );
}
