/**
 * features/settings/HooksPanelView.tsx — 이벤트 수집(Hook) 프레젠테이션 뷰
 *
 * Claude Code 라이프사이클 이벤트 훅 등록 설정. 비개발자 친화 단순화:
 *   - 프로필 선택(full/minimal) 제거 → *항상 full* 프로필 원클릭 자동 설치.
 *   - 큰 헬스 배지 제거 → 컴팩트 인라인 상태 + [자동 설치] 버튼 한 줄.
 *   - 상세 진단(경로/SPYGLASS_DIR/이벤트 목록)은 <details> 아코디언으로 접어 영역 축소
 *     (아래 Proxy 섹션을 놓치지 않도록).
 *
 * 멱등성: 백엔드 mergeSettings 가 이벤트를 키 단위 완전 치환 → 재설치해도 동일 결과(중복 0).
 * 데이터 페칭과 분리된 *순수 뷰* — 설치 핸들러/result 슬롯은 컨테이너(IntegrationPanel) 주입.
 *
 * @module features/settings/HooksPanelView
 */
import type { ReactNode } from 'react';
import { SettingsRow } from '../../components/settings/SettingsRow';
import { hookHealthState } from './logic';
import type { HookData } from './types';

export interface HooksPanelViewProps {
  hooks: HookData;
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** 원클릭 자동 설치(항상 full 프로필 적용). */
  onInstall?: () => void;
  /** 설치 진행 중 — 버튼 비활성. */
  installing?: boolean;
  /** 미리보기 모드 등에서 액션 비활성. */
  disabled?: boolean;
  /** 설치 result 슬롯(diff/에러, §5.2). */
  result?: ReactNode;
}

export function HooksPanelView({ hooks, t, onInstall, installing, disabled, result }: HooksPanelViewProps) {
  const state = hookHealthState(hooks);
  const installed = state === 'ok';
  const statusText = installed
    ? t('ui.settings-view.hooks.status-ok', { n: hooks.registeredCount, total: hooks.expectedCount })
    : t('ui.settings-view.hooks.status-off');

  return (
    <>
      <h3 className="settings-section-title">{t('ui.settings-view.hooks.title')}</h3>

      <div className="settings-card">
        <div className="settings-card-sub">{t('ui.settings-view.hooks.subtitle')}</div>

        {/* 컴팩트 상태 (+ onInstall 제공 시에만 설치 버튼 — 통합 설치 모드에선 상태만). */}
        <div className="settings-install-row">
          <span className={`settings-inline-status is-${installed ? 'ok' : 'warn'}`}>
            <span className="settings-inline-status-icon" aria-hidden="true">{installed ? '✓' : '⚠'}</span>
            {statusText}
          </span>
          {onInstall && (
            <button
              type="button"
              className="settings-action-btn settings-action-primary"
              id="hookApplyBtn"
              onClick={onInstall}
              disabled={installing || disabled}
            >
              {installed ? t('ui.settings-view.hooks.reinstall') : t('ui.settings-view.hooks.apply')}
            </button>
          )}
        </div>

        {result && <div className="settings-result" id="hookResult">{result}</div>}

        {/* 상세 진단 — 접기(아코디언). 기본 닫힘으로 영역 축소. */}
        <details className="settings-engineering">
          <summary>{t('ui.settings-view.hooks.detail-summary')}</summary>
          <div className="settings-meta" style={{ margin: '6px 0' }}>
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
        </details>
      </div>
    </>
  );
}
