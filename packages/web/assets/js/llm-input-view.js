/**
 * llm-input-view.js — LLM Input 탭 (v23 llm-input-accordion ADR-002)
 *
 * 책임:
 *  - 한 proxy 요청을 LLM이 받은 그대로의 입력(system blocks + user messages)으로 노출.
 *  - system 본문은 system_hash로 lazy-fetch (`GET /api/system-prompts/:hash`).
 *  - user messages는 zstd 디코드된 결과를 서버에서 받음 (`GET /api/proxy-requests/:id/messages`).
 *  - billing-header(idx[0])는 별도 'meta' 섹션으로 시각 분리 — prompt 본문 아님 명시.
 *
 * 메시지 아코디언 (ADR-002):
 *  - 각 user/assistant 메시지는 <details> 요소로 래핑, 기본 collapsed.
 *  - role === 'system' 메시지는 <details open>으로 페이지 로딩 시 펼침.
 *  - 메시지 섹션 상단 "전체 펼침 / 전체 접기" 컨트롤로 일괄 토글.
 *  - 검색바: 입력 시 매칭 메시지 자동 펼침 + <mark> highlight.
 *
 * state.expandedMessages: Set<string>
 *  - 사용자가 펼친 메시지 ID(예: 'm-3') 추적 — 검색 매칭 시 추가, summary 클릭 동기화.
 *
 * 호출자:
 *  - turn-views.js setDetailView('llm') — 탭 진입 시 가장 최근 proxy 요청을 fetch + 렌더.
 *
 * 의존성:
 *  - escHtml: 외부 입력 안전 렌더
 *  - fetch API
 *
 * API 응답 형태 참고:
 *  GET /api/proxy-requests           → { data: [{id, model, timestamp, system_hash, ...}, ...] }
 *  GET /api/proxy-requests/:id/messages → { data: { id, system_hash, system_byte_size, messages, decode_error? } }
 *  GET /api/system-prompts/:hash     → { data: { hash, content, byte_size, segment_count, ... } }
 */

import { escHtml, fmtTime, fmtToken, shortModelName } from './formatters.js';
import { asEl, asDetails, asInput } from './dom.js';
import { skLlmInputCards } from './render/skeleton.js';
import { getSelectedSession } from './state.js';
import { svgSearch, svgChevron, svgInfo } from './render/icons.js';
import { renderCloseBtn } from './design-system/primitives/close-button.js';

const CONTAINER_ID = 'llmInputBody';

/** 메시지 summary 미리보기 길이 (정책 — 처음 100자) */
const SUMMARY_PREVIEW_LEN = 100;

/** 검색 매칭 최소 길이 — 너무 짧은 입력으로 모든 메시지 펼침 방지 */
const SEARCH_MIN_LEN = 2;

/**
 * role별 아이콘 — summary 좌측 프리픽스 (ADR-002 §결정 §4).
 *
 * 이모지에서 인라인 SVG로 교체 (svg-role-icons pass) — 다크 테마 시각 일관성을 위한
 * line-icon 패밀리. viewBox 0 0 16 16 / stroke 1.5 / round join·cap / currentColor 통일.
 * 색상은 CSS의 .llm-input-msg--<role> .llm-input-msg-role-icon { color: ... }로 결정.
 */
const ROLE_ICON_SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="1em" height="1em" '
  + 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

const ROLE_ICON = {
  user: `<svg ${ROLE_ICON_SVG_ATTRS}>`
    + '<circle cx="8" cy="5.5" r="2.5"/>'
    + '<path d="M2.5 13.5c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5"/>'
    + '</svg>',
  assistant: `<svg ${ROLE_ICON_SVG_ATTRS}>`
    + '<rect x="2" y="3" width="12" height="8" rx="2"/>'
    + '<circle cx="5.5" cy="7" r="1" fill="currentColor" stroke="none"/>'
    + '<circle cx="10.5" cy="7" r="1" fill="currentColor" stroke="none"/>'
    + '<path d="M5.5 13.5L8 11l2.5 2.5"/>'
    + '</svg>',
  system: `<svg ${ROLE_ICON_SVG_ATTRS}>`
    + '<rect x="4" y="7" width="8" height="6.5" rx="1"/>'
    + '<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'
    + '</svg>',
  tool: `<svg ${ROLE_ICON_SVG_ATTRS}>`
    + '<path d="M10.5 2a3 3 0 0 1 .6 3.4l-.2.4 3.1 3.1a1 1 0 1 1-1.4 1.4L9.5 7.2l-.4.2A3 3 0 1 1 10.5 2z"/>'
    + '</svg>',
  tool_use: `<svg ${ROLE_ICON_SVG_ATTRS}>`
    + '<path d="M10.5 2a3 3 0 0 1 .6 3.4l-.2.4 3.1 3.1a1 1 0 1 1-1.4 1.4L9.5 7.2l-.4.2A3 3 0 1 1 10.5 2z"/>'
    + '<path d="M2 13.5l2.5-2.5"/>'
    + '</svg>',
  tool_result: `<svg ${ROLE_ICON_SVG_ATTRS}>`
    + '<rect x="3" y="2" width="10" height="12" rx="1.5"/>'
    + '<path d="M5.5 6.5h5"/>'
    + '<path d="M5.5 9h3"/>'
    + '<path d="M9 11.5l1.5 1.5 2.5-2.5"/>'
    + '</svg>',
};

