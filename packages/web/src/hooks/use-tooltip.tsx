/**
 * hooks/use-tooltip.ts — 전역 호버 툴팁 시스템 (React Portal 포팅, B-1)
 *
 * 레거시(spyglass-legacy-ref/packages/web/assets/js):
 *   - stat-tooltip.js  → [data-stat-tooltip] / [data-ctx-tooltip] / [data-mini-badge-tooltip]
 *   - obs-tooltip.js   → [data-obs-tooltip]
 *   - cache-panel-tooltip.js → [data-cache-panel-tooltip]
 *   - cache-tooltip.js → .cache-cell (data-cache-read / data-cache-write)
 *
 * 레거시는 4개의 분리된 init* 함수가 각자 .stat-tooltip / .cache-tooltip DOM 을 만들고
 *   document 레벨 mouseover/mousemove/mouseout 위임을 따로 걸었다(동일 패턴 4중 복제).
 *
 * React 포팅(B-1 — imperative DOM → Portal):
 *   과거 1차 포팅은 useTooltip() 훅이 document.createElement/appendChild/innerHTML 로 floating
 *   요소 2개를 명령형 생성해 React 통일성을 깼다. 본 리팩토링은 단일 <TooltipLayer/> 컴포넌트가
 *   React 상태(activeTip)로 표시 내용을 들고 createPortal(document.body) 로 .stat-tooltip /
 *   .cache-tooltip 을 선언적으로 렌더한다(innerHTML 제거). 위치 계산(absolute)·cleanup lifecycle 은
 *   유지한다. AppShell 이 <TooltipLayer/> 를 1회 마운트한다(과거 useTooltip() 호출 대체).
 *
 * 비침습(per-component 무수정): 각 컴포넌트(TimelineMeta/Chart/CachePanel/ObsPanel/badges/cells)에
 *   이미 data-*-tooltip 속성·.cache-cell 마크업이 존재한다. 본 레이어는 핸들러만 document 에 위임으로
 *   붙이므로 컴포넌트 JSX 수정이 필요 없다.
 *
 * point-hover(A-2 — CustomEvent → store): 차트 데이터 포인트 호버(ctx/timeline)는 더 이상 document
 *   CustomEvent 가 아니라 stores/tooltip-store 를 구독한다. 차트(발행) → store.setPointHover →
 *   TooltipLayer(소비) 가 수치 툴팁을 표시한다(차트=발행 / 툴팁=표시 단일책임 분리 유지).
 *
 * 범용 data-tip 채널(단일 게이트 통합): 과거 산재하던 네이티브 `title` 속성(브라우저 기본 툴팁 —
 *   ≈0.5~1.5초 지연·위치/스타일/줄바꿈 제어 불가·터치 미지원)을 본 레이어로 흡수한다. data-*-tooltip
 *   계열이 i18n 키 사전 매핑(statContent 등)인 것과 달리, data-tip 은 **이미 번역된 raw 텍스트**를
 *   그대로 표시한다(동적 식별자·자유 문장 대응). 선택적 data-tip-title 로 2단(제목+본문). i18n 변환이
 *   없으므로 호출처는 t(...) 결과나 동적 값을 그대로 넣는다. → 즉시 노출 + 커서 추종 + 뷰포트 보정 공유.
 *
 * focus 지원(접근성): 네이티브 title 은 키보드 포커스로 뜨지 않았다. 본 레이어는 focusin/focusout 도
 *   위임해 data-tip/data-*-tooltip 요소가 포커스될 때 요소 박스(getBoundingClientRect) 기준으로 툴팁을
 *   표시한다(키보드/스크린리더 사용자 대응 — 네이티브 대비 순개선).
 *
 * i18n: 콘텐츠 키는 'ui:stat-tooltip.*' / 'ui:obs-tooltip.*' / 'ui:cache-panel.*'. react-i18next t 를
 *   useTranslation 으로 받아 모듈 헬퍼(statContent 등)에 인자로 주입(레거시 window.I18n/tt 직접참조 폐기).
 *
 * 위치: 레거시는 커서 추종(position(e): clientX+8 / clientY+12, viewport 충돌 시 반대편 뒤집기)을 썼다 —
 *   본 포팅도 동일(트리거 기준 anchor 가 아닌 커서 기준이 레거시 동작). pointer-events:none CSS 라
 *   툴팁 자체가 mouseout 을 유발하지 않는다.
 *
 * 레이어(architecture.md §1.3): hooks leaf. app(AppShell)이 유일 소비처. useTranslation 으로 t 취득.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { positionAbovePoint } from '../features/dashboard/tooltip';
import type { CtxPointHoverDetail } from '../features/dashboard/context-chart-data';
import { useTooltipStore } from '../stores/tooltip-store';

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
  const ns = `ui:stat-tooltip.${key}`;
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
  const ns = `ui:stat-tooltip.${key}`;
  const title = t(`${ns}.title`);
  if (title === `${ns}.title`) return null;
  return { title, desc: t(`${ns}.desc`) };
}

/**
 * data-mini-badge-tooltip 값 → i18n 키. 레거시 MINI_BADGE_TOOLTIP(stat-tooltip.js:9) 1:1.
 * anomaly mini-badge: spike / loop / slow / error / cache (desc 만, title 없음).
 */
