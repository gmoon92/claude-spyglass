/**
 * features/settings/GraphPanelView.tsx — Graph DB 설정 프레젠테이션 뷰 (P2-07, innerHTML#13 :813)
 *
 * 원본: settings-view.js renderGraphSection(:695-849) + buildLadybugCardHtml(:860-892).
 *   데이터 페칭과 분리된 *순수 뷰* — diag.graph + graph-db/status(Ladybug)를 prop 으로 받아
 *   env 경고 배너 + 헬스 배지 + Ladybug 설치 카드 + 모드 옵션 카드 3개 + 엔지니어링 카드를 그린다.
 *   install SSE 스트림/모드 변경 핸들러·result 슬롯은 컨테이너(GraphPanel)가 주입(§5.2).
 *
 * 무전역: i18n 은 t 콜백. 모드 선택은 onSelectMode(value) 통지(controlled, 원본 명령형 토글 :1024).
 *   공용 leaf 재사용: HealthBadge / OptionCard / SettingsRow(아키텍처 §1.1).
 *
 * @module features/settings/GraphPanelView
 */
import type { ReactNode } from 'react';
import { HealthBadge } from '../../components/settings/HealthBadge';
import { OptionCard } from '../../components/settings/OptionCard';
import { SettingsRow } from '../../components/settings/SettingsRow';
import { formatBytes } from '../../lib/settings-format';
import { graphHealthBadgeVariant, graphHealthIcon, graphHealthState, graphSourceKey } from './logic';
import type { GraphData, GraphMode, LadybugStatus } from './types';

export interface GraphPanelViewProps {
  graph: GraphData;
  /** graph-db/status 응답 — 실패 시 null(원본 :710 ladybugJson.success ? data : null). */
  ladybug: LadybugStatus | null;
  /** 현재 모드(controlled, 원본 g.mode). */
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** 모드 카드 선택 통지(원본 onGraphMode :1013). */
  onSelectMode?: (mode: GraphMode) => void;
  /** Ladybug 자동 설치 통지(원본 onLadybugInstall :904). strategy='auto'(:874). */
  onInstall?: (strategy: string) => void;
  /** Ladybug 설치 result 슬롯(#ladybugInstallResult, §5.2). */
  installResult?: ReactNode;
  /** 모드 변경 result 슬롯(#graphResult, §5.2). */
  modeResult?: ReactNode;
}

const MODES: GraphMode[] = ['off', 'shadow', 'primary'];