/**
 * 아코디언 펼침 상태 추적 (페이지 로드 시 초기화 — sessionStorage 미사용).
 *  - summary 클릭/Space toggle → details change 이벤트로 동기화
 *  - "전체 펼침/접기" 버튼 → 일괄 set/clear
 *  - 검색 매칭 → 매칭 메시지 ID add (미매칭 메시지는 이전 상태 유지)
 *
 * @type {{ expandedMessages: Set<string>, currentSearch: string }}
 */
const state = {
  expandedMessages: new Set(),
  currentSearch: '',
};

/**
 * 현재 세션의 proxy_requests 캐시 — 드롭다운 선택기 + 딥링크용 (proxy-selector pass).
 *
 * - sessionId가 바뀌면 무효화. 같은 세션 안에서는 SSE로 새 요청이 들어와도 한 번 fetch한 결과를 재사용
 *   (현재는 SSE 가입 안 함 — 사용자가 탭 재진입하면 자연 갱신). 향후 SSE 가입은 후속.
 * - _pendingTargetTs: 턴뷰 → API 페이로드 딥링크 1회용. setPendingProxyTargetTs(ts) 후
 *   다음 showLatestLlmInput()이 가장 가까운 proxy를 자동 선택하고 nulled out.
 */
let _sessionProxyList = [];
let _sessionProxyListSessionId = null;
let _pendingTargetTs = null;

/**
 * 턴뷰 카드의 "API 페이로드" 액션이 호출. 다음 showLatestLlmInput() 1회만 ts에 가장 가까운
 * proxy를 선택. setDetailView('llm')이 자동으로 showLatestLlmInput을 호출하므로 호출자는
 * 이 함수 → setDetailTab('llm') → setDetailView('llm') 순서로 부르면 된다.
 */
export function setPendingProxyTargetTs(ts) {
  _pendingTargetTs = typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
}

async function ensureSessionProxyList(sessionId) {
  if (!sessionId) return [];
  if (_sessionProxyListSessionId === sessionId && _sessionProxyList.length > 0) {
    return _sessionProxyList;
  }
  try {
    const res = await fetchJson(`/api/proxy-requests?session_id=${encodeURIComponent(sessionId)}&limit=500`);
    _sessionProxyList = Array.isArray(res?.data) ? res.data : [];
    _sessionProxyListSessionId = sessionId;
  } catch {
    _sessionProxyList = [];
    _sessionProxyListSessionId = sessionId;
  }
  return _sessionProxyList;
}

function findClosestProxyToTs(ts) {
  if (!_sessionProxyList.length) return null;
  return _sessionProxyList.reduce((a, b) =>
    Math.abs((b.timestamp ?? 0) - ts) < Math.abs((a.timestamp ?? 0) - ts) ? b : a);
}

/**
 * 탭 진입 시 활성 세션의 proxy 요청을 자동 로드.
 *
 * 동작 우선순위:
 *  1. setPendingProxyTargetTs(ts)가 직전 호출된 상태면 ts에 가장 가까운 proxy 선택 (턴뷰 딥링크).
 *  2. 활성 세션이 있으면 그 세션의 가장 최근 proxy 선택 (proxy-selector pass).
 *  3. 활성 세션이 없으면 전역에서 가장 최근 proxy 1건 (탭만 떼서 보는 케이스 폴백).
 *
 * 후속 확장 포인트:
 *  - SSE로 새 proxy 도착 시 드롭다운 자동 갱신 토글
 */
export async function showLatestLlmInput() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;
  const t = window.I18n?.t ?? ((k) => k);

  // skeleton-loading T-10: system 카드(큰 본문) + user 카드 2개로 구조 유지.
  container.innerHTML = skLlmInputCards(2);

  const sessionId = getSelectedSession();
  const pendingTs = _pendingTargetTs;
  _pendingTargetTs = null; // 1회용 소비

  try {
    if (sessionId) {
      const list = await ensureSessionProxyList(sessionId);
      if (list.length === 0) {
        container.innerHTML = renderEmptySessionHtml(sessionId);
        return;
      }
      const target = (pendingTs != null && findClosestProxyToTs(pendingTs))
        || list[list.length - 1];
      await renderLlmInput(target.id);
      return;
    }
    // 세션 컨텍스트 없는 경우 — 전역 latest로 폴백
    const recent = await fetchJson('/api/proxy-requests?limit=1');
    const list = Array.isArray(recent?.data) ? recent.data : [];
    if (list.length === 0) {
      container.innerHTML = `<div class="state-empty"><span class="state-empty-title">${t('ui.llm-input.no-recent-proxy')}</span></div>`;
      return;
    }
    await renderLlmInput(list[0].id);
  } catch (err) {
    container.innerHTML = `<div class="state-empty"><span class="state-empty-title">${t('ui.llm-input.load-failed', { message: escHtml(String(err?.message ?? err)) })}</span></div>`;
  }
}

