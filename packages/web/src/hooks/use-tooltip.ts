/**
 * hooks/use-tooltip.ts — 전역 호버 툴팁 시스템 (React 포팅)
 *
 * 레거시(spyglass-legacy-ref/packages/web/assets/js):
 *   - stat-tooltip.js  → [data-stat-tooltip] / [data-ctx-tooltip] / [data-mini-badge-tooltip]
 *   - obs-tooltip.js   → [data-obs-tooltip]
 *   - cache-panel-tooltip.js → [data-cache-panel-tooltip]
 *   - cache-tooltip.js → .cache-cell (data-cache-read / data-cache-write)
 *
 * 레거시는 4개의 분리된 init* 함수가 각자 .stat-tooltip / .cache-tooltip DOM 을 만들고
 *   document 레벨 mouseover/mousemove/mouseout 위임을 따로 걸었다(동일 패턴 4중 복제).
 *   React 포팅에서는 단일 useTooltip() 훅이 document 위임 1쌍 + floating 요소 2개
 *   (.stat-tooltip / .cache-tooltip — CSS 클래스가 다름)만 생성하고 트리거 종류로 분기한다.
 *
 * 비침습(per-component 무수정): 각 컴포넌트(TimelineMeta/Chart/CachePanel/ObsPanel/badges/cells)에
 *   이미 data-*-tooltip 속성·.cache-cell 마크업이 존재한다. 본 훅은 핸들러만 document 에 위임으로
 *   붙이므로 컴포넌트 JSX 수정이 필요 없다.
 *
 * i18n: 콘텐츠 키는 'ui.stat-tooltip.*' / 'ui.obs-tooltip.*' / 'ui.cache-panel.*'. react-i18next
 *   t 를 hook 에서 받아 모듈 헬퍼(statContent 등)에 인자로 주입(레거시 window.I18n/tt 직접참조 폐기).
 *
 * 위치: 레거시는 커서 추종(position(e): clientX+8 / clientY+12, viewport 충돌 시 반대편 뒤집기)을
 *   썼다 — 본 포팅도 동일(트리거 기준 anchor 가 아닌 커서 기준이 레거시 동작). pointer-events:none
 *   CSS 라 툴팁 자체가 mouseout 을 유발하지 않는다.
 *
 * cleanup: useEffect 반환에서 document 리스너 제거 + 생성한 floating 요소 2개 removeChild.
 *   SSR 안전(document 부재 시 no-op).
 *
 * 레이어(architecture.md §1.3): hooks leaf. app(AppShell)이 유일 소비처. useTranslation 으로 t 취득.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { positionAbovePoint } from '../features/dashboard/tooltip';
import type { CtxPointHoverDetail } from '../features/dashboard/context-chart-data';
import type { TimelineHoverDetail } from '../components/Chart';

/** 툴팁 내용 — title/desc 2단(desc 는 \n → <br> 치환). */
interface TooltipContent {
  title?: string;
  desc: string;
}

/** i18n 라벨 함수 계약 — react-i18next t 를 (key, vars)=>string 시그니처로 받는다(헬퍼 무전역 주입). */
type TFunc = (key: string, vars?: Record<string, unknown>) => string;

/**
 * data-stat-tooltip 값 → i18n 키. 레거시 STAT_TOOLTIP_CONTENT(stat-tooltip.js:17) 1:1.
 * timeline-meta 통계 카드: sessions / requests / tokens / active / avg-duration / p95 / err.
 */
function statContent(key: string, t: TFunc): TooltipContent | null {
  const ns = `ui.stat-tooltip.${key}`;
  const title = t(`${ns}.title`);
  // t 는 키 부재 시 키 자체를 passthrough — 알 수 없는 key 는 무시(레거시 content map 미존재 동치).
  if (title === `${ns}.title`) return null;
  return { title, desc: t(`${ns}.desc`) };
}

/**
 * data-ctx-tooltip 값 → i18n 키. 레거시 CTX_TOOLTIP_CONTENT(stat-tooltip.js:2) 1:1.
 * 차트 영역(chart-wrap): context-growth.
 */
function ctxContent(key: string, t: TFunc): TooltipContent | null {
  const ns = `ui.stat-tooltip.${key}`;
  const title = t(`${ns}.title`);
  if (title === `${ns}.title`) return null;
  return { title, desc: t(`${ns}.desc`) };
}

/**
 * data-mini-badge-tooltip 값 → i18n 키. 레거시 MINI_BADGE_TOOLTIP(stat-tooltip.js:9) 1:1.
 * anomaly mini-badge: spike / loop / slow / error / cache (desc 만, title 없음).
 */
