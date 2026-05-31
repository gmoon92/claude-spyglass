/**
 * features/browse — 브라우즈 좌측 패널 공개 표면.
 *
 * 기존 소비처(BrowseLayout/MetaDocsLayout 등)는 '../features/browse/Sidebar' 를 직접 import 한다(불변).
 * 본 barrel 은 lead 통합용 BrowseSidebar 단일 마운트 진입점 + 보조 훅을 노출한다.
 *
 * @module features/browse
 */

export { BrowseSidebar, type BrowseSidebarProps } from './BrowseSidebar';
export { useObsCards, type ObsCardsState, type UseObsCardsOptions } from './use-obs-cards';
export { usePanelResize, type UsePanelResizeRefs } from './use-panel-resize';