function renderEmptySessionHtml(sessionId) {
  const t = window.I18n?.t ?? ((k) => k);
  return `<div class="state-empty">
    <span class="state-empty-title">${t('ui.llm-input.no-session-proxy')}</span>
    <span class="state-empty-sub">${t('ui.llm-input.session-id-label')} <code>${escHtml(sessionId.slice(0, 12))}…</code></span>
  </div>`;
}

/**
 * 특정 proxy 요청의 LLM Input을 렌더한다.
 *
 *  1. /api/proxy-requests/:id/messages → system_hash + messages 수신
 *  2. system_hash 있으면 /api/system-prompts/:hash → system 본문 수신
 *  3. system blocks(meta + body) + user messages 시퀀스로 한 화면 렌더
 *
 * @param {string} requestId  proxy_requests.id
 */
export async function renderLlmInput(requestId) {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;
  const t = window.I18n?.t ?? ((k) => k);

  // 신규 요청 로드 시 아코디언 상태 리셋 — 다른 요청 잔여 ID 혼입 방지.
  resetAccordionState();

  // skeleton-loading T-10: 특정 ID 로드 시에도 동일 placeholder 사용 (system 1 + user 2 카드).
  container.innerHTML = skLlmInputCards(2);

  try {
    const msgRes = await fetchJson(`/api/proxy-requests/${encodeURIComponent(requestId)}/messages`);
    const data = msgRes?.data;
    if (!data) {
      container.innerHTML = `<div class="state-empty"><span class="state-empty-title">${t('ui.llm-input.request-not-found', { id: escHtml(requestId) })}</span></div>`;
      return;
    }

    const messages = Array.isArray(data.messages) ? data.messages : [];
    const systemHash = data.system_hash || null;
    const systemSize = data.system_byte_size || null;
    const decodeError = data.decode_error || null;

    // system 본문은 hash 있을 때만 lazy-fetch
    let systemContent = null;
    let systemMeta = null;
    if (systemHash) {
      try {
        const sysRes = await fetchJson(`/api/system-prompts/${encodeURIComponent(systemHash)}`);
        systemContent = sysRes?.data?.content ?? null;
        systemMeta = sysRes?.data ?? null;
      } catch {
        // system 본문 fetch 실패 — meta만 표시
      }
    }

    container.innerHTML = renderHtml({
      requestId,
      systemHash,
      systemSize,
      systemContent,
      systemMeta,
      messages,
      decodeError,
    });

    bindAccordionEvents(container);
  } catch (err) {
    container.innerHTML = `<div class="state-empty"><span class="state-empty-title">${t('ui.llm-input.load-failed', { message: escHtml(String(err?.message ?? err)) })}</span></div>`;
  }
}

// =============================================================================
// 내부 helper
// =============================================================================

/**
 * 골격 렌더 — 단일 책임으로 HTML 조립만.
 *
 * 구조 (ADR-002 옵션 C):
 *   <header>   요청 ID + system_hash 8자 + size 라벨
 *   <section.llm-input-system>   system blocks (meta 분리 + 본문, 항상 펼침)
 *   <section.llm-input-messages> messages 아코디언 (기본 collapsed, system role만 open)
 *     ├─ 컨트롤 바: 검색 + 전체 펼침 + 전체 접기
 *     └─ <details data-message-id="m-N">...</details> 시퀀스
 */
function renderHtml(p) {
  const t = window.I18n?.t ?? ((k) => k);
  // 배너 — proxy 데이터의 본질(hook 관측과 다름)을 사용자가 즉시 인지 (banner pass).
  const bannerHtml = `
    <div class="llm-input-banner" role="note">
      <span class="llm-input-banner-icon" aria-hidden="true">${svgInfo({ size: 12, className: 'ds-icon' })}</span>
      <span class="llm-input-banner-text">
        ${t('ui.llm-input.banner-text')}
      </span>
    </div>`;

  // 세션 proxy 선택기 — 현재 세션의 모든 proxy 요청을 timestamp 오름차순으로 노출.
  // 세션 컨텍스트가 없으면 (전역 latest 폴백) 드롭다운 생략.
  const selectorHtml = _sessionProxyList.length > 0
    ? renderProxySelector(p.requestId)
    : '';

  const headerHtml = `
    <header class="llm-input-header">
      <span class="llm-input-rid">request: <code>${escHtml(p.requestId)}</code></span>
      ${p.systemHash
        ? `<span class="llm-input-hash">system: <code>${escHtml(p.systemHash.slice(0, 12))}…</code></span>`
        : `<span class="llm-input-hash llm-input-hash--empty">${t('ui.llm-input.system-none')}</span>`}
      ${p.systemSize ? `<span class="llm-input-size">${formatBytes(p.systemSize)}</span>` : ''}
      ${p.decodeError ? `<span class="llm-input-error" title="${escHtml(p.decodeError)}">${t('ui.llm-input.payload-decode-failed')}</span>` : ''}
    </header>`;

  const systemHtml = p.systemHash
    ? renderSystemSection(p.systemContent, p.systemMeta, p.systemHash)
    : `<section class="llm-input-system llm-input-system--empty"><p>${t('ui.llm-input.no-system-field')}</p></section>`;

  const messagesHtml = renderMessagesSection(p.messages);

  return bannerHtml + selectorHtml + headerHtml + systemHtml + messagesHtml;
}