function miniBadgeContent(key: string, t: TFunc): TooltipContent | null {
  const ns = `ui:stat-tooltip.badge.${key}`;
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
  const ns = `ui:obs-tooltip.${key}`;
  const title = t(`${ns}.title`);
  if (title === `${ns}.title`) return null;
  return { title, desc: t(`${ns}.desc`) };
}

/**
 * data-cache-panel-tooltip 값 → i18n 키. 레거시 CACHE_PANEL_TOOLTIP_CONTENT(cache-panel-tooltip.js:2) 1:1.
 * Cache Intelligence Panel: hit-rate / ratio.
 */
function cachePanelContent(key: string, t: TFunc): TooltipContent | null {
  const ns = `ui:cache-panel.${key}`;
  const title = t(`${ns}.title`);
  if (title === `${ns}.title`) return null;
  return { title, desc: t(`${ns}.desc`) };
}

/** 천단위 콤마(en-US) — 레거시 cache-tooltip.js fmtNum 1:1. */
function fmtNum(n: number): string {
  return Number(n).toLocaleString('en-US');
}

/** desc 의 \n → <br> 선언적 변환(레거시 renderStatHtml 의 replace(/\n/g,'<br>') 동치). */
function descLines(desc: string): ReactNode {
  const parts = desc.split('\n');
  return parts.map((line, i) => (
    <span key={i}>
      {line}
      {i < parts.length - 1 ? <br /> : null}
    </span>
  ));
}

/** TooltipContent → .stat-tooltip 내부 JSX(레거시 renderStatHtml 선언화 — innerHTML 폐기). */
function StatBody({ content }: { content: TooltipContent }): ReactElement {
  return (
    <>
      {content.title ? <div className="stat-tooltip-title">{content.title}</div> : null}
      <div className="stat-tooltip-desc">{descLines(content.desc)}</div>
    </>
  );
}

/** ctx-point-hover detail → .stat-tooltip 본문 content(레거시 renderPointHoverHtml 산술 1:1). */
function pointHoverContent(detail: CtxPointHoverDetail, t: TFunc): TooltipContent {
  const ns = 'ui:stat-tooltip.point-hover';
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
  return { title, desc: lines.join('\n') };
}

/** 표시할 cache 셀 수치(read/write). write<=0 이면 Write 행 생략(레거시 cache-tooltip.js 동치). */
interface CacheTip {
  read: number;
  write: number;
}

