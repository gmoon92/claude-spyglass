/**
 * llm-input-view.js — LLM Input 탭 (v22 system-prompt-exposure ADR-004 옵션 A)
 *
 * 책임:
 *  - 한 proxy 요청을 LLM이 받은 그대로의 입력(system blocks + user messages)으로 노출.
 *  - system 본문은 system_hash로 lazy-fetch (`GET /api/system-prompts/:hash`).
 *  - user messages는 zstd 디코드된 결과를 서버에서 받음 (`GET /api/proxy-requests/:id/messages`).
 *  - billing-header(idx[0])는 별도 'meta' 섹션으로 시각 분리 — prompt 본문 아님 명시.
 *
 * 호출자:
 *  - turn-views.js setDetailView('llm') — 탭 진입 시 가장 최근 proxy 요청을 fetch + 렌더.
 *  - 후속 디자이너 위임에서 평면 뷰 행 클릭 → 특정 요청 ID 렌더로 확장 가능.
 *
 * 의존성:
 *  - escHtml: 외부 입력 안전 렌더
 *  - fetch API
 *
 * 골격 구현 — 디자인 폴리싱(여백·색·다크 톤)은 designer 후속.
 *
 * API 응답 형태 참고:
 *  GET /api/proxy-requests           → { data: [{id, model, timestamp, system_hash, ...}, ...] }
 *  GET /api/proxy-requests/:id/messages → { data: { id, system_hash, system_byte_size, messages, decode_error? } }
 *  GET /api/system-prompts/:hash     → { data: { hash, content, byte_size, segment_count, ... } }
 */

import { escHtml } from './formatters.js';

const CONTAINER_ID = 'llmInputBody';

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

  container.innerHTML = `<div class="state-loading"><div class="state-loading-spinner"></div><span>최신 프록시 요청 조회 중…</span></div>`;

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

  container.innerHTML = `<div class="state-loading"><div class="state-loading-spinner"></div><span>LLM Input 조회 중…</span></div>`;

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
  } catch (err) {
    container.innerHTML = `<div class="state-empty"><span class="state-empty-title">불러오기 실패: ${escHtml(String(err?.message ?? err))}</span></div>`;
  }
}

// =============================================================================
// 내부 helper
// =============================================================================

/**
 * 골격 렌더 — 단일 책임으로 HTML 조립만.
 * 시각 폴리싱(여백·색·계층)은 designer 후속 작업.
 *
 * 구조 (ADR-004 옵션 A):
 *   <header>   요청 ID + system_hash 8자 + size 라벨
 *   <section.llm-input-system>   system blocks (meta 분리 + 본문)
 *   <section.llm-input-messages> user messages 시퀀스
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
 * user messages 시퀀스 섹션 — 멀티턴 대화 그대로 노출.
 * content는 string(레거시) 또는 [{type, text|tool_use|tool_result, ...}] 배열 둘 다 처리.
 */
function renderMessagesSection(messages) {
  if (!messages.length) {
    return '<section class="llm-input-messages"><h3>Messages (0)</h3><p class="llm-input-dim">메시지 없음</p></section>';
  }

  const items = messages.map((m, i) => {
    const role = String(m?.role ?? 'unknown');
    const body = renderMessageBody(m?.content);
    return `<article class="llm-input-msg llm-input-msg--${escHtml(role)}">
      <header class="llm-input-msg-head"><span class="llm-input-msg-role">${escHtml(role)}</span><span class="llm-input-msg-idx">#${i + 1}</span></header>
      <div class="llm-input-msg-body">${body}</div>
    </article>`;
  }).join('');

  return `<section class="llm-input-messages">
    <h3>Messages (${messages.length})</h3>
    ${items}
  </section>`;
}

/** message.content를 단순 텍스트로 직렬화 — 골격 단계라 모든 type을 escape pre로 표시. */
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
