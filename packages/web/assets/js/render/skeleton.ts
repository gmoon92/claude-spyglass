// 영역별 Skeleton placeholder 빌더 (skeleton-loading ADR-003)
//
// 변경 이유: skeleton 토큰·shimmer 정책·영역별 모양 — cells.js 의 "테이블 셀" 단일 책임과
// 분리해 변경 이유별 묶음으로 운용. cells.js#makeSkeletonRows 는 본 모듈로 위임.
//
// SSoT 계약 (ADR-004): 모든 빌더가 만드는 root element 는 data-skeleton="1" attribute 를
// 부여한다. main.js#prependRequest 가 첫 호출 시 [data-skeleton] 을 일괄 제거해 SSE
// 흐름과 비충돌. 호출 측은 이 attribute 를 임의로 제거하지 말 것.

// ──────────────────────────────────────────────────────────────────────────
// 1) Primitive — 인라인 한 줄 / 블록 / 원 / 바
// ──────────────────────────────────────────────────────────────────────────

// @ts-check

/**
 * 한 줄 placeholder.
 * @param {{ width?: string|number, height?: string|number, className?: string }} [opts]
 */
export function skLine({ width, height, className = '' }: { width?: string|number; height?: string|number; className?: string } = {}) {
  const style = _styleSize(width, height);
  return `<span class="sk sk-line ${className}" ${style}></span>`;
}

/** @param {{ width?: string|number, height?: string|number, className?: string }} [opts] */
export function skBlock({ width, height, className = '' }: { width?: string|number; height?: string|number; className?: string } = {}) {
  const style = _styleSize(width, height);
  return `<span class="sk sk-block ${className}" ${style}></span>`;
}

/** @param {{ size?: string|number, className?: string }} [opts] */
export function skCircle({ size, className = '' }: { size?: string|number; className?: string } = {}) {
  const style = size != null ? ` style="width:${_unit(size)};height:${_unit(size)}"` : '';
  return `<span class="sk sk-circle ${className}"${style}></span>`;
}

/** @param {{ width?: string|number, height?: string|number, className?: string }} [opts] */
export function skBar({ width, height, className = '' }: { width?: string|number; height?: string|number; className?: string } = {}) {
  const style = _styleSize(width, height);
  return `<span class="sk sk-bar ${className}" ${style}></span>`;
}

// ──────────────────────────────────────────────────────────────────────────
// 2) 테이블 행 (skTableRows) — cells.js#makeSkeletonRows 가 위임
// ──────────────────────────────────────────────────────────────────────────

/**
 * 테이블 가짜 row 들. colSpecs 가 number 이면 colspan 단일 셀(이전 호환),
 * Array 이면 컬럼별 line width 를 % 로 받아 실제 컬럼 폭을 흉내낸다.
 *
 * @param {number|Array<string>} colSpecs
 *   - number: colspan 총합 (이전 호환: 단일 셀 안에 점 하나)
 *   - Array<string>: ['60%', '80%', ...] 컬럼 수 = 배열 길이
 * @param {number} count 반복 row 수
 */
export function skTableRows(colSpecs, count = 2) {
  if (typeof colSpecs === 'number') {
    // 호환: 기존 makeSkeletonRows(cols, count) 동작
    const row = `<tr data-skeleton="1"><td colspan="${colSpecs}" class="table-empty"><span class="sk sk-line sk-line--inline"></span></td></tr>`;
    return row.repeat(count);
  }
  const cellsHtml = colSpecs
    .map((w) => `<td><span class="sk sk-line" style="width:${_unit(w)}"></span></td>`)
    .join('');
  const row = `<tr data-skeleton="1">${cellsHtml}</tr>`;
  return row.repeat(count);
}

// ──────────────────────────────────────────────────────────────────────────
// 3) 좌측 패널 — 프로젝트 / 세션 row
// ──────────────────────────────────────────────────────────────────────────

/**
 * 프로젝트 행 (3 컬럼: 이름 / 활성수 / 토큰 바).
 * colgroup width(auto / 52px / 92px) 와 일관.
 */
export function skProjectRows(count = 4) {
  const row = `<tr data-skeleton="1">
    <td class="cell-proj-name"><span class="sk sk-line" style="width:70%"></span></td>
    <td class="num" style="text-align:right"><span class="sk sk-line sk-line--inline" style="width:20px"></span></td>
    <td>
      <div class="bar-cell" style="justify-content:flex-end;gap:4px">
        <div class="bar-track" style="min-width:36px"><span class="sk sk-bar" style="width:60%"></span></div>
        <span class="bar-label num-hi" style="min-width:30px"><span class="sk sk-line sk-line--inline" style="width:24px"></span></span>
      </div>
    </td>
  </tr>`;
  return row.repeat(count);
}