/** .cache-tooltip 내부 JSX(레거시 cache-tooltip.js innerHTML 선언화). */
function CacheBody({ read, write }: CacheTip): ReactElement {
  return (
    <>
      <div className="cache-tooltip-title">Prompt Cache</div>
      <div className="cache-tooltip-row">
        <span className="cache-tooltip-label">Read</span>
        <span className="cache-tooltip-value read">{fmtNum(read)} tokens</span>
      </div>
      {write > 0 ? (
        <div className="cache-tooltip-row">
          <span className="cache-tooltip-label">Write</span>
          <span className="cache-tooltip-value write">{fmtNum(write)} tokens</span>
        </div>
      ) : null}
    </>
  );
}

/** 활성 툴팁 — kind 로 .stat-tooltip / .cache-tooltip 분기. 위치는 별도 pos state(루프 차단). */
type ActiveTip =
  | { kind: 'stat'; content: TooltipContent }
  | { kind: 'cache'; cache: CacheTip }
  | null;

/**
 * 커서 추종 위치 — 레거시 position(e)(stat-tooltip.js:69) 1:1. 우하단(+8/+12), viewport 넘침 시 뒤집기.
 * 측정된 요소 크기(measured)가 없으면 fallback 폭/높이로 1차 추정(다음 프레임 재측정).
 */
function positionAtCursor(
  clientX: number,
  clientY: number,
  measured: { w: number; h: number },
): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = clientX + 8;
  let y = clientY + 12;
  if (x + measured.w > vw) x = clientX - measured.w - 8;
  if (y + measured.h > vh) y = clientY - measured.h - 8;
  return { x, y };
}

/**
 * 점 위 배치 — 위치 산술 SSoT(tooltip.ts positionAbovePoint)에 위임.
 * ctx/timeline point-hover 수치 툴팁 전용(레거시 stat-tooltip.js positionAt 동치).
 */
function positionAbove(
  clientX: number,
  clientY: number,
  measured: { w: number; h: number },
): { x: number; y: number } {
  return positionAbovePoint(
    { x: clientX, y: clientY },
    { width: measured.w, height: measured.h },
    { width: window.innerWidth, height: window.innerHeight },
  );
}

/**
 * 전역 호버 툴팁 레이어 — AppShell 에서 <TooltipLayer/> 로 1회 마운트.
 *
 * document 위임으로 [data-stat-tooltip] / [data-ctx-tooltip] / [data-mini-badge-tooltip] /
 *   [data-obs-tooltip] / [data-cache-panel-tooltip] / .cache-cell 를 감지하고, stores/tooltip-store 의
 *   point-hover 를 구독해 단일 floating 툴팁을 createPortal 로 표시한다(레거시 4개 init* 통합).
 */