export function GraphPanelView({
  graph: g,
  ladybug,
  t,
  onSelectMode,
  onInstall,
  installResult,
  modeResult,
}: GraphPanelViewProps) {
  const state = graphHealthState(g);
  const healthLabel = t(`ui.settings-view.graph.health.${state}`);
  const source = g.source || 'default';
  const sourceLabel = t(`ui.settings-view.graph.source.${graphSourceKey(source)}`);

  // Ladybug 설치 카드 — *미설치일 때만* 노출(원본 buildLadybugCardHtml :865-868).
  const ladybugMissing = !!ladybug && !ladybug.installed;
  const canInstall = !!ladybug && (ladybug.brewAvailable || ladybug.npmAvailable);

  // 엔지니어링 카드 — Ladybug row(설치 시 구현체/버전/경로 노출, 원본 :765-784).
  const ladybugRow = ladybug ? (
    <SettingsRow
      label={t('ui.settings-view.graph.ladybug.engineering-label')}
      status={ladybug.installed ? 'ok' : 'warn'}
      value={
        ladybug.installed
          ? `${t('ui.settings-view.graph.ladybug.installed')} (${methodLabel(ladybug.method)}${ladybug.version ? ` v${ladybug.version}` : ''})`
          : t('ui.settings-view.graph.ladybug.missing')
      }
      tail={ladybug.installed && ladybug.path ? <code className="settings-meta">{ladybug.path}</code> : undefined}
    />
  ) : null;

  return (
    <>
      <h3 className="settings-section-title">{t('ui.settings-view.graph.title')}</h3>

      {source === 'env' && (
        <div className="settings-warn-banner">⚠ {t('ui.settings-view.graph.env-override-warning')}</div>
      )}

      <div className="settings-card">
        <HealthBadge variant={graphHealthBadgeVariant(state)} icon={graphHealthIcon(state)} label={healthLabel} />
      </div>

      {/* Ladybug 의존성 카드 — 미설치일 때만(원본 :860). */}
      {ladybugMissing && (
        <div className="settings-card">
          <div className="settings-card-title">{t('ui.settings-view.graph.ladybug.title')}</div>
          <SettingsRow
            label={t('ui.settings-view.graph.ladybug.status-label')}
            status="warn"
            value={t('ui.settings-view.graph.ladybug.missing')}
          />
          <div className="settings-card-sub">{t('ui.settings-view.graph.ladybug.missing-hint')}</div>
          {canInstall ? (
            <div className="settings-actions">
              <button className="settings-action-btn" data-ladybug-install="auto" onClick={() => onInstall?.('auto')}>
                {t('ui.settings-view.graph.ladybug.install')}
              </button>
            </div>
          ) : (
            <div className="settings-card-sub">{t('ui.settings-view.graph.ladybug.no-package-manager')}</div>
          )}
          <div className="settings-result" id="ladybugInstallResult">{installResult}</div>
        </div>
      )}

      {/* 모드 선택 카드 3개(원본 :828-835). */}
      <div className="settings-card">
        <div className="settings-card-title">{t('ui.settings-view.graph.mode-pick-title')}</div>
        <div className="settings-card-sub">{t('ui.settings-view.graph.mode-pick-sub')}</div>
        <div className="settings-option-grid" role="radiogroup" aria-label={t('ui.settings-view.graph.mode-pick-title')}>
          {MODES.map((m) => (
            <OptionCard
              key={m}
              dataAttr="graph-mode"
              value={m}
              active={g.mode === m}
              label={t(`ui.settings-view.graph.options.${m}.label`)}
              desc={t(`ui.settings-view.graph.options.${m}.desc`)}
              tooltip={t(`ui.settings-view.graph.options.${m}.tooltip`)}
              onSelect={(v) => onSelectMode?.(v as GraphMode)}
            />
          ))}
        </div>
        <div className="settings-result" id="graphResult">{modeResult}</div>
      </div>

      {/* 엔지니어링 카드(원본 :785-806). */}
      <div className="settings-card">
        <div className="settings-card-title">{t('ui.settings-view.graph.engineering-title')}</div>
        {ladybugRow}
        <SettingsRow
          label={t('ui.settings-view.graph.circuit')}
          status={g.circuit?.state === 'CLOSED' ? 'ok' : 'warn'}
          value={g.circuit?.state ?? '—'}
          tail={
            <span className="settings-meta">
              {g.circuit?.consecutiveFailures ?? 0} fail · {((g.circuit?.fallbackRate ?? 0) * 100).toFixed(1)}% fallback
            </span>
          }
        />
        <SettingsRow
          label={t('ui.settings-view.graph.sync-worker')}
          status={g.sync?.running ? 'ok' : 'warn'}
          value={g.sync?.running ? 'running' : 'stopped'}
          tail={g.sync?.cursor != null ? <span className="settings-meta">cursor {String(g.sync.cursor)}</span> : undefined}
        />
        <SettingsRow
          label={t('ui.settings-view.graph.cache')}
          status="ok"
          value={g.cacheSizeBytes != null ? formatBytes(g.cacheSizeBytes) : '—'}
          tail={<code className="settings-meta">{g.cacheDir || ''}</code>}
        />
        <SettingsRow
          label={t('ui.settings-view.graph.config-file')}
          status="ok"
          value={sourceLabel}
          tail={g.configFile ? <code className="settings-meta">{g.configFile}</code> : undefined}
        />
      </div>
    </>
  );
}

/** Ladybug 설치 방식 라벨(원본 :767-770). */
function methodLabel(method: string): string {
  return method === 'bun' ? 'Bun' : method === 'brew' ? 'Homebrew' : method === 'npm' ? 'npm' : method || '—';
}
