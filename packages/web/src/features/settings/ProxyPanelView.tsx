/**
 * features/settings/ProxyPanelView.tsx — API 메트릭 수집(Proxy) 프레젠테이션 뷰
 *
 * spyglass 가 LISTEN 중일 때만 ANTHROPIC_BASE_URL 을 주입하는 조건부 셸 함수를 자동 등록.
 *   Hook 섹션과 동일한 컴팩트 패턴(비개발자 친화):
 *   - 큰 헬스 배지 제거 → 컴팩트 인라인 상태 + [자동 설치] 버튼 한 줄(셸 자동 감지).
 *   - 셸 직접 선택·마커 진단·스니펫 미리보기는 <details> 아코디언(고급/상세)으로 접어 영역 축소.
 *
 * 멱등성: 백엔드 replaceOrAppendMarkerBlock 이 마커 쌍 사이를 통째 치환 → 재설치해도 마커/함수
 *   중복 0 (in-place). 데이터 페칭과 분리된 *순수 뷰* — 핸들러/result 슬롯은 컨테이너 주입.
 *
 * @module features/settings/ProxyPanelView
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeCopyBox } from '../../components/settings/CodeCopyBox';
import { OptionCard } from '../../components/settings/OptionCard';
import { SettingsRow } from '../../components/settings/SettingsRow';
import { TooltipHost } from '../../components/settings/TooltipHost';
import { proxyHealthState } from './logic';
import type { ProxyShell, ProxySnippet, ProxyStatus } from './types';

/** 마커 페어 — 원본 상수 1:1. */
const MARKER_OPEN = '# >>> spyglass proxy >>>';
const MARKER_CLOSE = '# <<< spyglass proxy <<<';

export interface ProxyPanelViewProps {
  status: ProxyStatus;
  snippet: ProxySnippet;
  selectedShell: ProxyShell;
  onSelectShell?: (shell: ProxyShell) => void;
  onInstall?: () => void;
  installing?: boolean;
  /** 미리보기 모드 등에서 액션 비활성. */
  disabled?: boolean;
  onCopy?: (text: string) => void;
  result?: ReactNode;
}

const SHELLS: ProxyShell[] = ['auto', 'zsh', 'bash', 'fish'];

export function ProxyPanelView({
  status,
  snippet,
  selectedShell,
  onSelectShell,
  onInstall,
  installing,
  disabled,
  onCopy,
  result,
}: ProxyPanelViewProps) {
  const { t: tBase } = useTranslation();
  // react-i18next t → (key, vars)=>string 시그니처 래핑(동적 키·보간 타입 회피, UpdateBadge 선례).
  const t = (key: string, vars?: Record<string, unknown>): string => tBase(key, vars) as unknown as string;
  const state = proxyHealthState(status);
  const installed = state === 'ok';
  const fullSnippet = `${MARKER_OPEN}\n${snippet.snippet}\n${MARKER_CLOSE}`;
  const statusText = installed
    ? t('ui:settings-view.proxy.status-ok', { shell: status.shell })
    : state === 'broken'
    ? t('ui:settings-view.proxy.status-broken')
    : t('ui:settings-view.proxy.status-off');

  return (
    <>
      <h3 className="settings-section-title">{t('ui:settings-view.proxy.title')}</h3>

      <div className="settings-card">
        <div className="settings-card-sub">{t('ui:settings-view.proxy.intro')}</div>

        {/* 컴팩트 상태 (+ onInstall 제공 시에만 설치 버튼 — 통합 설치 모드에선 상태만). */}
        <div className="settings-install-row">
          <span className={`settings-inline-status is-${installed ? 'ok' : 'warn'}`}>
            <span className="settings-inline-status-icon" aria-hidden="true">{installed ? '✓' : state === 'broken' ? '✕' : '⚠'}</span>
            {statusText}
          </span>
          {onInstall && (
            <button
              type="button"
              className="settings-action-btn settings-action-primary"
              id="proxyInstallBtn"
              onClick={onInstall}
              disabled={installing || disabled}
            >
              {installed ? t('ui:settings-view.proxy.reinstall') : t('ui:settings-view.proxy.install')}
            </button>
          )}
        </div>

        {result && <div className="settings-result" id="proxyResult">{result}</div>}

        {/* 상세/고급 — 접기(아코디언): 셸 선택 + 마커 진단 + 스니펫 미리보기. */}
        <details className="settings-engineering">
          <summary>{t('ui:settings-view.proxy.detail-summary')}</summary>

          {/* 셸 직접 선택(기본 자동 감지). */}
          <div className="settings-card-sub" style={{ margin: '6px 0' }}>{t('ui:settings-view.proxy.shell-pick-title')}</div>
          <div className="settings-option-grid" role="radiogroup" aria-label={t('ui:settings-view.proxy.shell-pick-title')}>
            {SHELLS.map((s) => (
              <OptionCard
                key={s}
                dataAttr="proxy-shell"
                value={s}
                active={selectedShell === s}
                label={t(`ui:settings-view.proxy.shells.${s}.label`)}
                desc={t(`ui:settings-view.proxy.shells.${s}.desc`)}
                tooltip={t(`ui:settings-view.proxy.shells.${s}.tooltip`)}
                onSelect={(v) => onSelectShell?.(v as ProxyShell)}
              />
            ))}
          </div>

          {/* 마커 진단. */}
          <div className="settings-card-sub" style={{ margin: '12px 0 4px' }}>
            {t('ui:settings-view.proxy.engineering-title')}{' '}
            <TooltipHost text={t('ui:settings-view.proxy.marker-explain-body')} />
          </div>
          <SettingsRow label={t('ui:settings-view.proxy.detected-shell')} status="ok" value={status.shell} />
          <SettingsRow
            label={t('ui:settings-view.proxy.profile-path')}
            status={status.profileExisted ? 'ok' : 'warn'}
            value={status.profileExisted ? t('ui:settings-view.proxy.profile-exists') : t('ui:settings-view.proxy.profile-not-found')}
            tail={<code className="settings-meta">{status.profilePath}</code>}
          />
          <SettingsRow label="Port" status="ok" value={String(snippet.port)} />
          <SettingsRow
            label={t('ui:settings-view.proxy.marker-open-label')}
            status={status.hasMarkerOpen ? 'ok' : 'warn'}
            value={status.hasMarkerOpen ? t('ui:settings-view.proxy.marker-found') : t('ui:settings-view.proxy.marker-not-found')}
            tail={<code className="settings-meta">{MARKER_OPEN}</code>}
          />
          <SettingsRow
            label={t('ui:settings-view.proxy.marker-close-label')}
            status={status.hasMarkerClose ? 'ok' : 'warn'}
            value={status.hasMarkerClose ? t('ui:settings-view.proxy.marker-found') : t('ui:settings-view.proxy.marker-not-found')}
            tail={<code className="settings-meta">{MARKER_CLOSE}</code>}
          />

          {/* 스니펫 미리보기(수동 설치). */}
          <div className="settings-card-sub" style={{ margin: '12px 0 6px' }}>{t('ui:settings-view.proxy.preview-summary')}</div>
          <CodeCopyBox code={fullSnippet} copyLabel={t('ui:settings-view.proxy.copy')} onCopy={onCopy} />
          <div className="settings-card-sub">{t('ui:settings-view.proxy.outro')}</div>
        </details>
      </div>
    </>
  );
}
