/**
 * features/llm-input/index.ts — barrel (P3-08)
 *
 * llm-input-view.js → LLMInput(presentation) + llm-input-state(순수 전이 SSoT).
 * fetch 오케스트레이션/ref 팝오버(fetch+DOM)는 레거시 .js 병존(이식 대상 아님 — 후속 데이터흐름 역전).
 *
 * @module features/llm-input
 */
export { LLMInput } from './LLMInput';
export type { LLMInputProps, SystemMeta, ProxyMeta } from './LLMInput';
export {
  initialExpanded,
  toggleExpanded,
  setAllExpanded,
  applySearchExpansion,
  previewFromContent,
  contentText,
  messageHaystack,
  formatBytes,
  splitHighlight,
  messageId,
  SUMMARY_PREVIEW_LEN,
  SEARCH_MIN_LEN,
} from './llm-input-state';
export type { MessageLike, ContentPart, ExpandedMap, HighlightSegment } from './llm-input-state';
