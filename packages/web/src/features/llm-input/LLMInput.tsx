/**
 * features/llm-input/LLMInput.tsx — LLM Input 탭 패널 (P3-08)
 *
 * 원본: assets/js/llm-input-view.js(902줄, v23 llm-input-accordion ADR-002).
 *
 * 정제 범위(done_criteria: "toggle/expand/scroll 상태를 React 로컬 state 로 정제,
 * 세션-특화 데이터는 props"):
 *  - 명령형 상태 → 선언적 useState:
 *      · expanded(메시지별 펼침)  ← 원본 state.expandedMessages: Set + details.open 직접 변이
 *      · search(검색어)           ← 원본 state.currentSearch + DOM TreeWalker <mark> 변이
 *      · systemOpen(system 본문 점유 토글) ← 원본 <details open> "스크롤 점유 사용자 조절"
 *    상태 전이 로직은 llm-input-state.ts(순수, 테스트됨) 재사용 — 컴포넌트는 재구현하지 않는다.
 *  - 세션-특화 데이터(messages/systemContent/systemMeta/systemHash/systemSize/proxyList/requestId)
 *    는 props 주입. fetch 오케스트레이션(원본 showLatestLlmInput/renderLlmInput/ensureSessionProxyList)
 *    은 본 presentation 컴포넌트가 소유하지 않는다(architecture.md §1.3 features↛api;
 *    데이터흐름 역전은 후속 페이즈). 레거시 .js 병존.
 *  - ref_count 팝오버(원본 openRefsPopover: fetch + document.body append)는 presentation 이
 *    fetch 하지 않으므로 onRefsClick 콜백으로 위임(칩 마크업·aria 계약만 유지).
 *
 * 셀렉터 계약(architecture.md §2.2): class/id/data-* 를 원본과 1:1 유지(향후 CSS/E2E 호환).
 *
 * @module features/llm-input/LLMInput
 */
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { fmtTime, fmtToken, shortModelName } from '../../../assets/js/formatters.js';
import { Search } from '../../components/design-system/icons/Search';
import { Chevron } from '../../components/design-system/icons/Chevron';
import { Info } from '../../components/design-system/icons/Info';
import {
  type MessageLike,
  type ExpandedMap,
  messageId,
  initialExpanded,
  toggleExpanded,
  setAllExpanded,
  applySearchExpansion,
  previewFromContent,
  contentText,
  formatBytes,
  splitHighlight,
  SEARCH_MIN_LEN,
} from './llm-input-state';

declare const window: { I18n?: { t: (key: string, vars?: Record<string, unknown>) => string } };
const t = (key: string, vars?: Record<string, unknown>): string =>
  (window.I18n?.t ?? ((k: string) => k))(key, vars);

/** system_prompts meta(원본 systemMeta 형태). */
export interface SystemMeta {
  segment_count?: number | null;
  byte_size?: number | null;
  ref_count?: number | null;
  [k: string]: unknown;
}

/** 세션 proxy 요청 메타(원본 _sessionProxyList 요소 — 셀렉터 옵션 렌더용). */
export interface ProxyMeta {
  id: string;
  timestamp?: number | null;
  model?: string | null;
  tokens_input?: number | null;
  tokens_output?: number | null;
  [k: string]: unknown;
}

export interface LLMInputProps {
  /** 활성 proxy 요청 id(헤더 + 셀렉터 활성값). */
  requestId: string;
  /** system_prompts hash(없으면 system 필드 미존재 분기). */
  systemHash?: string | null;
  /** system 본문 byte_size(헤더 라벨). */
  systemSize?: number | null;
  /** system 본문(hash 있으나 null 이면 fetch 실패 — loading 분기). */
  systemContent?: string | null;
  /** system_prompts meta(segment_count/byte_size/ref_count). */
  systemMeta?: SystemMeta | null;
  /** LLM 입력 메시지 시퀀스. */
  messages: MessageLike[];
  /** zstd 디코드 실패 메시지(헤더 에러 배지). */
  decodeError?: string | null;
  /** 세션 proxy 목록 — 있으면 드롭다운 렌더, 비면 생략(전역 latest 폴백). */
  proxyList?: ProxyMeta[];
  /** 드롭다운 변경 콜백(레거시 renderLlmInput 위임). */
  onSelectProxy?: (id: string) => void;
  /** ref_count 칩 클릭 — 레거시 팝오버(fetch+append) 위임. presentation 은 fetch 안 함. */
  onRefsClick?: (hash: string) => void;
  /** 초기 검색어(테스트/딥링크용 — 보통 미지정). */
  initialSearch?: string;
}

