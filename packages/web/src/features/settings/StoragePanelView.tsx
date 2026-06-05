/**
 * features/settings/StoragePanelView.tsx — 통합 Storage 설정 프레젠테이션 뷰
 *
 * 분리됐던 SQLite·Graph DB 두 탭을 단일 "Storage" 패널로 통합한다(storage-redesign 후속).
 *   비개발자는 "SQLite"·"Ladybug" 기술명을 모르므로 *기능 중심 이름*("대화·이벤트 기록",
 *   "관계 흐름 그래프")을 표제로 쓰고, 기술 스펙(엔진/버전/경로)은 하위 상세 행으로 병기한다.
 *   운영 진단(회로 차단기/Sync Worker)도 raw 수치 대신 *친화적 상태값*(정상/문제, 작동 중/멈춤)
 *   으로 노출한다 — cursor/fallback 같은 엔지니어링 디테일은 표면에서 제거.
 *
 * 구성:
 *   1) 요약 카드 — 총 용량 + 비율 바(StorageUsageBar) + 보관 기간.
 *   2) 상세 ①「대화·이벤트 기록」(SQLite) — 크기/경로/스키마 버전 + 엔진·sqlite3 CLI.
 *   3) 상세 ②「관계 흐름 그래프」(Graph) — 캐시/연결 상태/동기화 상태 + 엔진(Ladybug).
 *      미설치 감지 시에만 의존성 설치 카드(설치 SSE 슬롯은 컨테이너 주입).
 *
 * 헬스 배지는 *섹션 제목 줄 우측* 에 배치(StorageSectionHead) — 카드마다 동일 위치라 통일감.
 * 그래프는 항상 켜진 상태로 고정(v4.3.x) — 모드 선택 카드/env override 배너는 이식하지 않는다.
 * 데이터 페칭과 분리된 *순수 뷰* — 공용 leaf 재사용(HealthBadge/SettingsRow/InlineCopyButton/
 * StorageUsageBar, 아키텍처 §1.1).
 *
 * @module features/settings/StoragePanelView
 */
import type { ReactNode } from 'react';
import { HealthBadge } from '../../components/settings/HealthBadge';
import { InlineCopyButton } from '../../components/settings/InlineCopyButton';
import { SettingsRow } from '../../components/settings/SettingsRow';
import { StorageUsageBar } from '../../components/settings/StorageUsageBar';
import { formatBytes } from '../../lib/settings-format';
import { graphHealthBadgeVariant, graphHealthIcon, graphHealthState } from './logic';
import type { GraphData, LadybugStatus, SqliteInfo } from './types';

export interface StoragePanelViewProps {
  sqlite: SqliteInfo;
  graph: GraphData;
  /** graph-db/status 응답 — 실패 시 null(원본 ladybugJson.success ? data : null). */
  ladybug: LadybugStatus | null;
  /** 보관 기간(일) — diag.retention.days. */
  retentionDays: number;
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** CLI 명령 복사 통지(무전역 clipboard). */
  onCopy?: (text: string) => void;
  /** Ladybug 자동 설치 통지(strategy='auto'). */
  onInstall?: (strategy: string) => void;
  /** Ladybug 설치 result 슬롯(#ladybugInstallResult). */
  installResult?: ReactNode;
}

/** 섹션 제목 + 부제(좌) + 헬스 배지(우) 한 줄 헤더 — 모든 카드 동일 위치라 통일감. */
function StorageSectionHead({ title, subtitle, badge }: { title: string; subtitle: string; badge?: ReactNode }) {
  return (
    <div className="storage-section-head">
      <div className="storage-section-head-text">
        <div className="settings-card-title">{title}</div>
        <div className="settings-card-sub">{subtitle}</div>
      </div>
      {badge}
    </div>
  );
}