/**
 * 세션 내 proxy 요청 드롭다운 — timestamp 오름차순 + 활성 ID 자동 선택 (proxy-selector pass).
 *
 * 옵션 라벨: `#idx HH:mm:ss · {model-short} · IN+OUT · id-12자`
 * 컨테이너 id `llm-input-proxy-select`는 bindAccordionEvents에서 change 핸들러 매칭에 사용.
 */
function renderProxySelector(activeId) {
  const t = window.I18n?.t ?? ((k) => k);
  const total = _sessionProxyList.length;
  const options = _sessionProxyList.map((r, i) => {
    const idx = i + 1;
    const ts  = r.timestamp ? fmtTime(r.timestamp) : '—';
    const model = r.model ? shortModelName(r.model) : '?';
    const tokIn  = r.tokens_input  ?? 0;
    const tokOut = r.tokens_output ?? 0;
    const tok = (tokIn || tokOut)
      ? `${fmtToken(tokIn)}+${fmtToken(tokOut)}`
      : '—';
    const idShort = (r.id || '').slice(0, 12);
    const label = `#${idx}  ${ts} · ${model} · ${tok} · ${idShort}…`;
    const selected = r.id === activeId ? ' selected' : '';
    return `<option value="${escHtml(r.id)}"${selected}>${escHtml(label)}</option>`;
  }).join('');
  return `
    <div class="llm-input-proxy-selector">
      <label class="llm-input-proxy-selector-label" for="llm-input-proxy-select">
        ${t('ui.llm-input.proxy-selector-label', { count: total })}
      </label>
      <select id="llm-input-proxy-select" class="llm-input-proxy-select" data-proxy-select>
        ${options}
      </select>
    </div>`;
}

/**
 * system blocks 섹션 — billing-header(meta) 분리 + 본문 표시.
 *
 * 정규화 단계에서 idx[0] billing-header는 이미 제거됐으므로 systemContent 자체에는 본문만 들어있음.
 * 단 화면에는 "정규화 본문임" 명시 + segment_count 같은 메타도 표시 — 디버깅 용이.
 *
 * 정책: 시스템 섹션은 기본 펼침이지만 사용자가 접을 수 있도록 <details open>로 래핑
 * (system-accordion pass). 긴 system 본문(수십 KB)이 Messages 도달까지 스크롤을 점유하는
 * 부담을 사용자가 직접 조절 가능. 빈/로딩 변형은 접을 내용이 없으므로 <section> 유지.
 */
function renderSystemSection(content, meta, systemHash) {
  const t = window.I18n?.t ?? ((k) => k);
  if (!content) {
    return `<section class="llm-input-system llm-input-system--loading">
      <h3>System Prompt</h3>
      <p class="llm-input-dim">${t('ui.llm-input.system-load-failed')}</p>
    </section>`;
  }

  // 메타 칩 — 영어 키(DB 컬럼명 그대로) 라벨 + title 툴팁에 한국어 설명 (label-clarity pass v2).
  // ref_count는 클릭 가능한 button — 같은 hash 참조 proxy_requests 드릴다운 (ref-drilldown pass).
  const refCount = meta?.ref_count ?? 0;
  const refsBtn = systemHash
    ? `<button type="button" class="llm-input-meta-chip llm-input-refs-toggle"
        data-refs-hash="${escHtml(systemHash)}"
        aria-haspopup="dialog" aria-expanded="false"
        title="${t('ui.llm-input.ref-count-btn-title', { count: refCount })}">ref_count: ${refCount}</button>`
    : `<span title="${t('ui.llm-input.ref-count-span-title')}">ref_count: ${refCount}</span>`;

  const metaLine = meta
    ? `<div class="llm-input-system-meta">
        <span title="${t('ui.llm-input.segment-count-title')}">segment_count: ${meta.segment_count ?? '?'}</span>
        <span title="${t('ui.llm-input.byte-size-title')}">byte_size: ${formatBytes(meta.byte_size ?? content.length)}</span>
        ${refsBtn}
      </div>`
    : '';

  // 제목 "System" — 아래 "Messages" 섹션과 대문자 형식 일치.
  // 기술 세부(billing-header 제외 정규화)는 summary의 title 툴팁에 보존.
  return `<details class="llm-input-system" open>
    <summary class="llm-input-system-summary" title="${t('ui.llm-input.system-summary-title')}">System</summary>
    ${metaLine}
    <pre class="llm-input-system-content">${escHtml(content)}</pre>
  </details>`;
}

/**
 * user messages 시퀀스 섹션 — 아코디언 마크업 (ADR-002).
 *
 * 각 메시지를 <details>로 래핑:
 *  - role === 'system' → <details open> (페이지 로딩 시 펼침)
 *  - 그 외 role        → <details>      (기본 collapsed)
 *
 * <summary> 포맷: role-chip + 미리보기(100자) + idx badge
 *
 * 상단 컨트롤:
 *  - 검색 입력(매칭 시 auto-open + <mark>)
 *  - "전체 펼침" / "전체 접기" 버튼
 */
