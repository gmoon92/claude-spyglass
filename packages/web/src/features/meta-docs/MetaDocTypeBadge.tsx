/**
 * features/meta-docs/MetaDocTypeBadge.tsx — Behavior Definitions 타입 칩 (P4-02)
 *
 * 원본: assets/js/meta-docs-view.js metaDocTypeBadge (view.js:811).
 *  - agent         → 주황 bullseye : ToolIcon('Agent') + .tool-chip-agent (색 SSoT)
 *  - skill/command → 금색 fish-eye : ToolIcon('Skill') + .tool-chip-skill (command 은 Skill 합류, view.js:815)
 *  - 글리프/색 hex 직접 지정 금지(arch §2.1 SSoT) → render/badges ToolIcon 위임. currentColor 상속.
 *  - 라벨은 type.toUpperCase()(원본 view.js:817). 클래스: tool-chip agent-chip {tone} meta-doc-type meta-doc-type-{safe}.
 *
 * @module features/meta-docs/MetaDocTypeBadge
 */
import type { ReactElement } from 'react';
import { ToolIcon } from '../../components/render/badges';

export function MetaDocTypeBadge({ type }: { type: string | null | undefined }): ReactElement {
  const safe = String(type ?? '').toLowerCase();
  const isAgent = safe === 'agent';
  const iconName = isAgent ? 'Agent' : 'Skill'; // skill·command 은 Skill fish-eye 글리프
  const toneCls = isAgent ? 'tool-chip-agent' : 'tool-chip-skill'; // 색 SSoT
  const label = safe.toUpperCase();
  return (
    <span className={`tool-chip agent-chip ${toneCls} meta-doc-type meta-doc-type-${safe}`}>
      <ToolIcon toolName={iconName} />
      <span className="agent-chip-name">{label}</span>
    </span>
  );
}
