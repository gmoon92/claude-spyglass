/**
 * features/settings/HooksPanel.tsx — Hook 설정 sub-tab 컨테이너 (P2-06)
 *
 * 원본: settings-view.js renderHooksSection(:383-515) + onHookPreview(:517)/onHookApply(:531)/
 *   bindUndoButton(:613). useAsyncResource(fetchDiag)로 hook 상태 페칭 + 로컬 상태(_selectedProfile
 *   :374 → useState, result slot §5.2 → useState). preview/apply/undo 핸들러 + StickyAlert 연결.
 *
 * 로컬 상태(아키텍처 §4.1): selectedProfile(단일 폼 휘발), result(부분 갱신 §5.2).
 *   apply 성공 + nextAction=restart-claude-code → StickyAlert(§4.4). undo 가능 시 복구 버튼.
 *
 * @module features/settings/HooksPanel
 */
import { useCallback, useState } from 'react';
import { StickyAlert } from '../../components/settings/StickyAlert';
import { HooksPanelView } from './HooksPanelView';
import { fetchDiag, hookApply, hookPreview, hookRestore } from './hooks-api';
import { canUndo } from './logic';
import { useAsyncResource } from './use-settings-diag';
import type { HookDiff, HookProfile } from './types';

export interface HooksPanelProps {
  t: (key: string, vars?: Record<string, unknown>) => string;
}

/** result slot 상태 — 로딩/성공(diff)/에러(§5.2 부분 갱신). */
type ResultState =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string }
  | { kind: 'diff'; diff: HookDiff; applied: boolean; backupPath?: string }
  | { kind: 'error'; message: string };

export function HooksPanel({ t }: HooksPanelProps) {
  const fetcher = useCallback((signal: AbortSignal) => fetchDiag(signal), []);
  const { status, data, error, refetch } = useAsyncResource(fetcher);

  const [selectedProfile, setSelectedProfile] = useState<HookProfile>('full');
  const [result, setResult] = useState<ResultState>({ kind: 'idle' });
  const [showRestart, setShowRestart] = useState(false);

  const onPreview = useCallback(async () => {
    setResult({ kind: 'loading', label: t('ui.settings-view.loading') });
    try {
      const d = await hookPreview(selectedProfile);
      setResult({ kind: 'diff', diff: d.diff, applied: false });
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [selectedProfile, t]);

  const onApply = useCallback(async () => {
    setResult({ kind: 'loading', label: t('ui.settings-view.hooks.applying') });
    try {
      const d = await hookApply(selectedProfile);
      setResult({ kind: 'diff', diff: d.diff, applied: true, backupPath: d.backupPath });
      if (d.nextAction === 'restart-claude-code') setShowRestart(true);
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [selectedProfile, t]);

  const onUndo = useCallback(async (backupPath: string) => {
    try {
      const d = await hookRestore(backupPath);
      setResult({ kind: 'idle' });
      refetch(); // 복구 후 상태 무효화 → 재페치(§5.2).
      return d;
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, [refetch]);

  if (status === 'loading' || !data) {
    return <div className="settings-loading">{t('ui.settings-view.loading')}</div>;
  }
  if (status === 'error') {
    return <div className="settings-error">⚠ {error}</div>;
  }

  // result slot 렌더 — 로딩/에러/diff(원본 renderHookDiff :650-678 구조).
  const resultNode = (() => {
    if (result.kind === 'loading') return <div className="settings-loading">{result.label}</div>;
    if (result.kind === 'error') return <div className="settings-error">⚠ {result.message}</div>;
    if (result.kind === 'diff') {
      const { diff, applied, backupPath } = result;
      const header = applied
        ? t('ui.settings-view.hooks.apply-success')
        : t('ui.settings-view.hooks.preview-result');
      const tag = (label: string, items: string[], cls: string) =>
        items.length > 0 ? (
          <div className={`settings-diff-row settings-diff-${cls}`}>
            <b>{label}</b> <span>{items.join(', ')}</span>
          </div>
        ) : null;
      const undoable = applied && canUndo(backupPath);
      return (
        <div className="settings-diff">
          <div className="settings-diff-title">{header}</div>
          {applied && backupPath && (
            <div className="settings-diff-row settings-diff-info">
              <b>{t('ui.settings-view.hooks.backup-saved')}</b> <code>{backupPath}</code>
            </div>
          )}
          {tag(t('ui.settings-view.hooks.diff-applied'), diff.applied, 'add')}
          {tag(t('ui.settings-view.hooks.diff-modified'), diff.modified, 'mod')}
          {tag(t('ui.settings-view.hooks.diff-preserved'), diff.preserved, 'keep')}
          <div className="settings-diff-row settings-diff-info">
            <b>SPYGLASS_DIR</b> <span>{diff.spyglassDir} → <code>{diff.spyglassDirAfter}</code></span>
          </div>
          {undoable && (
            <div className="settings-actions">
              <button
                className="settings-action-btn settings-action-secondary"
                data-hook-undo
                onClick={() => onUndo(backupPath!)}
              >
                {t('ui.settings-view.hooks.undo')}
              </button>
            </div>
          )}
        </div>
      );
    }
    return null;
  })();

  return (
    <>
      {showRestart && (
        <StickyAlert
          message={t('ui.settings-view.hooks.restart-required-banner')}
          kind="restart"
          onDismissed={() => setShowRestart(false)}
        />
      )}
      <HooksPanelView
        hooks={data.hooks}
        selectedProfile={selectedProfile}
        t={t}
        onSelectProfile={setSelectedProfile}
        actions={
          <>
            <button className="settings-action-btn settings-action-secondary" id="hookPreviewBtn" onClick={onPreview}>
              {t('ui.settings-view.hooks.preview')}
            </button>
            <button className="settings-action-btn settings-action-primary" id="hookApplyBtn" onClick={onApply}>
              {t('ui.settings-view.hooks.apply')}
            </button>
          </>
        }
        result={resultNode}
      />
    </>
  );
}