/**
 * role별 아이콘 — summary 좌측 프리픽스(원본 ROLE_ICON:58-86, line-icon 패밀리).
 * design-system 패밀리에 없는 bespoke 글리프이므로 원본 path 를 1:1 인라인(시각 fidelity 보존).
 * 색은 CSS `.llm-input-msg--<role> .llm-input-msg-role-icon { color }` 가 currentColor 로 결정.
 */
const ROLE_ICON_ATTRS = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 16 16',
  width: '1em',
  height: '1em',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function RoleIcon({ role }: { role: string }): ReactNode {
  switch (role) {
    case 'user':
      return (
        <svg {...ROLE_ICON_ATTRS}>
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M2.5 13.5c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" />
        </svg>
      );
    case 'assistant':
      return (
        <svg {...ROLE_ICON_ATTRS}>
          <rect x="2" y="3" width="12" height="8" rx="2" />
          <circle cx="5.5" cy="7" r="1" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="7" r="1" fill="currentColor" stroke="none" />
          <path d="M5.5 13.5L8 11l2.5 2.5" />
        </svg>
      );
    case 'system':
      return (
        <svg {...ROLE_ICON_ATTRS}>
          <rect x="4" y="7" width="8" height="6.5" rx="1" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
      );
    case 'tool':
    case 'tool_use':
      return (
        <svg {...ROLE_ICON_ATTRS}>
          <path d="M10.5 2a3 3 0 0 1 .6 3.4l-.2.4 3.1 3.1a1 1 0 1 1-1.4 1.4L9.5 7.2l-.4.2A3 3 0 1 1 10.5 2z" />
          {role === 'tool_use' ? <path d="M2 13.5l2.5-2.5" /> : null}
        </svg>
      );
    case 'tool_result':
      return (
        <svg {...ROLE_ICON_ATTRS}>
          <rect x="3" y="2" width="10" height="12" rx="1.5" />
          <path d="M5.5 6.5h5" />
          <path d="M5.5 9h3" />
          <path d="M9 11.5l1.5 1.5 2.5-2.5" />
        </svg>
      );
    default:
      return <>•</>;
  }
}