/**
 * 좌측 세션 행 (실제 makeSessionRow 와 시각적으로 동일한 높이).
 * 세션 row 는 sess-row-* 4 셀 구조이므로 4 컬럼 + 행 패딩.
 */
export function skSessionRows(count = 4) {
  const row = `<tr data-skeleton="1" class="sk--dim">
    <td><span class="sk sk-circle sk-circle--sm"></span></td>
    <td><span class="sk sk-line" style="width:78%"></span></td>
    <td class="num" style="text-align:right"><span class="sk sk-line sk-line--inline" style="width:28px"></span></td>
    <td class="num" style="text-align:right"><span class="sk sk-line sk-line--inline" style="width:36px"></span></td>
  </tr>`;
  return row.repeat(count);
}

// ──────────────────────────────────────────────────────────────────────────
// 4) Obs-panel 4 카드 (burn / cache / pulse / tools)
// ──────────────────────────────────────────────────────────────────────────

/**
 * obs-card 1개의 내부 HTML. obs-panel.js 의 4 위젯 출력 모양을 흉내.
 *  - burn  : value + trend + sub + spark
 *  - cache : value + dot + sub + spark
 *  - pulse : value + trend + sub + spark
 *  - tools : 4 row (name + bar + pct)
 *
 * 호출 측은 article.obs-card 요소의 innerHTML 로 사용. root에 data-skeleton 부여를
 * 위해 article 자체에 attribute 가 필요한 경우 _withRoot helper 호출.
 */
export function skObsCard(variant = 'burn') {
  if (variant === 'tools') {
    const rows = Array.from({ length: 4 }).map(() => `
      <div class="obs-cat-row">
        <span class="obs-cat-name"><span class="sk sk-line sk-line--sm" style="width:60%"></span></span>
        <div class="obs-cat-bar"><span class="sk sk-bar" style="width:${40 + Math.floor(Math.random() * 40)}%"></span></div>
        <span class="obs-cat-pct"><span class="sk sk-line sk-line--inline" style="width:30px"></span></span>
      </div>
    `).join('');
    return `<div class="obs-card-tools" data-skeleton="1">${rows}</div>`;
  }
  // burn / cache / pulse 공통 모양 (value + trend + sub + spark)
  return `
    <span class="obs-card-value" data-skeleton="1"><span class="sk sk-line" style="width:60%;height:14px"></span></span>
    <span class="obs-card-trend"><span class="sk sk-line sk-line--inline" style="width:32px"></span></span>
    <span class="obs-card-sub"><span class="sk sk-line" style="width:70%;height:9px"></span></span>
    <span class="obs-card-spark"><span class="sk sk-block" style="width:76px;height:24px"></span></span>
  `;
}

// ──────────────────────────────────────────────────────────────────────────
// 5) Detail 턴 뷰 — turn 카드
// ──────────────────────────────────────────────────────────────────────────

/**
 * turn 카드 1개. 실제 turn-card 구조(turn-card-summary > turn-card-header + turn-card-preview)
 * 와 시각 높이가 일치하도록. 펼침 X — summary 만 노출.
 */
export function skTurnCard() {
  return `
    <article class="turn-card sk-turn-card" data-skeleton="1">
      <div class="turn-card-summary">
        <div class="turn-card-header">
          <span class="turn-card-index"><span class="sk sk-line sk-line--inline" style="width:18px;height:9px"></span></span>
          <span class="sk sk-line" style="width:55%"></span>
          <span class="sk sk-line sk-line--inline" style="width:48px;margin-left:auto"></span>
        </div>
        <div class="turn-card-preview">
          <span class="sk sk-line" style="width:88%"></span>
        </div>
      </div>
    </article>
  `;
}

export function skTurnCardList(count = 5) {
  return Array.from({ length: count }).map(() => skTurnCard()).join('');
}

// ──────────────────────────────────────────────────────────────────────────
// 6) Detail LLM Input / SysLib / Behavior Definitions / 도구 매트릭스
// ──────────────────────────────────────────────────────────────────────────

/**
 * LLM Input 탭 — system 카드 1개 + user 카드 N개 흉내.
 */