export function StoragePanelView({
  sqlite,
  graph: g,
  ladybug,
  retentionDays,
  t,
  onCopy,
  onInstall,
  installResult,
}: StoragePanelViewProps) {
  // ── 요약 — 총 용량 + 비율 ────────────────────────────────────────────────
  const sqliteBytes = sqlite.dbSizeBytes ?? 0;
  const graphBytes = g.cacheSizeBytes ?? 0;
  const totalBytes = sqliteBytes + graphBytes;

  // ── SQLite 섹션 메타 ─────────────────────────────────────────────────────
  const sqliteSize = sqlite.dbSizeBytes != null ? formatBytes(sqlite.dbSizeBytes) : '—';
  const migVersion = sqlite.migration?.version;
  const migFilename = sqlite.migration?.filename || '—';
  const cli = sqlite.cliVersion;

  // ── Graph 섹션 메타 (친화적 상태값 — raw circuit/cursor 미노출) ───────────
  const graphState = graphHealthState(g);
  const graphHealthLabel = t(`ui.settings-view.storage.graph.health.${graphState}`);
  const graphSize = g.cacheSizeBytes != null ? formatBytes(g.cacheSizeBytes) : '—';
  const connectionOk = g.circuit?.state === 'CLOSED';
  const syncOn = !!g.sync?.running;

  // Ladybug 설치 카드 — *미설치일 때만* 노출(자동 설치 보장 → 안전망 축소).
  const ladybugMissing = !!ladybug && !ladybug.installed;
  const canInstall = !!ladybug && (ladybug.brewAvailable || ladybug.npmAvailable);

  return (
    <>
      <h3 className="settings-section-title">{t('ui.settings-view.storage.title')}</h3>

      {/* 요약 카드 — 총 용량 + 비율 바 + 보관 기간. */}
      <div className="settings-card">
        <div className="settings-card-title">{t('ui.settings-view.storage.summary-title')}</div>
        <SettingsRow
          label={t('ui.settings-view.storage.total-size')}
          status="ok"
          value={formatBytes(totalBytes)}
        />
        <StorageUsageBar
          segments={[
            {
              key: 'rdb',
              label: t('ui.settings-view.storage.rdb.title'),
              bytes: sqliteBytes,
              sizeText: sqliteSize,
            },
            {
              key: 'graph',
              label: t('ui.settings-view.storage.graph.title'),
              bytes: graphBytes,
              sizeText: graphSize,
            },
          ]}
        />
        <SettingsRow
          label={t('ui.settings-view.storage.retention')}
          status="ok"
          value={t('ui.settings-view.storage.retention-days', { n: retentionDays })}
        />
      </div>

      {/* 상세 ①「대화·이벤트 기록」(SQLite). */}
      <div className="settings-card">
        <StorageSectionHead
          title={t('ui.settings-view.storage.rdb.title')}
          subtitle={t('ui.settings-view.storage.rdb.subtitle')}
          badge={<HealthBadge variant="ok" icon="✓" label={t('ui.settings-view.storage.rdb.health-ok')} />}
        />
        <SettingsRow
          label={t('ui.settings-view.storage.rdb.size-label')}
          status="ok"
          value={sqliteSize}
        />
        <SettingsRow
          label={t('ui.settings-view.storage.rdb.path-label')}
          status="ok"
          value=""
          tail={<code className="settings-meta">{sqlite.dbPath || ''}</code>}
        />
        <SettingsRow
          label={t('ui.settings-view.storage.rdb.migration-label')}
          status={migVersion != null ? 'ok' : 'warn'}
          value={migVersion != null ? `v${migVersion}` : '—'}
          tail={<code className="settings-meta">{migFilename}</code>}
        />
        <SettingsRow
          label={t('ui.settings-view.storage.rdb.engine-label')}
          status="ok"
          value={t('ui.settings-view.storage.rdb.engine-value')}
        />
        {cli && (
          cli.available ? (
            <SettingsRow
              label={t('ui.settings-view.storage.rdb.cli-label')}
              status="ok"
              value={cli.version || cli.raw || '?'}
              tail={<code className="settings-meta">sqlite3</code>}
            />
          ) : (
            <SettingsRow
              label={t('ui.settings-view.storage.rdb.cli-label')}
              status="warn"
              value={t('ui.settings-view.diag.missing')}
              tail={
                <>
                  <code className="settings-cmd">brew install sqlite</code>
                  <InlineCopyButton text="brew install sqlite" title={t('ui.settings-view.proxy.copy')} onCopy={onCopy} />
                </>
              }
            />
          )
        )}
      </div>

      {/* 상세 ②「관계 흐름 그래프」(Graph). */}
      <div className="settings-card">
        <StorageSectionHead
          title={t('ui.settings-view.storage.graph.title')}
          subtitle={t('ui.settings-view.storage.graph.subtitle')}
          badge={<HealthBadge variant={graphHealthBadgeVariant(graphState)} icon={graphHealthIcon(graphState)} label={graphHealthLabel} />}
        />

        {/* Ladybug 의존성 카드 — 미설치일 때만(자동 설치 보장). */}
        {ladybugMissing && (
          <div className="settings-card settings-card--nested">
            <div className="settings-card-title">{t('ui.settings-view.storage.graph.install-title')}</div>
            <SettingsRow
              label={t('ui.settings-view.storage.graph.status-label')}
              status="warn"
              value={t('ui.settings-view.storage.graph.missing')}
            />
            <div className="settings-card-sub">{t('ui.settings-view.storage.graph.missing-hint')}</div>
            {canInstall ? (
              <div className="settings-actions">
                <button className="settings-action-btn" data-ladybug-install="auto" onClick={() => onInstall?.('auto')}>
                  {t('ui.settings-view.storage.graph.install')}
                </button>
              </div>
            ) : (
              <div className="settings-card-sub">{t('ui.settings-view.storage.graph.no-package-manager')}</div>
            )}
            <div className="settings-result" id="ladybugInstallResult">{installResult}</div>
          </div>
        )}

        <SettingsRow
          label={t('ui.settings-view.storage.graph.size-label')}
          status="ok"
          value={graphSize}
          tail={<code className="settings-meta">{g.cacheDir || ''}</code>}
        />
        <SettingsRow
          label={t('ui.settings-view.storage.graph.connection')}
          status={connectionOk ? 'ok' : 'warn'}
          value={connectionOk ? t('ui.settings-view.storage.graph.connection-ok') : t('ui.settings-view.storage.graph.connection-warn')}
        />
        <SettingsRow
          label={t('ui.settings-view.storage.graph.sync')}
          status={syncOn ? 'ok' : 'warn'}
          value={syncOn ? t('ui.settings-view.storage.graph.sync-on') : t('ui.settings-view.storage.graph.sync-off')}
        />
        <SettingsRow
          label={t('ui.settings-view.storage.graph.engine-label')}
          status={ladybug?.installed ? 'ok' : 'warn'}
          value={
            ladybug?.installed
              ? `Ladybug${ladybug.version ? ` v${ladybug.version}` : ''}`
              : t('ui.settings-view.storage.graph.missing')
          }
        />
      </div>
    </>
  );
}
