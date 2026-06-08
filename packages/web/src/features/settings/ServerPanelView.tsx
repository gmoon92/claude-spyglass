/**
 * features/settings/ServerPanelView.tsx — 서버/로그 프레젠테이션 뷰 (P2-06, innerHTML#23 :493)
 *
 * 원본: settings-view.js renderServerSection(:1460-1523). 읽기 전용 — 서버 정보 + 포트 변경 명령
 *   복사 + 로그 목록. 아키텍처 §4.3: Server 는 diag 와 같은 소스라 P2-06 귀속.
 *
 * 무전역: i18n 은 t 콜백. 포트 변경 명령은 CodeCopyBox(onCopy 통지). 포트 토글 규칙(:1483)
 *   9999↔8888 보존.
 *
 * @module features/settings/ServerPanelView
 */
import { useTranslation } from 'react-i18next';
import { CodeCopyBox } from '../../components/settings/CodeCopyBox';
import { SettingsRow } from '../../components/settings/SettingsRow';
import { formatBytes, formatRelTime, formatUptime } from '../../lib/settings-format';
import type { LogsData, ServerInfo } from './types';

export interface ServerPanelViewProps {
  server: ServerInfo;
  logs: LogsData;
  onCopy?: (text: string) => void;
}

export function ServerPanelView({ server: s, logs, onCopy }: ServerPanelViewProps) {
  const { t } = useTranslation();
  // 포트 토글(원본 :1483): 9999면 8888, 아니면 9999.
  const portCmd = `SPYGLASS_PORT=${s.port === 9999 ? 8888 : 9999} bun run dev`;
  const files = logs.files || [];

  return (
    <>
      <h3 className="settings-section-title">{t('ui:settings-view.server.title')}</h3>
      <div className="settings-card">
        <SettingsRow label={t('ui:settings-view.diag.port')} status="ok" value={String(s.port)} />
        <SettingsRow label="PID" status="ok" value={String(s.pid)} />
        <SettingsRow label={t('ui:settings-view.server.uptime')} status="ok" value={formatUptime(s.uptimeSec)} />
        <SettingsRow label="Bun" status="ok" value={s.bunVersion || '?'} />
        <SettingsRow label="cwd" status="ok" value="" tail={<code className="settings-meta">{s.cwd}</code>} />
      </div>
      <div className="settings-card">
        <div className="settings-card-title">{t('ui:settings-view.server.port-change-title')}</div>
        <div className="settings-card-sub">{t('ui:settings-view.server.port-change-hint')}</div>
        <CodeCopyBox code={portCmd} copyLabel={t('ui:settings-view.proxy.copy')} onCopy={onCopy} />
      </div>
      <div className="settings-card">
        <div className="settings-card-title">{t('ui:settings-view.server.logs-title')}</div>
        <div className="settings-card-sub">
          <code>{logs.dir}</code>
        </div>
        <div className="settings-log-list">
          {files.length > 0 ? (
            files.map((f) => (
              <div key={f.name} className="settings-log-row">
                <code className="settings-log-name">{f.name}</code>
                <span className="settings-meta">{formatBytes(f.sizeBytes)}</span>
                <span className="settings-meta">{formatRelTime(f.mtimeMs)}</span>
              </div>
            ))
          ) : (
            <div className="settings-meta">{t('ui:settings-view.server.no-logs')}</div>
          )}
        </div>
      </div>
    </>
  );
}