function miniBadgeContent(key: string, t: TFunc): TooltipContent | null {
  const ns = `ui.stat-tooltip.badge.${key}`;
  const desc = t(ns);
  if (desc === ns) return null;
  return { desc };
}

/**
 * data-obs-tooltip 값 → i18n 키. 레거시 OBS_TOOLTIP_CONTENT(obs-tooltip.js:12) 1:1.
 * obs 카드/카테고리/anomaly: burn-rate / cache-health / live-pulse / tool-categories /
 *   cat-Agent / cat-Skill / cat-MCP / cat-Native / anomaly.
 */
function obsContent(key: string, t: TFunc): TooltipContent | null {
  const ns = `ui.obs-tooltip.${key}`;
  const title = t(`${ns}.title`);
  if (title === `${ns}.title`) return null;
  return { title, desc: t(`${ns}.desc`) };
}

/**
 * data-cache-panel-tooltip 값 → i18n 키. 레거시 CACHE_PANEL_TOOLTIP_CONTENT(cache-panel-tooltip.js:2) 1:1.
 * Cache Intelligence Panel: hit-rate / ratio.
 */
function cachePanelContent(key: string, t: TFunc): TooltipContent | null {
  const ns = `ui.cache-panel.${key}`;
  const title = t(`${ns}.title`);
  if (title === `${ns}.title`) return null;
  return { title, desc: t(`${ns}.desc`) };
}

/** 천단위 콤마(en-US) — 레거시 cache-tooltip.js fmtNum 1:1. */
function fmtNum(n: number): string {
  return Number(n).toLocaleString('en-US');
}

/** TooltipContent → .stat-tooltip 내부 HTML. desc 의 \n 은 <br> 로(레거시 동일). */
function renderStatHtml(content: TooltipContent): string {
  const descHtml = content.desc.replace(/\n/g, '<br>');
  const titleHtml = content.title
    ? `<div class="stat-tooltip-title">${content.title}</div>`
    : '';
  return `${titleHtml}<div class="stat-tooltip-desc">${descHtml}</div>`;
}

/**
 * 커서 추종 위치 계산 — 레거시 position(e)(stat-tooltip.js:69) 1:1.
 * 기본 우하단(+8/+12), viewport 우측/하단 넘침 시 반대편으로 뒤집기.
 */
