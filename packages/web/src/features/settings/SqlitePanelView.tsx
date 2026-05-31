/**
 * features/settings/SqlitePanelView.tsx — SQLite 설정 프레젠테이션 뷰 (P2-07, innerHTML#17 :1111)
 *
 * 원본: settings-view.js renderSqliteSection(:1062-1154). 읽기 전용 — Bun 내장 SQLite 라 헬스는
 *   항상 ✓. DB 파일(경로+크기) + 마이그레이션(version+filename) + 외부 sqlite3 CLI(선택).
 *   CLI 미설치 시 `brew install sqlite` + inline 복사 버튼(원본 :1106).
 *
 * 무전역: i18n 은 t 콜백. CLI 명령 복사는 InlineCopyButton(onCopy 통지). 공용 leaf 재사용:
 *   HealthBadge / SettingsRow / InlineCopyButton(아키텍처 §1.1).
 *
 * @module features/settings/SqlitePanelView
 */
import { HealthBadge } from '../../components/settings/HealthBadge';
import { InlineCopyButton } from '../../components/settings/InlineCopyButton';
import { SettingsRow } from '../../components/settings/SettingsRow';
import { formatBytes } from '../../lib/settings-format';
import type { SqliteInfo } from './types';

export interface SqlitePanelViewProps {
  info: SqliteInfo;
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** CLI 명령 복사 통지(무전역 clipboard). */
  onCopy?: (text: string) => void;
}

export function SqlitePanelView({ info, t, onCopy }: SqlitePanelViewProps) {
  const sizeText = info.dbSizeBytes != null ? formatBytes(info.dbSizeBytes) : '—';
  const migVersion = info.migration?.version;
  const migFilename = info.migration?.filename || '—';
  const cli = info.cliVersion;

  return (
    <>
      <h3 className="settings-section-title">{t('ui.settings-view.sqlite.title')}</h3>

      <div className="settings-card">
        {/* Bun 내장 SQLite — 항상 ✓ 정상(원본 :1116). */}
        <HealthBadge variant="ok" icon="✓" label={t('ui.settings-view.sqlite.health-ok')} />
        <div className="settings-card-sub">{t('ui.settings-view.sqlite.health-hint')}</div>
      </div>

      <div className="settings-card">
        <div className="settings-card-title">{t('ui.settings-view.sqlite.db-file-title')}</div>
        <SettingsRow
          label={t('ui.settings-view.sqlite.path-label')}
          status="ok"
          value=""
          tail={<code className="settings-meta">{info.dbPath || ''}</code>}
        />
        <SettingsRow label={t('ui.settings-view.sqlite.size-label')} status="ok" value={sizeText} />
      </div>

      <div className="settings-card">
        <div className="settings-card-title">{t('ui.settings-view.sqlite.migration-title')}</div>
        <SettingsRow
          label={t('ui.settings-view.sqlite.migration-version-label')}
          status={migVersion != null ? 'ok' : 'warn'}
          value={migVersion != null ? `v${migVersion}` : '—'}
          tail={<code className="settings-meta">{migFilename}</code>}
        />
      </div>

      {/* sqlite3 외부 CLI 카드 — cliVersion 이 있을 때만(원본 :1138). */}
      {cli && (
        <div className="settings-card">
          <div className="settings-card-title">{t('ui.settings-view.sqlite.cli-title')}</div>
          <div className="settings-card-sub">{t('ui.settings-view.sqlite.cli-hint')}</div>
          {cli.available ? (
            <SettingsRow
              label={t('ui.settings-view.sqlite.cli-label')}
              status="ok"
              value={cli.version || cli.raw || '?'}
              tail={<code className="settings-meta">sqlite3</code>}
            />
          ) : (
            <SettingsRow
              label={t('ui.settings-view.sqlite.cli-label')}
              status="warn"
              value={t('ui.settings-view.diag.missing')}
              tail={
                <>
                  <code className="settings-cmd">brew install sqlite</code>
                  <InlineCopyButton text="brew install sqlite" title={t('ui.settings-view.proxy.copy')} onCopy={onCopy} />
                </>
              }
            />
          )}
        </div>
      )}
    </>
  );
}
