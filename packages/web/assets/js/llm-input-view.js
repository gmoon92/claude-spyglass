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

import { escHtml } from './formatters.js';
import { skLlmInputCards } from './render/skeleton.js';

const CONTAINER_ID = 'llmInputBody';

/** 메시지 summary 미리보기 길이 (정책 — 처음 100자) */
const SUMMARY_PREVIEW_LEN = 100;

/** 검색 매칭 최소 길이 — 너무 짧은 입력으로 모든 메시지 펼침 방지 */
const SEARCH_MIN_LEN = 2;

/** role별 아이콘 — summary 좌측 프리픽스 (ADR-002 §결정 §4) */
const ROLE_ICON = {
  user: '👤',
  assistant: '🤖',
  system: '🔒',
  tool: '🔧',
  tool_use: '🔧',
  tool_result: '🔧',
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
 * 탭 진입 시 가장 최근 proxy 요청 1건을 자동 로드.
 *
 * 후속 확장 포인트(디자이너):
 *  - 요청 ID 선택 UI (드롭다운/검색)
 *  - 평면 뷰 행 클릭 → 해당 ID 인자로 호출
 *  - SSE로 새 요청 도착 시 자동 갱신 토글
 */
export async function showLatestLlmInput() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  // skeleton-loading T-10: system 카드(큰 본문) + user 카드 2개로 구조 유지.
  container.innerHTML = skLlmInputCards(2);

  try {
    const recent = await fetchJson('/api/proxy-requests?limit=1');
    const list = Array.isArray(recent?.data) ? recent.data : [];
    if (list.length === 0) {
      container.innerHTML = `<div class="state-empty"><span class="state-empty-title">최근 프록시 요청이 없습니다</span></div>`;
      return;
    }
    await renderLlmInput(list[0].id);
  } catch (err) {
    container.innerHTML = `<div class="state-empty"><span class="state-empty-title">불러오기 실패: ${escHtml(String(err?.message ?? err))}</span></div>`;
  }
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

  // 신규 요청 로드 시 아코디언 상태 리셋 — 다른 요청 잔여 ID 혼입 방지.
  resetAccordionState();

  // skeleton-loading T-10: 특정 ID 로드 시에도 동일 placeholder 사용 (system 1 + user 2 카드).
  container.innerHTML = skLlmInputCards(2);

  try {
    const msgRes = await fetchJson(`/api/proxy-requests/${encodeURIComponent(requestId)}/messages`);
    const data = msgRes?.data;
    if (!data) {
      container.innerHTML = `<div class="state-empty"><span class="state-empty-title">요청을 찾을 수 없습니다 (${escHtml(requestId)})</span></div>`;
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
    container.innerHTML = `<div class="state-empty"><span class="state-empty-title">불러오기 실패: ${escHtml(String(err?.message ?? err))}</span></div>`;
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
  const headerHtml = `
    <header class="llm-input-header">
      <span class="llm-input-rid">request: <code>${escHtml(p.requestId)}</code></span>
      ${p.systemHash
        ? `<span class="llm-input-hash">system: <code>${escHtml(p.systemHash.slice(0, 12))}…</code></span>`
        : `<span class="llm-input-hash llm-input-hash--empty">system 없음</span>`}
      ${p.systemSize ? `<span class="llm-input-size">${formatBytes(p.systemSize)}</span>` : ''}
      ${p.decodeError ? `<span class="llm-input-error" title="${escHtml(p.decodeError)}">payload decode 실패</span>` : ''}
    </header>`;

  const systemHtml = p.systemHash
    ? renderSystemSection(p.systemContent, p.systemMeta)
    : '<section class="llm-input-system llm-input-system--empty"><p>이 요청에 system 필드가 없습니다.</p></section>';

  const messagesHtml = renderMessagesSection(p.messages);

  return headerHtml + systemHtml + messagesHtml;
}

/**
 * system blocks 섹션 — billing-header(meta) 분리 + 본문 표시.
 *
 * 정규화 단계에서 idx[0] billing-header는 이미 제거됐으므로 systemContent 자체에는 본문만 들어있음.
 * 단 화면에는 "정규화 본문임" 명시 + segment_count 같은 메타도 표시 — 디버깅 용이.
 *
 * 정책: 시스템 섹션은 항상 펼침 — 아코디언 적용 대상 아님 (ADR-002 §결정 §5).
 */
function renderSystemSection(content, meta) {
  if (!content) {
    return `<section class="llm-input-system llm-input-system--loading">
      <h3>System (정규화 본문)</h3>
      <p class="llm-input-dim">본문 로딩 실패 또는 미존재 — system_hash만 알려진 상태.</p>
    </section>`;
  }

  const metaLine = meta
    ? `<div class="llm-input-system-meta">
        <span>segment_count: ${meta.segment_count ?? '?'}</span>
        <span>byte_size: ${formatBytes(meta.byte_size ?? content.length)}</span>
        <span>ref_count: ${meta.ref_count ?? '?'}</span>
      </div>`
    : '';

  return `<section class="llm-input-system">
    <h3>System (정규화 본문 — billing-header 제외)</h3>
    ${metaLine}
    <pre class="llm-input-system-content">${escHtml(content)}</pre>
  </section>`;
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
  if (!messages.length) {
    return '<section class="llm-input-messages"><h3>Messages (0)</h3><p class="llm-input-dim">메시지 없음</p></section>';
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
  return `
    <div class="llm-input-messages-controls">
      <label class="llm-input-search">
        <span class="llm-input-search-icon" aria-hidden="true">🔎</span>
        <input
          type="search"
          class="llm-input-search-input"
          data-messages-search
          placeholder="메시지 검색 (2자 이상)"
          aria-label="메시지 검색"
        />
      </label>
      <div class="llm-input-messages-bulk">
        <button type="button" class="llm-input-expand-all" data-action="expand-all" title="모든 메시지 펼치기">
          <span aria-hidden="true">▾</span> 전체 펼침
        </button>
        <button type="button" class="llm-input-collapse-all" data-action="collapse-all" title="모든 메시지 접기">
          <span aria-hidden="true">▸</span> 전체 접기
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
 * "전체 펼침" / "전체 접기" 버튼 클릭.
 *  - 버튼 자체에 data-action 속성으로 분기 (캡슐화: 핸들러 내부 판단)
 */
function onControlsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'expand-all') setAllExpanded(true);
  else if (action === 'collapse-all') setAllExpanded(false);
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
  all.forEach(d => {
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
  const input = e.target.closest('[data-messages-search]');
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

  all.forEach(d => {
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
      if (parent.closest && parent.closest('summary')) return NodeFilter.FILTER_REJECT;
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