function renderMessagesSection(messages) {
  const t = window.I18n?.t ?? ((k) => k);
  if (!messages.length) {
    return `<section class="llm-input-messages"><h3>Messages (0)</h3><p class="llm-input-dim">${t('ui.llm-input.no-messages')}</p></section>`;
  }

  const items = messages.map((m, i) => renderMessageDetails(m, i)).join('');

  return `<section class="llm-input-messages">
    <header class="llm-input-messages-header">
      <h3>Messages (${messages.length})</h3>
      ${renderMessagesControls()}
    </header>
    <div class="llm-input-messages-list">${items}</div>
  </section>`;
}

/**
 * messages 섹션 상단 컨트롤 바 — 검색 + 전체 펼침/접기.
 *
 * 검색바는 messages 영역 안에서만 동작 (전역 검색 아님). highlight는 <mark> 태그로.
 * "전체 접기"는 시스템 메시지도 함께 접는다 (사용자가 의도적으로 닫고 싶을 때 보장).
 */
function renderMessagesControls() {
  const t = window.I18n?.t ?? ((k) => k);
  return `
    <div class="llm-input-messages-controls">
      <label class="llm-input-search">
        <span class="llm-input-search-icon" aria-hidden="true">${svgSearch({ size: 14 })}</span>
        <input
          type="search"
          class="llm-input-search-input"
          data-messages-search
          placeholder="${t('ui.llm-input.search-placeholder')}"
          aria-label="${t('ui.llm-input.search-aria-label')}"
        />
      </label>
      <div class="llm-input-messages-bulk">
        <button type="button" class="llm-input-expand-all" data-action="expand-all" title="${t('ui.llm-input.expand-all-title')}">
          ${svgChevron({ dir: 'down', size: 10 })} ${t('ui.llm-input.expand-all')}
        </button>
        <button type="button" class="llm-input-collapse-all" data-action="collapse-all" title="${t('ui.llm-input.collapse-all-title')}">
          ${svgChevron({ dir: 'right', size: 10 })} ${t('ui.llm-input.collapse-all')}
        </button>
      </div>
    </div>
  `;
}

/**
 * 개별 메시지 <details> 마크업.
 *
 * data-message-id="m-N" (N=index) — change 이벤트 핸들러에서 state 동기화에 사용.
 * data-message-role/preview — 검색 매칭 시 raw 원문에서 검색하고 highlight 갱신할 때 사용.
 *
 * @param {{role?: string, content: any}} m
 * @param {number} i  message index
 */
function renderMessageDetails(m, i) {
  const role = String(m?.role ?? 'unknown');
  const id = `m-${i}`;
  const isSystem = role === 'system';
  const openAttr = isSystem ? ' open' : '';
  if (isSystem) state.expandedMessages.add(id);

  const previewText = previewFromContent(m?.content);
  const icon = ROLE_ICON[role] ?? '•';
  const body = renderMessageBody(m?.content);

  return `<details
    class="llm-input-msg llm-input-msg--${escHtml(role)}"
    data-message-id="${id}"
    data-message-role="${escHtml(role)}"
    data-message-preview="${escHtml(previewText)}"
   ${openAttr}>
    <summary class="llm-input-msg-head">
      <span class="llm-input-msg-role"><span class="llm-input-msg-role-icon" aria-hidden="true">${icon}</span>${escHtml(role)}</span>
      <span class="llm-input-msg-preview">${escHtml(previewText)}</span>
      <span class="llm-input-msg-idx">#${i + 1}</span>
    </summary>
    <div class="llm-input-msg-body">${body}</div>
  </details>`;
}

/**
 * content에서 미리보기 텍스트 추출 — string은 그대로, array는 text 파트 join.
 * 100자 초과 시 ellipsis. 줄바꿈은 공백으로 평탄화.
 */
function previewFromContent(content) {
  let raw = '';
  if (typeof content === 'string') {
    raw = content;
  } else if (Array.isArray(content)) {
    raw = content
      .map(part => {
        if (!part || typeof part !== 'object') return '';
        if (part.type === 'text' && typeof part.text === 'string') return part.text;
        // tool_use/tool_result 등은 type 라벨만 노출 (본문 JSON은 펼침 시 표시)
        return `[${String(part.type ?? 'part')}]`;
      })
      .filter(Boolean)
      .join(' ');
  }
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= SUMMARY_PREVIEW_LEN) return flat || '(empty)';
  return flat.slice(0, SUMMARY_PREVIEW_LEN) + '…';
}

/** message.content를 직렬화 — text는 pre, tool_*는 details 그대로 유지. */
function renderMessageBody(content) {
  if (typeof content === 'string') {
    return `<pre class="llm-input-msg-text">${escHtml(content)}</pre>`;
  }
  if (Array.isArray(content)) {
    return content.map(part => {
      if (!part || typeof part !== 'object') return '';
      const type = String(part.type ?? 'unknown');
      if (type === 'text' && typeof part.text === 'string') {
        return `<pre class="llm-input-msg-text">${escHtml(part.text)}</pre>`;
      }
      // tool_use, tool_result 등은 JSON 그대로 — 디자이너가 후속에서 시각 다듬음
      return `<details class="llm-input-msg-part"><summary>${escHtml(type)}</summary><pre>${escHtml(safeStringify(part))}</pre></details>`;
    }).join('');
  }
  return '<span class="llm-input-dim">(empty content)</span>';
}