/** 검색어 기준으로 텍스트를 분절해 매칭 구간을 <mark> 로 렌더(원본 highlightTextNodes 선언적 대응). */
function HighlightedText({ text, term }: { text: string; term: string }): ReactNode {
  const segments = splitHighlight(text, term);
  return (
    <>
      {segments.map((seg, i) =>
        seg.mark ? (
          <mark key={i} className="llm-input-mark">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/** message.content body — text 는 pre(+검색 하이라이트), 비-text 파트는 details(JSON). 원본 renderMessageBody. */
function MessageBody({ content, term }: { content: unknown; term: string }): ReactNode {
  if (typeof content === 'string') {
    return (
      <pre className="llm-input-msg-text">
        <HighlightedText text={content} term={term} />
      </pre>
    );
  }
  if (Array.isArray(content)) {
    return (
      <>
        {content.map((part, i) => {
          if (!part || typeof part !== 'object') return null;
          const p = part as { type?: string; text?: string };
          const type = String(p.type ?? 'unknown');
          if (type === 'text' && typeof p.text === 'string') {
            return (
              <pre key={i} className="llm-input-msg-text">
                <HighlightedText text={p.text} term={term} />
              </pre>
            );
          }
          let json: string;
          try {
            json = JSON.stringify(part, null, 2);
          } catch {
            json = '[unserializable]';
          }
          return (
            <details key={i} className="llm-input-msg-part">
              <summary>{type}</summary>
              <pre>{json}</pre>
            </details>
          );
        })}
      </>
    );
  }
  return <span className="llm-input-dim">(empty content)</span>;
}

/** system blocks 섹션 — 원본 renderSystemSection(meta 칩 + 본문, 사용자 조절 가능 details). */
function SystemSection({
  content,
  meta,
  systemHash,
  open,
  onToggle,
  onRefsClick,
}: {
  content: string | null | undefined;
  meta: SystemMeta | null | undefined;
  systemHash: string | null | undefined;
  open: boolean;
  onToggle: (open: boolean) => void;
  onRefsClick?: (hash: string) => void;
}): ReactElement {
  if (!content) {
    return (
      <section className="llm-input-system llm-input-system--loading">
        <h3>System Prompt</h3>
        <p className="llm-input-dim">{t('ui.llm-input.system-load-failed')}</p>
      </section>
    );
  }

  const refCount = meta?.ref_count ?? 0;
  const refsChip = systemHash ? (
    <button
      type="button"
      className="llm-input-meta-chip llm-input-refs-toggle"
      data-refs-hash={systemHash}
      aria-haspopup="dialog"
      aria-expanded="false"
      title={t('ui.llm-input.ref-count-btn-title', { count: refCount })}
      onClick={() => onRefsClick?.(systemHash)}
    >
      ref_count: {refCount}
    </button>
  ) : (
    <span title={t('ui.llm-input.ref-count-span-title')}>ref_count: {refCount}</span>
  );

  const metaLine = meta ? (
    <div className="llm-input-system-meta">
      <span title={t('ui.llm-input.segment-count-title')}>segment_count: {meta.segment_count ?? '?'}</span>
      <span title={t('ui.llm-input.byte-size-title')}>
        byte_size: {formatBytes(meta.byte_size ?? content.length)}
      </span>
      {refsChip}
    </div>
  ) : null;

  return (
    <details
      className="llm-input-system"
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="llm-input-system-summary" title={t('ui.llm-input.system-summary-title')}>
        System
      </summary>
      {metaLine}
      <pre className="llm-input-system-content">{content}</pre>
    </details>
  );
}

/** 개별 메시지 아코디언 행 — 원본 renderMessageDetails. */
function MessageDetails({
  m,
  index,
  open,
  term,
  onToggle,
}: {
  m: MessageLike;
  index: number;
  open: boolean;
  term: string;
  onToggle: (id: string, open: boolean) => void;
}): ReactElement {
  const role = String(m?.role ?? 'unknown');
  const id = messageId(index);
  const previewText = previewFromContent(m?.content);
  const showHighlight = term.trim().length >= SEARCH_MIN_LEN;

  return (
    <details
      className={`llm-input-msg llm-input-msg--${role}`}
      data-message-id={id}
      data-message-role={role}
      data-message-preview={previewText}
      open={open}
      onToggle={(e) => onToggle(id, (e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="llm-input-msg-head">
        <span className="llm-input-msg-role">
          <span className="llm-input-msg-role-icon" aria-hidden="true">
            <RoleIcon role={role} />
          </span>
          {role}
        </span>
        <span className="llm-input-msg-preview">{previewText}</span>
        <span className="llm-input-msg-idx">#{index + 1}</span>
      </summary>
      <div className="llm-input-msg-body">
        <MessageBody content={m?.content} term={showHighlight ? term : ''} />
      </div>
    </details>
  );
}

/** 세션 proxy 드롭다운 — 원본 renderProxySelector(timestamp 오름차순 + 활성 selected). */
function ProxySelector({
  proxyList,
  activeId,
  onSelect,
}: {
  proxyList: ProxyMeta[];
  activeId: string;
  onSelect?: (id: string) => void;
}): ReactElement {
  const total = proxyList.length;
  return (
    <div className="llm-input-proxy-selector">
      <label className="llm-input-proxy-selector-label" htmlFor="llm-input-proxy-select">
        {t('ui.llm-input.proxy-selector-label', { count: total })}
      </label>
      <select
        id="llm-input-proxy-select"
        className="llm-input-proxy-select"
        data-proxy-select
        value={activeId}
        onChange={(e) => onSelect?.(e.currentTarget.value)}
      >
        {proxyList.map((r, i) => {
          const idx = i + 1;
          const ts = r.timestamp ? fmtTime(r.timestamp) : '—';
          const model = r.model ? shortModelName(r.model) : '?';
          const tokIn = r.tokens_input ?? 0;
          const tokOut = r.tokens_output ?? 0;
          const tok = tokIn || tokOut ? `${fmtToken(tokIn)}+${fmtToken(tokOut)}` : '—';
          const idShort = (r.id || '').slice(0, 12);
          const label = `#${idx}  ${ts} · ${model} · ${tok} · ${idShort}…`;
          return (
            <option key={r.id} value={r.id}>
              {label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

/**
 * LLM Input 패널 — banner + (proxy selector) + header + system + messages 아코디언.
 * 명령형 DOM 변이를 useState 기반 선언적 렌더로 정제. 원본 renderHtml 구성 순서 1:1 유지.
 */
export function LLMInput(props: LLMInputProps): ReactElement {
  const {
    requestId,
    systemHash = null,
    systemSize = null,
    systemContent = null,
    systemMeta = null,
    messages,
    decodeError = null,
    proxyList = [],
    onSelectProxy,
    onRefsClick,
    initialSearch = '',
  } = props;

  // ── 선언적 로컬 상태(원본 명령형 state/_pending* 정제) ──
  const [systemOpen, setSystemOpen] = useState(true); // 원본 <details open> + 사용자 조절
  const [search, setSearch] = useState(initialSearch); // 원본 state.currentSearch
  // 초기 펼침: system role 만(원본 renderMessageDetails isSystem). 검색 초기값이 있으면 매칭 자동 펼침 반영.
  const [expanded, setExpanded] = useState<ExpandedMap>(() => {
    const base = initialExpanded(messages);
    return applySearchExpansion(base, messages, initialSearch);
  });

  // 검색 haystack/preview 는 messages 파생이라 메모.
  useMemo(() => messages.map((m) => contentText(m?.content)), [messages]);

  const onMessageToggle = (id: string, open: boolean) =>
    setExpanded((prev) => toggleExpanded(prev, id, open));

  const onExpandAll = () => setExpanded(setAllExpanded(messages, true));
  const onCollapseAll = () => setExpanded(setAllExpanded(messages, false));

  const onSearchChange = (term: string) => {
    setSearch(term);
    // 매칭 메시지 자동 펼침(원본 applySearchHighlight: additive, 미매칭 보존, <MIN_LEN 불변).
    setExpanded((prev) => applySearchExpansion(prev, messages, term));
  };

  return (
    <>
      {/* banner — proxy 데이터의 본질(hook 관측과 다름) 인지 */}
      <div className="llm-input-banner" role="note">
        <span className="llm-input-banner-icon" aria-hidden="true">
          <Info size={12} className="ds-icon" />
        </span>
        <span className="llm-input-banner-text">{t('ui.llm-input.banner-text')}</span>
      </div>

      {/* 세션 proxy 셀렉터 — 세션 컨텍스트(props) 있을 때만 */}
      {proxyList.length > 0 ? (
        <ProxySelector proxyList={proxyList} activeId={requestId} onSelect={onSelectProxy} />
      ) : null}

      <header className="llm-input-header">
        <span className="llm-input-rid">
          request: <code>{requestId}</code>
        </span>
        {systemHash ? (
          <span className="llm-input-hash">
            system: <code>{systemHash.slice(0, 12)}…</code>
          </span>
        ) : (
          <span className="llm-input-hash llm-input-hash--empty">{t('ui.llm-input.system-none')}</span>
        )}
        {systemSize ? <span className="llm-input-size">{formatBytes(systemSize)}</span> : null}
        {decodeError ? (
          <span className="llm-input-error" title={decodeError}>
            {t('ui.llm-input.payload-decode-failed')}
          </span>
        ) : null}
      </header>

      {systemHash ? (
        <SystemSection
          content={systemContent}
          meta={systemMeta}
          systemHash={systemHash}
          open={systemOpen}
          onToggle={setSystemOpen}
          onRefsClick={onRefsClick}
        />
      ) : (
        <section className="llm-input-system llm-input-system--empty">
          <p>{t('ui.llm-input.no-system-field')}</p>
        </section>
      )}

      {messages.length === 0 ? (
        <section className="llm-input-messages">
          <h3>Messages (0)</h3>
          <p className="llm-input-dim">{t('ui.llm-input.no-messages')}</p>
        </section>
      ) : (
        <section className="llm-input-messages">
          <header className="llm-input-messages-header">
            <h3>Messages ({messages.length})</h3>
            <div className="llm-input-messages-controls">
              <label className="llm-input-search">
                <span className="llm-input-search-icon" aria-hidden="true">
                  <Search size={14} />
                </span>
                <input
                  type="search"
                  className="llm-input-search-input"
                  data-messages-search
                  placeholder={t('ui.llm-input.search-placeholder')}
                  aria-label={t('ui.llm-input.search-aria-label')}
                  value={search}
                  onChange={(e) => onSearchChange(e.currentTarget.value)}
                />
              </label>
              <div className="llm-input-messages-bulk">
                <button
                  type="button"
                  className="llm-input-expand-all"
                  data-action="expand-all"
                  title={t('ui.llm-input.expand-all-title')}
                  onClick={onExpandAll}
                >
                  <Chevron dir="down" size={10} /> {t('ui.llm-input.expand-all')}
                </button>
                <button
                  type="button"
                  className="llm-input-collapse-all"
                  data-action="collapse-all"
                  title={t('ui.llm-input.collapse-all-title')}
                  onClick={onCollapseAll}
                >
                  <Chevron dir="right" size={10} /> {t('ui.llm-input.collapse-all')}
                </button>
              </div>
            </div>
          </header>
          <div className="llm-input-messages-list">
            {messages.map((m, i) => (
              <MessageDetails
                key={messageId(i)}
                m={m}
                index={i}
                open={expanded[messageId(i)] ?? false}
                term={search}
                onToggle={onMessageToggle}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