function positionAtCursor(el: HTMLElement, clientX: number, clientY: number, fallbackW: number): void {
  const tw = el.offsetWidth || fallbackW;
  const th = el.offsetHeight || 60;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = clientX + 8;
  let y = clientY + 12;
  if (x + tw > vw) x = clientX - tw - 8;
  if (y + th > vh) y = clientY - th - 8;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

/**
 * 점 위 배치 — 위치 산술 SSoT(tooltip.ts positionAbovePoint)에 위임하고 el 에 적용.
 * ctx-point-hover 수치 툴팁 전용(레거시 stat-tooltip.js positionAt 동치).
 */
function positionAbove(el: HTMLElement, clientX: number, clientY: number, fallbackW: number): void {
  const size = { width: el.offsetWidth || fallbackW, height: el.offsetHeight || 60 };
  const { x, y } = positionAbovePoint(
    { x: clientX, y: clientY },
    size,
    { width: window.innerWidth, height: window.innerHeight },
  );
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

/**
 * ctx-point-hover detail → .stat-tooltip HTML. 차트 데이터 포인트 수치 툴팁 본문.
 *  - title: "Turn N"(ui.stat-tooltip.point-hover.title)
 *  - 1행: window 정보가 있으면 한도·사용률 포함(accumulated-with-limit), 없으면 누적량만(accumulated)
 *  - delta/model 행은 값이 있을 때만 추가(\n → renderStatHtml 에서 <br>)
 */
function renderPointHoverHtml(detail: CtxPointHoverDetail, t: TFunc): string {
  const ns = 'ui.stat-tooltip.point-hover';
  const title = t(`${ns}.title`, { turn: detail.turnIndex });
  const lines: string[] = [];
  if (detail.windowLabel && detail.usagePercent !== null) {
    lines.push(
      t(`${ns}.accumulated-with-limit`, {
        value: detail.formattedValue,
        limit: detail.windowLabel,
        percent: detail.usagePercent,
      }),
    );
  } else {
    lines.push(t(`${ns}.accumulated`, { value: detail.formattedValue }));
  }
  if (detail.formattedDelta) lines.push(t(`${ns}.delta`, { delta: detail.formattedDelta }));
  if (detail.windowModel) lines.push(t(`${ns}.model`, { model: detail.windowModel }));
  return renderStatHtml({ title, desc: lines.join('\n') });
}

/**
 * 전역 호버 툴팁 훅 — AppShell 에서 1회 호출.
 *
 * document 위임으로 [data-stat-tooltip] / [data-ctx-tooltip] / [data-mini-badge-tooltip] /
 *   [data-obs-tooltip] / [data-cache-panel-tooltip] / .cache-cell 를 감지해 단일 floating
 *   툴팁을 표시한다(레거시 4개 init* 통합).
 */
export function useTooltip(): void {
  // react-i18next t 를 ref 로 최신 유지 — 언어전환 시 리스너 재등록 없이 다음 hover 가 최신 t 를 본다
  //   (useEffect deps=[] 보존, 레거시 tt(window.I18n) 직접참조 폐기).
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;

    // .stat-tooltip 재사용(stat/ctx/mini-badge/obs/cache-panel 공유 — 레거시 obs-tooltip.js 주석:
    //   "stat-tooltip.js 와 동일한 .stat-tooltip 클래스를 재사용해 시각 일관성 유지").
    const statEl = doc.createElement('div');
    statEl.className = 'stat-tooltip';
    statEl.style.display = 'none';
    doc.body.appendChild(statEl);

    // .cache-tooltip — .cache-cell 전용(레거시 cache-tooltip.js, 별도 클래스/레이아웃).
    const cacheEl = doc.createElement('div');
    cacheEl.className = 'cache-tooltip';
    cacheEl.style.display = 'none';
    doc.body.appendChild(cacheEl);

    // 차트 데이터 포인트 호버 중 플래그 — 활성 시 설명(data-*-tooltip) 툴팁을 억제해
    //   수치 툴팁(ctx-point-hover)과 충돌하지 않게 한다(레거시 stat-tooltip.js _pointHoverActive).
    let pointHoverActive = false;

    /** 가장 가까운 트리거 element 와 분류를 해석. 우선순위는 레거시 mouseover 분기 순서 1:1. */
    function resolve(target: EventTarget | null): { el: HTMLElement; kind: 'stat'; content: TooltipContent | null } | { el: HTMLElement; kind: 'cache'; read: number; write: number } | null {
      if (!(target instanceof Element)) return null;

      const ctx = target.closest<HTMLElement>('[data-ctx-tooltip]');
      if (ctx) return { el: ctx, kind: 'stat', content: ctxContent(ctx.dataset.ctxTooltip ?? '', tRef.current) };

      const badge = target.closest<HTMLElement>('[data-mini-badge-tooltip]');
      if (badge) return { el: badge, kind: 'stat', content: miniBadgeContent(badge.dataset.miniBadgeTooltip ?? '', tRef.current) };

      const stat = target.closest<HTMLElement>('[data-stat-tooltip]');
      if (stat) return { el: stat, kind: 'stat', content: statContent(stat.dataset.statTooltip ?? '', tRef.current) };

      const obs = target.closest<HTMLElement>('[data-obs-tooltip]');
      if (obs) return { el: obs, kind: 'stat', content: obsContent(obs.dataset.obsTooltip ?? '', tRef.current) };

      const cachePanel = target.closest<HTMLElement>('[data-cache-panel-tooltip]');
      if (cachePanel) return { el: cachePanel, kind: 'stat', content: cachePanelContent(cachePanel.dataset.cachePanelTooltip ?? '', tRef.current) };

      const cacheCell = target.closest<HTMLElement>('.cache-cell');
      if (cacheCell) {
        return {
          el: cacheCell,
          kind: 'cache',
          read: parseInt(cacheCell.dataset.cacheRead ?? '', 10) || 0,
          write: parseInt(cacheCell.dataset.cacheWrite ?? '', 10) || 0,
        };
      }
      return null;
    }

    function hideAll(): void {
      statEl.style.display = 'none';
      cacheEl.style.display = 'none';
    }

    function showStat(content: TooltipContent, clientX: number, clientY: number): void {
      cacheEl.style.display = 'none';
      statEl.innerHTML = renderStatHtml(content);
      statEl.style.display = 'block';
      positionAtCursor(statEl, clientX, clientY, 220);
    }

    function showCache(read: number, write: number, clientX: number, clientY: number): void {
      statEl.style.display = 'none';
      const writeRow = write > 0
        ? `<div class="cache-tooltip-row"><span class="cache-tooltip-label">Write</span><span class="cache-tooltip-value write">${fmtNum(write)} tokens</span></div>`
        : '';
      cacheEl.innerHTML =
        `<div class="cache-tooltip-title">Prompt Cache</div>` +
        `<div class="cache-tooltip-row"><span class="cache-tooltip-label">Read</span><span class="cache-tooltip-value read">${fmtNum(read)} tokens</span></div>` +
        writeRow;
      cacheEl.style.display = 'block';
      positionAtCursor(cacheEl, clientX, clientY, 220);
    }

    function onMouseOver(e: MouseEvent): void {
      if (pointHoverActive) return; // 포인트 수치 툴팁 표시 중에는 설명 툴팁 억제
      const hit = resolve(e.target);
      if (!hit) return;
      if (hit.kind === 'cache') {
        showCache(hit.read, hit.write, e.clientX, e.clientY);
      } else if (hit.content) {
        showStat(hit.content, e.clientX, e.clientY);
      }
    }

    /**
     * 차트 데이터 포인트 호버 — 수치 툴팁으로 전환(레거시 stat-tooltip.js ctx-point-hover 구독).
     * detail=null(이탈)이면 플래그 해제 + 툴팁 숨김(다음 mouseover 가 설명 툴팁 복원).
     */
    function onPointHover(ev: Event): void {
      const detail = (ev as CustomEvent).detail as CtxPointHoverDetail | null;
      if (detail && typeof detail.turnIndex === 'number') {
        pointHoverActive = true;
        cacheEl.style.display = 'none';
        statEl.innerHTML = renderPointHoverHtml(detail, tRef.current);
        statEl.style.display = 'block';
        positionAbove(statEl, detail.clientX, detail.clientY, 220);
      } else {
        pointHoverActive = false;
        statEl.style.display = 'none';
      }
    }

    /**
     * 전체 요청 타임라인 포인트 호버 — "시각 · N건" 툴팁(Chart.tsx timeline-point-hover 구독).
     * ctx-point-hover 와 동일하게 pointHoverActive 로 설명 툴팁을 억제하고 positionAbove 로 배치.
     */
    function onTimelineHover(ev: Event): void {
      const detail = (ev as CustomEvent).detail as TimelineHoverDetail | null;
      if (detail && typeof detail.count === 'number') {
        pointHoverActive = true;
        cacheEl.style.display = 'none';
        statEl.innerHTML = renderStatHtml({
          title: detail.label,
          desc: tRef.current('ui.chart.count-unit', { count: detail.count.toLocaleString() }),
        });
        statEl.style.display = 'block';
        positionAbove(statEl, detail.clientX, detail.clientY, 160);
      } else {
        pointHoverActive = false;
        statEl.style.display = 'none';
      }
    }

    function onMouseMove(e: MouseEvent): void {
      if (pointHoverActive) return; // 포인트 수치 툴팁은 ctx-point-hover 가 위치까지 직접 관리
      const statVisible = statEl.style.display !== 'none';
      const cacheVisible = cacheEl.style.display !== 'none';
      if (!statVisible && !cacheVisible) return;
      const hit = resolve(e.target);
      if (!hit) {
        hideAll();
        return;
      }
      // 트리거 종류가 바뀌면(예: stat → cache) 내용 재바인딩, 아니면 위치만 갱신(레거시 position(e)).
      if (hit.kind === 'cache') {
        if (!cacheVisible) showCache(hit.read, hit.write, e.clientX, e.clientY);
        else positionAtCursor(cacheEl, e.clientX, e.clientY, 220);
      } else {
        if (hit.content) {
          if (!statVisible) showStat(hit.content, e.clientX, e.clientY);
          else positionAtCursor(statEl, e.clientX, e.clientY, 220);
        } else {
          hideAll();
        }
      }
    }

    function onMouseOut(e: MouseEvent): void {
      if (!resolve(e.target)) return;
      hideAll();
    }

    doc.addEventListener('mouseover', onMouseOver);
    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('mouseout', onMouseOut);
    doc.addEventListener('ctx-point-hover', onPointHover);
    doc.addEventListener('timeline-point-hover', onTimelineHover);

    return () => {
      doc.removeEventListener('mouseover', onMouseOver);
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('mouseout', onMouseOut);
      doc.removeEventListener('ctx-point-hover', onPointHover);
      doc.removeEventListener('timeline-point-hover', onTimelineHover);
      statEl.remove();
      cacheEl.remove();
    };
  }, []);
}
