// app/MetaDocsLayout.tsx — metadocs 모드 레이아웃 셸 + 카탈로그 population 결선 (P4-06 셸 / P4-07 결선)
//
// 원본: main.js enterMetaDocsMode + meta-docs-view.js loadMetaDocsLibrary(:460-515) fetch 결선.
//   본 셸은 카탈로그 region 마운트 구조를 확정하고, 카탈로그 rows 를 fetchMetaDocs 로 채운다.
//   서브탭(docs/tools) 전환은 app-store.metaSubTab SSoT.
//
// 데이터 population (P4-07 — P4-06 boundary 닫기):
//   - 마운트/프로젝트 변경 시 fetchMetaDocs(project) → setState(rows) → MetaDocsCatalog 주입.
//   - flow/tool-stats 매트릭스(metaSubTab==='tools')·source_root 2단계 매칭·검색/필터/정렬 상태 결선은
//     별도 결선 범위(빈/기본값 유지 — 정렬/표시필터는 MetaDocsCatalog 가 controlled 기본으로 처리).
//   - fetch 는 useEffect 안에서만(SSR effect 미발화 → 빈 rows 로 결정적 렌더). AbortController cleanup.
//
// 레이어(architecture.md §1.3): app → features(meta-docs) + stores 정방향.

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { MetaDocsCatalog, type MetaDocRow } from '../features/meta-docs';
import { useAppStore } from '../stores/app-store';
import { tt } from './i18n-labeler';
import { fetchMetaDocs } from '../api/fetchers';

export function MetaDocsLayout(): ReactElement {
  const metaSubTab = useAppStore((s) => s.metaSubTab);
  const selectedProject = useAppStore((s) => s.selectedProject);

  const [rows, setRows] = useState<MetaDocRow[]>([]);

  // 카탈로그 population — 프로젝트 변경 시 재조회(전체 기간). SSR 미발화 → 빈 rows 결정적 렌더.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const list = await fetchMetaDocs({ project: selectedProject, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setRows(list as unknown as MetaDocRow[]);
    })().catch(() => {
      /* silent — fetchMetaDocs 가 이미 [] 폴백. 빈 카탈로그 유지(원본 silent catch 동치). */
    });
    return () => ctrl.abort();
  }, [selectedProject]);

  return (
    <div className="meta-docs-layout" data-testid="meta-docs-layout" data-meta-subtab={metaSubTab}>
      <section className="meta-docs-main" data-testid="meta-docs-catalog">
        <MetaDocsCatalog rows={rows} project={selectedProject} t={tt} />
      </section>
      {/* tool-stats(metaSubTab==='tools') / flow 마운트는 후속 결선에서. */}
    </div>
  );
}
