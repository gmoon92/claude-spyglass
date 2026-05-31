/**
 * features/settings/HooksPanelView.tsx — Hook 설정 프레젠테이션 뷰 (P2-06, innerHTML#4 :471)
 *
 * 원본: settings-view.js renderHooksSection(:383-515). 데이터 페칭과 분리된 *순수 뷰* —
 *   HookData + 현재 선택 프로필을 prop 으로 받아 헬스 배지 + 프로필 카드 + 엔지니어링 카드를 그린다.
 *   preview/apply 결과 슬롯(#hookResult)과 핸들러 배선은 컨테이너(HooksPanel)가 담당(§5.2).
 *
 * 무전역: i18n 은 t 콜백 prop. 프로필 선택은 onSelectProfile(value) 통지(controlled, 원본
 *   명령형 토글 :506-510 대체). children 슬롯으로 result/actions 영역을 컨테이너가 주입.
 *
 * @module features/settings/HooksPanelView
 */
import type { ReactNode } from 'react';
import { HealthBadge } from '../../components/settings/HealthBadge';
import { OptionCard } from '../../components/settings/OptionCard';
import { SettingsRow } from '../../components/settings/SettingsRow';
import {
  hookHealthBadgeVariant,
  hookHealthIcon,
  hookHealthState,
  showProfilePicker,
} from './logic';
import type { HookData, HookProfile } from './types';

export interface HooksPanelViewProps {
  hooks: HookData;
  /** 현재 선택 프로필(controlled, 원본 _selectedProfile :374). */
  selectedProfile: HookProfile;
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** 프로필 카드 선택 통지. */
  onSelectProfile?: (profile: HookProfile) => void;
  /** preview/apply 액션 + result 슬롯(컨테이너 주입, §5.2). */
  actions?: ReactNode;
  result?: ReactNode;
}

const PROFILES: HookProfile[] = ['full', 'minimal'];

export function HooksPanelView({
  hooks,
  selectedProfile,
  t,
  onSelectProfile,
  actions,
  result,
}: HooksPanelViewProps) {
  const state = hookHealthState(hooks);
  const healthLabel = t(`ui.settings-view.hooks.health.${state}`, {
    n: hooks.registeredCount,
    total: hooks.expectedCount,
  });
  const picker = showProfilePicker(state);

  return (
    <>
      <h3 className="settings-section-title">{t('ui.settings-view.hooks.title')}</h3>

      <div className="settings-card">
        <HealthBadge variant={hookHealthBadgeVariant(state)} icon={hookHealthIcon(state)} label={healthLabel} />
      </div>

      {picker && (
        <div className="settings-card">
          <div className="settings-card-title">{t('ui.settings-view.hooks.profile-title')}</div>
          <div className="settings-card-sub">{t('ui.settings-view.hooks.profile-sub')}</div>
          <div className="settings-option-grid" role="radiogroup" aria-label={t('ui.settings-view.hooks.profile-title')}>
            {PROFILES.map((p) => (
              <OptionCard
                key={p}
                dataAttr="hook-profile"
                value={p}
                active={selectedProfile === p}
                label={t(`ui.settings-view.hooks.profiles.${p}.label`)}
                desc={t(`ui.settings-view.hooks.profiles.${p}.desc`)}
                tooltip={t(`ui.settings-view.hooks.profiles.${p}.tooltip`)}
                onSelect={(v) => onSelectProfile?.(v as HookProfile)}
              />
            ))}
          </div>
          <div className="settings-actions">
            {actions ?? (
              <>
                <button className="settings-action-btn settings-action-secondary" id="hookPreviewBtn">
                  {t('ui.settings-view.hooks.preview')}
                </button>
                <button className="settings-action-btn settings-action-primary" id="hookApplyBtn">
                  {t('ui.settings-view.hooks.apply')}
                </button>
              </>
            )}
          </div>
          <div className="settings-result" id="hookResult">{result}</div>
        </div>
      )}

      {/* 엔지니어링 카드 — 항상 노출(원본 :461-468). 경로 + SPYGLASS_DIR + 이벤트 row. */}
      <div className="settings-card">
        <div className="settings-card-title">{t('ui.settings-view.hooks.engineering-title')}</div>
        <div className="settings-meta" style={{ marginBottom: 6 }}>
          <code>{hooks.path}</code>
        </div>
        <SettingsRow
          label="SPYGLASS_DIR"
          status={hooks.spyglassDir ? 'ok' : 'warn'}
          value={hooks.spyglassDir ? '✓' : t('ui.settings-view.hooks.unregistered')}
          tail={
            hooks.spyglassDir ? (
              <code className="settings-meta">{hooks.spyglassDir}</code>
            ) : (
              <span className="settings-meta">{t('ui.settings-view.hooks.spyglass-dir-missing')}</span>
            )
          }
        />
        {hooks.events.map((ev) => (
          <SettingsRow
            key={ev.event}
            label={ev.event}
            status={ev.count > 0 ? 'ok' : 'warn'}
            value={ev.count > 0 ? t('ui.settings-view.hooks.registered') : t('ui.settings-view.hooks.unregistered')}
          />
        ))}
      </div>
    </>
  );
}