export function skLlmInputCards(messageCount = 2) {
  const userCards = Array.from({ length: messageCount }).map(() => `
    <section class="llm-input-msg sk-card" data-skeleton="1">
      <header class="llm-input-msg-header">
        <span class="sk sk-line" style="width:80px;height:10px"></span>
      </header>
      <div class="llm-input-msg-body sk-card">
        <span class="sk sk-line" style="width:95%"></span>
        <span class="sk sk-line" style="width:88%"></span>
        <span class="sk sk-line" style="width:60%"></span>
      </div>
    </section>
  `).join('');
  return `
    <section class="llm-input-system sk-card" data-skeleton="1">
      <header class="llm-input-msg-header">
        <span class="sk sk-line" style="width:120px;height:10px"></span>
      </header>
      <div class="llm-input-msg-body">
        <span class="sk sk-block" style="height:180px"></span>
      </div>
    </section>
    ${userCards}
  `;
}

/**
 * System 라이브러리 — dedup 카드 N개.
 */
export function skSysLibCards(count = 4) {
  const card = `
    <article class="syslib-card sk-card" data-skeleton="1">
      <header>
        <span class="sk sk-line" style="width:60%"></span>
      </header>
      <div>
        <span class="sk sk-line sk-line--sm" style="width:40%"></span>
        <span class="sk sk-bar" style="width:70%;margin-top:6px"></span>
      </div>
    </article>
  `;
  return card.repeat(count);
}

/**
 * Behavior Definitions 카탈로그 — 테이블 row 흉내. meta-docs-view 의 컬럼 구조와 일관.
 * 컬럼: 이름 / 출처 / 호출수 / 행위
 */
export function skMetaDocList(count = 8) {
  const row = `
    <tr data-skeleton="1">
      <td><span class="sk sk-line" style="width:70%"></span></td>
      <td><span class="sk sk-line" style="width:80%"></span></td>
      <td style="text-align:right"><span class="sk sk-line sk-line--inline" style="width:28px"></span></td>
      <td><span class="sk sk-line sk-line--inline" style="width:40px"></span></td>
    </tr>
  `;
  return `<table class="meta-docs-table"><tbody>${row.repeat(count)}</tbody></table>`;
}

/**
 * 도구 매트릭스 — 헤더 + row 6개.
 */
export function skToolMatrix(count = 6) {
  const headers = `
    <div class="ts-mx-header sk-row" data-skeleton="1">
      <span class="sk sk-line sk-line--sm" style="width:80px"></span>
      <span class="sk sk-line sk-line--sm" style="width:48px"></span>
      <span class="sk sk-line sk-line--sm" style="width:48px"></span>
      <span class="sk sk-line sk-line--sm" style="width:48px"></span>
    </div>
  `;
  const row = `
    <div class="ts-mx-row sk-row" data-skeleton="1">
      <span class="sk sk-line" style="width:70%"></span>
      <span class="sk sk-bar" style="width:80%"></span>
      <span class="sk sk-line sk-line--inline" style="width:30px"></span>
      <span class="sk sk-line sk-line--inline" style="width:30px"></span>
    </div>
  `;
  return `<div class="ts-mx ts-mx--skeleton">${headers}${row.repeat(count)}</div>`;
}

// ──────────────────────────────────────────────────────────────────────────
// 7) Donut legend (typeLegend / 4 카테고리)
// ──────────────────────────────────────────────────────────────────────────

/**
 * 도넛 옆 legend — dot + 이름 + 값.
 */
export function skDonutLegend(count = 4) {
  const item = `
    <div class="type-legend-item sk-row" data-skeleton="1" style="grid-template-columns: auto 1fr auto; padding:4px 0">
      <span class="sk sk-circle sk-circle--sm"></span>
      <span class="sk sk-line sk-line--sm" style="width:60%"></span>
      <span class="sk sk-line sk-line--sm sk-line--inline" style="width:28px"></span>
    </div>
  `;
  return item.repeat(count);
}

// ──────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ──────────────────────────────────────────────────────────────────────────

function _unit(v) {
  if (v == null) return '100%';
  if (typeof v === 'number') return `${v}px`;
  return String(v);
}

function _styleSize(width, height) {
  const parts = [];
  if (width != null)  parts.push(`width:${_unit(width)}`);
  if (height != null) parts.push(`height:${_unit(height)}`);
  return parts.length ? `style="${parts.join(';')}"` : '';
}