// =============================================================================
// 아코디언 이벤트 — change(개별 토글) · click(전체 펼침/접기) · input(검색)
// =============================================================================

/**
 * 아코디언 이벤트를 컨테이너에 한 곳에서 위임 등록.
 *
 * 캡슐화 원칙(CLAUDE.md): 호출 측에서 boolean 재계산하지 않고,
 * raw event를 핸들러에 넘기고 판단(어떤 details/어떤 버튼)은 핸들러 안에서.
 */
function bindAccordionEvents(container) {
  container.addEventListener('change', onAccordionChange);
  container.addEventListener('click', onControlsClick);
  container.addEventListener('input', onSearchInput);
}

/**
 * <details> open 속성 변화 시 호출됨 (UA 기본 이벤트).
 *  - 사용자가 summary 클릭 / Space·Enter / 프로그램으로 details.open = true 등 모두 발생
 *  - state.expandedMessages에 ID 추가/제거하여 동기화
 */
function onAccordionChange(e) {
  // Proxy 선택기 변경 — change 이벤트가 <select>에서도 발생하므로 같은 핸들러에서 분기 (proxy-selector pass).
  const sel = e.target.closest('[data-proxy-select]');
  if (sel) {
    const newId = sel.value;
    if (newId) renderLlmInput(newId);
    return;
  }
  const details = e.target.closest('details.llm-input-msg');
  if (!details) return;
  const id = details.dataset.messageId;
  if (!id) return;
  if (details.open) {
    state.expandedMessages.add(id);
  } else {
    state.expandedMessages.delete(id);
  }
}

/**
 * "전체 펼침" / "전체 접기" 버튼 클릭 + ref_count 칩 클릭 (ref-drilldown pass).
 *  - 버튼 자체에 data-action 속성으로 분기 (캡슐화: 핸들러 내부 판단)
 *  - [data-refs-hash] 매칭 시 같은 hash의 참조 proxy_requests 팝오버 토글
 *  - [data-refs-jump-id] 매칭 시 같은 세션의 다른 proxy로 점프 (renderLlmInput)
 */
function onControlsClick(e) {
  // ref_count 칩 — 참조 목록 팝오버 토글 (ref-drilldown pass).
  // 팝오버 자체는 document.body에 append되어 container 밖이므로 내부 항목 클릭은
  // onRefsPopoverDocClick에서 별도 처리. 여기서는 칩 토글만.
  const refsBtn = e.target.closest('[data-refs-hash]');
  if (refsBtn) {
    toggleRefsPopover(refsBtn);
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'expand-all') setAllExpanded(true);
  else if (action === 'collapse-all') setAllExpanded(false);
}

// =============================================================================
// ref_count 드릴다운 팝오버 (ref-drilldown pass)
// =============================================================================

let _refsPopoverEl = null;       // 현재 열린 팝오버 DOM (또는 null)
let _refsPopoverHash = null;     // 어느 hash의 팝오버인지 — 같은 칩 재클릭 시 닫기 토글
let _refsPopoverChip = null;     // anchor chip (aria-expanded 동기화용)

function toggleRefsPopover(chipEl) {
  const hash = chipEl.dataset.refsHash;
  if (!hash) return;
  // 같은 chip 재클릭 → 닫기
  if (_refsPopoverHash === hash && _refsPopoverEl) {
    closeRefsPopover();
    return;
  }
  // 다른 chip 열림 상태 → 먼저 닫기
  closeRefsPopover();
  openRefsPopover(chipEl, hash);
}

async function openRefsPopover(chipEl, hash) {
  _refsPopoverHash = hash;
  _refsPopoverChip = chipEl;
  chipEl.setAttribute('aria-expanded', 'true');

  // 로딩 상태 팝오버 먼저 표시 → fetch 완료 후 내용 교체
  const popover = document.createElement('div');
  popover.className = 'llm-input-refs-popover';
  popover.setAttribute('role', 'dialog');
  const t = window.I18n?.t ?? ((k) => k);
  popover.setAttribute('aria-label', t('ui.llm-input.refs-popover-aria-label'));
  popover.innerHTML = `
    <header class="llm-input-refs-popover-header">
      <span><strong>${t('ui.llm-input.refs-popover-title')}</strong> <span class="llm-input-refs-popover-sub">${t('ui.llm-input.refs-popover-loading')}</span></span>
      ${renderCloseBtn({ size: 'sm', label: t('ui.llm-input.refs-close-label'), dataAttrs: { 'refs-close': '' } }).replace('class="ds-close-btn"', 'class="ds-close-btn llm-input-refs-popover-close"')}
    </header>
    <div class="llm-input-refs-popover-body">
      <p class="llm-input-dim" style="padding:var(--space-3);">${t('ui.llm-input.refs-popover-wait')}</p>
    </div>`;
  document.body.appendChild(popover);
  _refsPopoverEl = popover;
  positionRefsPopover(popover, chipEl);

  // 글로벌 listener — 외부 클릭/ESC 닫기 (한번 등록)
  document.addEventListener('click', onRefsPopoverDocClick, true);
  document.addEventListener('keydown', onRefsPopoverKeydown);

  // fetch
  try {
    const res = await fetchJson(`/api/system-prompts/${encodeURIComponent(hash)}/refs?limit=100`);
    const refs = Array.isArray(res?.data) ? res.data : [];
    if (_refsPopoverEl !== popover) return; // 다른 액션으로 이미 닫힘
    renderRefsPopoverBody(popover, refs, hash);
    positionRefsPopover(popover, chipEl); // 본문 크기 바뀌면 재정렬
  } catch (err) {
    if (_refsPopoverEl !== popover) return;
    const body = popover.querySelector('.llm-input-refs-popover-body');
    if (body) body.innerHTML = `<p class="llm-input-dim" style="padding:var(--space-3);color:var(--error)">${t('ui.llm-input.refs-popover-load-failed', { message: escHtml(String(err?.message ?? err)) })}</p>`;
  }
}

