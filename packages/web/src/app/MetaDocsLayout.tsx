// app/MetaDocsLayout.tsx — metadocs 모드 레이아웃 셸 (P4-06)
//
// 원본: main.js enterMetaDocsMode + meta-docs-view.js 셸(카탈로그 + 검색 + flow/tool-stats 서브탭).
//   본 셸은 카탈로그 region 마운트 구조를 확정한다. 서브탭(docs/tools) 전환은 app-store.metaSubTab SSoT.
//
// 데이터 결선 경계(P4-07 boundary):
//   카탈로그 rows / flow / tool-stats 매트릭스는 /api/meta-docs fetch 오케스트레이션(legacy
//   meta-docs-view.js)에 의존한다. 본 페이즈는 빈 rows 로 마운트하고, 실제 데이터 population +
//   검색/필터/정렬 상태 결선은 index.html 진입 전환(P4-07)에서 수행한다(F3 역전 의존).
//
// 레이어(architecture.md §1.3): app → features(meta-docs) + stores 정방향.

import type { ReactElement } from 'react';
import { MetaDocsCatalog, type MetaDocRow } from '../features/meta-docs';
import { useAppStore } from '../stores/app-store';
import { tt } from './i18n-labeler';

/** 빈 카탈로그 — fetch 역전(P4-07) 전까지의 컨트롤드 기본값. */
const EMPTY_ROWS: MetaDocRow[] = [];

export function MetaDocsLayout(): ReactElement {
  const metaSubTab = useAppStore((s) => s.metaSubTab);
  const selectedProject = useAppStore((s) => s.selectedProject);

  return (
    <div className="meta-docs-layout" data-testid="meta-docs-layout" data-meta-subtab={metaSubTab}>
      <section className="meta-docs-main" data-testid="meta-docs-catalog">
        <MetaDocsCatalog rows={EMPTY_ROWS} project={selectedProject} t={tt} />
      </section>
      {/* tool-stats(metaSubTab==='tools') / flow 마운트는 데이터 fetch 결선(P4-07)과 함께. */}
    </div>
  );
}