export function TooltipLayer(): ReactElement | null {
  const { t } = useTranslation();
  const tRef = useRef<TFunc>(t);
  tRef.current = t as TFunc;

  // 표시 내용(stat/cache/null) — 위치(pos)와 분리해 위치 보정이 내용 effect 를 재트리거하지 않게 한다(루프 차단).
  const [tip, setTip] = useState<ActiveTip>(null);
  // 표시 px 좌표 — useLayoutEffect 가 실측 후 설정. pos 변경은 tip effect 를 재실행하지 않는다(별도 state).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // 마지막으로 setState 한 좌표(ref) — setPos 호출 *자체*를 게이트한다(아래 repositionFromCursor 주석 참조).
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  // 마지막 커서 좌표 — 포인트호버는 차트가 좌표를 직접 주고, 설명 툴팁은 mouse 이벤트가 준다.
  const cursorRef = useRef<{ x: number; y: number; above: boolean } | null>(null);
  // 측정 후 위치 보정을 위한 ref(absolute positioning, pointer-events:none).
  const statElRef = useRef<HTMLDivElement>(null);
  const cacheElRef = useRef<HTMLDivElement>(null);
  // 포인트호버(차트) 활성 시 설명 툴팁(mouse 위임)을 억제(레거시 _pointHoverActive). ref 로 들어 리스너 재등록 회피.
  const pointHoverActiveRef = useRef(false);

  /** 현재 표시된 floating 요소의 실측 크기(없으면 fallback). cursor-follow/초기 보정 공용. */
  const measure = (): { w: number; h: number } => {
    const el = cacheElRef.current ?? statElRef.current;
    return { w: el?.offsetWidth || 220, h: el?.offsetHeight || 60 };
  };
  /**
   * cursorRef 기준 px 좌표 산정(above 면 점 위, 아니면 커서 추종). pos state 갱신.
   *
   * ★ref-guard 필수(React #185 차단) — bail 을 setState updater *안*이 아니라 *바깥*에서 한다.
   *   positionAtCursor/positionAbove 는 매 호출 새 {x,y} 를 반환한다. setPos 의 함수형 updater 안에서
   *   같은 값이면 prev 를 반환하는 식으로 bail 해도, **setState 호출 자체가 nested-update 로 카운트**된다(React 가 같은 값인지
   *   알려면 일단 렌더 패스를 스케줄해야 하기 때문). useLayoutEffect([tip]) 가 커밋마다 도는 상황과 결합하면
   *   매 커밋 setPos 가 enqueue 되어 update depth 가 쌓이고 #185(Maximum update depth)로 흰 화면이 된다
   *   (data-tip 밀집 화면=메타 문서 카탈로그 진입 시 재현 — 실측: measure/next 가 고정이어도 55회 폭주).
   *   → 좌표가 실제로 바뀌었을 때만 setPos 를 **호출**해 enqueue 자체를 막는다(lastPosRef SSoT).
   */
  const repositionFromCursor = (): void => {
    const cur = cursorRef.current;
    if (!cur) return;
    const m = measure();
    const next = cur.above ? positionAbove(cur.x, cur.y, m) : positionAtCursor(cur.x, cur.y, m);
    const last = lastPosRef.current;
    if (last && last.x === next.x && last.y === next.y) return; // 좌표 불변 → setState 미호출(enqueue 방지)
    lastPosRef.current = next;
    setPos(next);
  };

  // ── point-hover(차트) 구독 — A-2: ctx/timeline CustomEvent → tooltip-store ──
  const pointHover = useTooltipStore((s) => s.pointHover);
  useEffect(() => {
    if (pointHover) {
      pointHoverActiveRef.current = true;
      const above = true;
      cursorRef.current = { x: pointHover.detail.clientX, y: pointHover.detail.clientY, above };
      if (pointHover.kind === 'ctx') {
        setTip({ kind: 'stat', content: pointHoverContent(pointHover.detail, tRef.current) });
      } else {
        setTip({
          kind: 'stat',
          content: {
            title: pointHover.detail.label,
            desc: tRef.current('ui:chart.count-unit', { count: pointHover.detail.count.toLocaleString() }),
          },
        });
      }
    } else {
      pointHoverActiveRef.current = false;
      // 차트 호버 해제 — 설명 툴팁이 다음 mouseover 로 복원되도록 숨김.
      setTip((cur) => (cur ? null : cur));
    }
  }, [pointHover]);

  // ── document 위임 — [data-*-tooltip] / .cache-cell 설명·캐시 툴팁 ──
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;

    /** 가장 가까운 트리거 element 와 분류 해석. 우선순위는 레거시 mouseover 분기 순서 1:1. */
    function resolve(target: EventTarget | null):
      | { kind: 'stat'; content: TooltipContent | null }
      | { kind: 'cache'; cache: CacheTip }
      | null {
      if (!(target instanceof Element)) return null;
      // 키 기반 채널 — i18n 사전에 매핑된 content 가 있을 때만 채택하고, 없으면(미등록 키) 다음 채널로
      //   fall-through 한다. 죽은 키가 같은 요소의 data-tip(raw) 을 가리던 문제 차단.
      const ctx = target.closest<HTMLElement>('[data-ctx-tooltip]');
      if (ctx) { const c = ctxContent(ctx.dataset.ctxTooltip ?? '', tRef.current); if (c) return { kind: 'stat', content: c }; }
      const badge = target.closest<HTMLElement>('[data-mini-badge-tooltip]');
      if (badge) { const c = miniBadgeContent(badge.dataset.miniBadgeTooltip ?? '', tRef.current); if (c) return { kind: 'stat', content: c }; }
      const stat = target.closest<HTMLElement>('[data-stat-tooltip]');
      if (stat) { const c = statContent(stat.dataset.statTooltip ?? '', tRef.current); if (c) return { kind: 'stat', content: c }; }
      const obs = target.closest<HTMLElement>('[data-obs-tooltip]');
      if (obs) { const c = obsContent(obs.dataset.obsTooltip ?? '', tRef.current); if (c) return { kind: 'stat', content: c }; }
      const cachePanel = target.closest<HTMLElement>('[data-cache-panel-tooltip]');
      if (cachePanel) { const c = cachePanelContent(cachePanel.dataset.cachePanelTooltip ?? '', tRef.current); if (c) return { kind: 'stat', content: c }; }
      const cacheCell = target.closest<HTMLElement>('.cache-cell');
      if (cacheCell) {
        return {
          kind: 'cache',
          cache: {
            read: parseInt(cacheCell.dataset.cacheRead ?? '', 10) || 0,
            write: parseInt(cacheCell.dataset.cacheWrite ?? '', 10) || 0,
          },
        };
      }
      // 범용 raw-text 채널(최저 우선순위) — 네이티브 title 흡수. i18n 변환 없이 그대로 표시.
      const tip = target.closest<HTMLElement>('[data-tip]');
      if (tip) {
        const desc = tip.dataset.tip ?? '';
        if (!desc) return null; // 빈 data-tip 은 무시(과거 빈 title 동치)
        const title = tip.dataset.tipTitle;
        return { kind: 'stat', content: { title: title || undefined, desc } };
      }
      return null;
    }

    /** 포커스/호버 트리거 요소의 박스 하단을 anchor 좌표로 — focus 표시(커서 좌표 부재) 시 사용. */
    function anchorOf(target: EventTarget | null): { x: number; y: number } | null {
      if (!(target instanceof Element)) return null;
      const trigger = target.closest<HTMLElement>(
        '[data-tip],[data-ctx-tooltip],[data-mini-badge-tooltip],[data-stat-tooltip],[data-obs-tooltip],[data-cache-panel-tooltip],.cache-cell',
      );
      if (!trigger) return null;
      const r = trigger.getBoundingClientRect();
      return { x: r.left, y: r.bottom };
    }

    function showFromHit(hit: NonNullable<ReturnType<typeof resolve>>, clientX: number, clientY: number): void {
      cursorRef.current = { x: clientX, y: clientY, above: false };
      // 내용이 직전과 동일하면 동일 참조 반환 → React 재렌더 bail-out(cursor-follow 는 pos state 만 갱신).
      setTip((cur) => {
        if (hit.kind === 'cache') {
          if (cur?.kind === 'cache' && cur.cache.read === hit.cache.read && cur.cache.write === hit.cache.write) return cur;
          return { kind: 'cache', cache: hit.cache };
        }
        if (!hit.content) return cur;
        if (cur?.kind === 'stat' && cur.content.title === hit.content.title && cur.content.desc === hit.content.desc) return cur;
        return { kind: 'stat', content: hit.content };
      });
    }

    function onMouseOver(e: MouseEvent): void {
      if (pointHoverActiveRef.current) return; // 포인트 수치 툴팁 표시 중엔 설명 툴팁 억제
      const hit = resolve(e.target);
      if (!hit) return;
      if (hit.kind === 'cache' || hit.content) showFromHit(hit, e.clientX, e.clientY);
    }

    function onMouseMove(e: MouseEvent): void {
      if (pointHoverActiveRef.current) return; // 포인트 수치 툴팁은 차트가 좌표까지 직접 관리
      const hit = resolve(e.target);
      if (!hit || (hit.kind === 'stat' && !hit.content)) {
        setTip((cur) => (cur ? null : cur));
        return;
      }
      // 같은 트리거 위 이동 → 커서 추종 위치만 갱신(내용 동일 시 setTip 은 동일 참조 반환 → 재렌더 회피).
      showFromHit(hit, e.clientX, e.clientY);
      repositionFromCursor();
    }

    function onMouseOut(e: MouseEvent): void {
      if (pointHoverActiveRef.current) return;
      if (!resolve(e.target)) return;
      setTip((cur) => (cur ? null : cur));
    }

    // 키보드 포커스 — 네이티브 title 이 못 하던 접근성. 커서 좌표가 없으므로 요소 박스 하단을 anchor 로.
    function onFocusIn(e: FocusEvent): void {
      if (pointHoverActiveRef.current) return;
      const hit = resolve(e.target);
      if (!hit || (hit.kind === 'stat' && !hit.content)) return;
      const at = anchorOf(e.target);
      if (!at) return;
      cursorRef.current = { x: at.x, y: at.y, above: false };
      setTip((cur) => {
        if (hit.kind === 'cache') {
          if (cur?.kind === 'cache' && cur.cache.read === hit.cache.read && cur.cache.write === hit.cache.write) return cur;
          return { kind: 'cache', cache: hit.cache };
        }
        if (!hit.content) return cur;
        if (cur?.kind === 'stat' && cur.content.title === hit.content.title && cur.content.desc === hit.content.desc) return cur;
        return { kind: 'stat', content: hit.content };
      });
    }

    function onFocusOut(e: FocusEvent): void {
      if (pointHoverActiveRef.current) return;
      if (!resolve(e.target)) return;
      setTip((cur) => (cur ? null : cur));
    }

    doc.addEventListener('mouseover', onMouseOver);
    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('mouseout', onMouseOut);
    doc.addEventListener('focusin', onFocusIn);
    doc.addEventListener('focusout', onFocusOut);
    return () => {
      doc.removeEventListener('mouseover', onMouseOver);
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('mouseout', onMouseOut);
      doc.removeEventListener('focusin', onFocusIn);
      doc.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // 위치 보정 — 내용(tip) 변경 시 렌더 후 실측 크기로 px 좌표 산정(레거시 position* 가 offsetWidth/Height
  //   를 읽던 것 대응). pos 는 별도 state 라 본 effect 를 재트리거하지 않는다(무한 루프 차단). 커서 추종은
  //   move 핸들러가 repositionFromCursor 로 pos 만 갱신한다. paint 전 보정(useLayoutEffect)으로 깜빡임 방지.
  useLayoutEffect(() => {
    if (!tip) {
      // null 복귀도 ref-guard — 이미 null 이면 setState 미호출(불필요 리렌더/누적 방지).
      if (lastPosRef.current !== null) {
        lastPosRef.current = null;
        setPos(null);
      }
      return;
    }
    repositionFromCursor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip]);

  const doc = (globalThis as { document?: Document }).document;
  if (!doc?.body) return null; // SSR 안전
  if (!tip) return null;

  const style: CSSProperties = pos
    ? { display: 'block', left: `${pos.x}px`, top: `${pos.y}px` }
    : { display: 'block', left: '-9999px', top: '-9999px' }; // 측정 전 off-screen(깜빡임 방지)

  if (tip.kind === 'cache') {
    return createPortal(
      <div ref={cacheElRef} className="cache-tooltip" style={style}>
        <CacheBody read={tip.cache.read} write={tip.cache.write} />
      </div>,
      doc.body,
    );
  }
  return createPortal(
    <div ref={statElRef} className="stat-tooltip" style={style}>
      <StatBody content={tip.content} />
    </div>,
    doc.body,
  );
}