function renderRefsPopoverBody(popover, refs, hash) {
  const t = window.I18n?.t ?? ((k) => k);
  const currentSession = getSelectedSession();
  const total = refs.length;
  const headerSub = popover.querySelector('.llm-input-refs-popover-sub');
  if (headerSub) headerSub.textContent = t('ui.llm-input.refs-popover-count', { count: total, hash: hash.slice(0, 12) });

  if (total === 0) {
    const body = popover.querySelector('.llm-input-refs-popover-body');
    if (body) body.innerHTML = `<p class="llm-input-dim" style="padding:var(--space-3);">${t('ui.llm-input.refs-popover-empty')}</p>`;
    return;
  }

  const itemsHtml = refs.map((r, i) => {
    const idx = i + 1;
    const ts = r.timestamp ? fmtTime(r.timestamp) : '—';
    const model = r.model ? shortModelName(r.model) : '?';
    const tokIn = r.tokens_input ?? 0;
    const tokOut = r.tokens_output ?? 0;
    const tok = (tokIn || tokOut) ? `${fmtToken(tokIn)}+${fmtToken(tokOut)}` : '—';
    const isSameSession = r.session_id && r.session_id === currentSession;
    const sessionLabel = !r.session_id
      ? `<span class="ref-cell ref-session ref-other" title="${t('ui.llm-input.ref-session-unspecified')}">—</span>`
      : isSameSession
        ? `<span class="ref-cell ref-session ref-same">${t('ui.llm-input.ref-session-current')}</span>`
        : `<span class="ref-cell ref-session ref-other" title="${escHtml(r.session_id)}">${escHtml(r.session_id.slice(0, 8))}…</span>`;
    const jumpAttrs = isSameSession
      ? ` data-refs-jump-id="${escHtml(r.id)}" role="button" tabindex="0" title="${t('ui.llm-input.ref-jump-title')}"`
      : ` title="${t('ui.llm-input.ref-other-session-title')}"`;
    const itemCls = `llm-input-ref-item${isSameSession ? ' llm-input-ref-item--same' : ''}`;
    return `<li class="${itemCls}"${jumpAttrs}>
      <span class="ref-cell ref-idx">#${idx}</span>
      <span class="ref-cell ref-time">${ts}</span>
      <span class="ref-cell ref-model">${escHtml(model)}</span>
      ${sessionLabel}
      <span class="ref-cell ref-tokens">${tok}</span>
    </li>`;
  }).join('');

  const body = popover.querySelector('.llm-input-refs-popover-body');
  if (body) body.innerHTML = `<ul class="llm-input-refs-list">${itemsHtml}</ul>`;
}

function positionRefsPopover(popover, chipEl) {
  const rect = chipEl.getBoundingClientRect();
  // 폭은 컨테이너 기준 최대치, 위치는 chip 아래 6px 띄움. 화면 우측 넘침 보정.
  const maxWidth = Math.min(560, window.innerWidth - 24);
  popover.style.width = maxWidth + 'px';
  let left = rect.left;
  if (left + maxWidth > window.innerWidth - 12) left = window.innerWidth - 12 - maxWidth;
  if (left < 12) left = 12;
  popover.style.left = left + 'px';
  popover.style.top = (rect.bottom + 6) + 'px';
}

function closeRefsPopover() {
  if (_refsPopoverChip) _refsPopoverChip.setAttribute('aria-expanded', 'false');
  if (_refsPopoverEl) _refsPopoverEl.remove();
  _refsPopoverEl = null;
  _refsPopoverHash = null;
  _refsPopoverChip = null;
  document.removeEventListener('click', onRefsPopoverDocClick, true);
  document.removeEventListener('keydown', onRefsPopoverKeydown);
}

function onRefsPopoverDocClick(e) {
  if (!_refsPopoverEl) return;
  // 닫기 버튼
  if (e.target.closest('[data-refs-close]')) {
    closeRefsPopover();
    return;
  }
  // 같은 세션 참조 항목 클릭 → 해당 proxy로 점프 (팝오버는 container 밖이라 여기서 처리)
  const refItem = e.target.closest('[data-refs-jump-id]');
  if (refItem && _refsPopoverEl.contains(refItem)) {
    const proxyId = refItem.dataset.refsJumpId;
    closeRefsPopover();
    if (proxyId) renderLlmInput(proxyId);
    return;
  }
  // 팝오버 내부 그 외 클릭 — 닫지 않음
  if (_refsPopoverEl.contains(e.target)) return;
  // chip 자신 클릭은 toggleRefsPopover가 토글 처리 — 여기선 close 안 함
  if (_refsPopoverChip && _refsPopoverChip.contains(e.target)) return;
  closeRefsPopover();
}

function onRefsPopoverKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeRefsPopover();
  }
}

/**
 * 모든 메시지 details를 일괄 펼침/접기 + state 동기화.
 *
 * 정책 (ADR-002 §결정):
 *  - 전체 펼침: 시스템 포함 모든 메시지 open
 *  - 전체 접기: 시스템 포함 모든 메시지 close (사용자가 의도적으로 닫고 싶을 때 보장)
 *
 * @param {boolean} open
 */
function setAllExpanded(open) {
  const all = document.querySelectorAll('details.llm-input-msg');
  all.forEach(node => {
    const d = asDetails(node);
    d.open = open;
    const id = d.dataset.messageId;
    if (!id) return;
    if (open) state.expandedMessages.add(id);
    else state.expandedMessages.delete(id);
  });
}

/**
 * 메시지 검색 입력 — 매칭 메시지 자동 펼침 + <mark> highlight.
 *
 * 정책 (ADR-002 §결정 §검색 자동오픈):
 *  - 입력 < SEARCH_MIN_LEN: highlight 제거, open 상태는 그대로 유지 (사용자 의도 보존)
 *  - 매칭 메시지: details.open = true + body 내 텍스트에 <mark> 래핑
 *  - 미매칭 메시지: 이전 상태 유지 (open이면 open, closed면 closed)
 */
function onSearchInput(e) {
  const input = asInput(asEl(e.target).closest('[data-messages-search]'));
  if (!input) return;
  const term = String(input.value || '').trim();
  state.currentSearch = term;
  applySearchHighlight(term);
}

/**
 * 검색어를 메시지 body에 적용 — 매칭 메시지만 펼치고 <mark> 표시.
 *
 * @param {string} term
 */
function applySearchHighlight(term) {
  const all = document.querySelectorAll('details.llm-input-msg');
  const tooShort = term.length < SEARCH_MIN_LEN;

  all.forEach(node => {
    const d = asDetails(node);
    const body = d.querySelector('.llm-input-msg-body');
    if (!body) return;

    // 1. 이전 highlight 복원
    body.querySelectorAll('mark.llm-input-mark').forEach(mk => {
      const parent = mk.parentNode;
      while (mk.firstChild) parent.insertBefore(mk.firstChild, mk);
      parent.removeChild(mk);
      parent.normalize();
    });

    if (tooShort) return; // 짧은 입력은 highlight 제거만 하고 open 상태 보존

    // 2. preview/body 텍스트에서 매칭 여부 판단
    const preview = String(d.dataset.messagePreview || '').toLowerCase();
    const bodyText = (body.textContent || '').toLowerCase();
    const needle = term.toLowerCase();
    const matched = preview.includes(needle) || bodyText.includes(needle);

    if (matched) {
      // 매칭 → 자동 펼침 + body 내 mark 래핑
      d.open = true;
      const id = d.dataset.messageId;
      if (id) state.expandedMessages.add(id);
      highlightTextNodes(body, term);
    }
    // 미매칭: open 상태 변경 없음 (사용자 직전 의도 보존)
  });
}

/**
 * 노드 트리를 순회하며 일치 텍스트를 <mark>로 래핑.
 * <pre>/<code> 안의 텍스트 노드도 처리. <summary>는 대상 외.
 */
function highlightTextNodes(root, term) {
  const needle = term.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      // mark 안에 있거나 summary 내부면 거부
      const parent = node.parentNode;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.nodeName === 'MARK') return NodeFilter.FILTER_REJECT;
      const parentEl = asEl(parent);
      if (parentEl.closest && parentEl.closest('summary')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets = [];
  let n;
  while ((n = walker.nextNode())) targets.push(n);

  for (const text of targets) {
    const raw = text.nodeValue;
    const lower = raw.toLowerCase();
    let idx = lower.indexOf(needle);
    if (idx === -1) continue;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    while (idx !== -1) {
      if (idx > cursor) frag.appendChild(document.createTextNode(raw.slice(cursor, idx)));
      const mark = document.createElement('mark');
      mark.className = 'llm-input-mark';
      mark.textContent = raw.slice(idx, idx + term.length);
      frag.appendChild(mark);
      cursor = idx + term.length;
      idx = lower.indexOf(needle, cursor);
    }
    if (cursor < raw.length) frag.appendChild(document.createTextNode(raw.slice(cursor)));
    text.parentNode.replaceChild(frag, text);
  }
}

/**
 * 신규 요청 로드 시 호출 — 아코디언 상태를 초기화.
 * (다른 요청의 m-3, m-5 같은 잔여 ID가 새 요청 메시지에 잘못 적용되는 것을 방지)
 */
function resetAccordionState() {
  state.expandedMessages.clear();
  state.currentSearch = '';
}

// =============================================================================
// 유틸
// =============================================================================

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function formatBytes(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function safeStringify(v) {
  try { return JSON.stringify(v, null, 2); } catch { return '[unserializable]'; }
}
