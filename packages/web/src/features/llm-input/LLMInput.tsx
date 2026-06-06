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
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtTime, fmtToken, shortModelName } from '../../lib/formatters';
import { Chevron } from '../../components/design-system/icons/Chevron';
import { Info } from '../../components/design-system/icons/Info';
import { Bolt } from '../../components/design-system/icons/Bolt';
import { SearchBox } from '../../components/SearchBox';
import { ChatRoom, SystemPinChip, SystemPinBody, type SystemUsageLike } from './ChatRoom';
import { type MessageLike } from './llm-input-state';

/** i18n 번역 함수 시그니처 — react-i18next t(useTranslation) 와 동형. */
type TFunc = (key: string, vars?: Record<string, unknown>) => string;

/** system_prompts meta(원본 systemMeta 형태). usage 는 ChatRoom SystemMetaLike 와 동형. */
export interface SystemMeta {
  segment_count?: number | null;
  byte_size?: number | null;
  ref_count?: number | null;
  usage?: SystemUsageLike | null;
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
  /** 세션 id — ChatRoom 의 "신선한 진입(세션 전환)" 판정 키(conversationKey). 바뀌면 최신으로 자동 점프. */
  sessionId?: string;
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
  /** 세션 LIVE 추적 중 여부 — 현재 헤더 배지는 폐기됐고 호출처 호환을 위해 옵셔널 유지(미사용). */
  isLive?: boolean;
  /** 대화방 "작성 중" 신호 — 타임라인 하단에 타이핑 버블 표시(LIVE 추적 중 세션 활동 시). */
  typing?: boolean;
  /** 추적 해제 중 미확인 신규 proxy 수 — "새 요청 N ↓" 알림. 기본 0. */
  pendingNewCount?: number;
  /** "최신으로" 복귀(LIVE 추적 재개) — 헤더 알림 클릭. */
  onFollowLatest?: () => void;
}

/**
 * 세션 proxy 칩 — a-bar 한 줄 압축(payload-chat-redesign 2차). 현재 선택 proxy 를 `#idx · model · tokens`
 * 칩으로 요약하고, 칩 위에 투명 native `<select>` 를 겹쳐 클릭 시 214건 드롭다운을 그대로 펼친다
 * (기능 100% 유지 + 한 줄 점유). 원본 renderProxySelector 의 option 라벨 계약 유지.
 */
function ProxyChip({
  proxyList,
  activeId,
  onSelect,
}: {
  proxyList: ProxyMeta[];
  activeId: string;
  onSelect?: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation() as { t: TFunc };
  const total = proxyList.length;
  const activeIdx = proxyList.findIndex((r) => r.id === activeId);
  const cur = activeIdx >= 0 ? proxyList[activeIdx] : null;
  const curModel = cur?.model ? shortModelName(cur.model) : '?';
  const curTok =
    cur && (cur.tokens_input || cur.tokens_output)
      ? `${fmtToken(cur.tokens_input ?? 0)}+${fmtToken(cur.tokens_output ?? 0)}`
      : '—';
  return (
    <span className="llm-input-abar-proxy" data-tip={t('ui.llm-input.proxy-selector-label', { count: total })}>
      <b>#{activeIdx >= 0 ? activeIdx + 1 : '?'}</b>
      <span className="llm-input-abar-proxy-dim"> · {curModel} · {curTok}</span>
      <Chevron dir="down" size={10} />
      {/* 투명 native select — 칩 전체를 덮어 클릭 시 옵션 드롭다운 노출(접근성·키보드 보존). */}
      <select
        className="llm-input-abar-proxy-select"
        data-proxy-select
        aria-label={t('ui.llm-input.proxy-selector-label', { count: total })}
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
    </span>
  );
}

/**
 * LLM Input 패널 — banner + (proxy selector) + header + system + messages 아코디언.
 * 명령형 DOM 변이를 useState 기반 선언적 렌더로 정제. 원본 renderHtml 구성 순서 1:1 유지.
 */
export function LLMInput(props: LLMInputProps): ReactElement {
  const { t } = useTranslation() as { t: TFunc };
  const {
    sessionId,
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
    pendingNewCount = 0,
    onFollowLatest,
    typing = false,
  } = props;

  // ── 선언적 로컬 상태 ── 대화(chat) 뷰 단일화(raw 아코디언 폐기). 검색어 + system 핀 펼침만 보유.
  const [search, setSearch] = useState(initialSearch);
  const [pinOpen, setPinOpen] = useState(false); // system 핀(a-head 흡수) 본문 토글

  return (
    <>
      {/*
       * a-head — 한 줄 압축 헤더(payload-chat-redesign 2차, mockup a-head/a-bar).
       * proxy 칩 + req/sys 메타 칩 + LIVE/신규알림 + 검색 + 대화/원본 토글 + ?(help).
       * banner 안내·범례·stateless 는 ? 토글(a-sub)로 접어 상단 영역을 한 줄로.
       */}
      <div className="llm-input-abar-head">
        <div className="llm-input-abar">
          {proxyList.length > 0 ? (
            <ProxyChip proxyList={proxyList} activeId={requestId} onSelect={onSelectProxy} />
          ) : null}
          <span className="llm-input-abar-meta">
            <span className="pill" data-tip={requestId}>req {requestId.slice(0, 8) || '—'}</span>
            {/* system 칩 — req 옆 한 줄 토글 칩(seg·size·ref). 펼치면 헤더 아래 전문(SystemPinBody). */}
            <SystemPinChip
              hash={systemHash}
              size={systemSize}
              content={systemContent}
              meta={systemMeta}
              open={pinOpen}
              onToggle={setPinOpen}
              onRefsClick={onRefsClick}
              t={t}
            />
            {decodeError ? (
              <span className="pill pill--err" data-tip={decodeError}>
                {t('ui.llm-input.payload-decode-failed')}
              </span>
            ) : null}
          </span>

          {/* 신규 알림 — 과거 요청 보는 중 새 호출 도착 시 최신 복귀 CTA. (LIVE/과거 상태 배지는 제거 — 중복·과함) */}
          {pendingNewCount > 0 ? (
            <button type="button" className="llm-input-newreq" onClick={onFollowLatest}>
              <Bolt size={11} /> {t('ui.llm-input.chat.new-requests', { count: pendingNewCount })}
            </button>
          ) : null}

          <span className="llm-input-abar-spacer" />

          {/* 검색 — 좌측 타임라인·우측 인스펙터 본문을 동시 하이라이트. .feed-search 래퍼(relative) 필수. */}
          <span className="feed-search llm-input-abar-search">
            <SearchBox
              value={search}
              placeholder={t('ui.llm-input.search-placeholder')}
              onSearch={setSearch}
              clearLabel={t('ui.llm-input.chat.search-clear')}
            />
          </span>

          {/* ? — 호버하면 banner 안내 + 범례·stateless 가 팝오버로(오버레이, 레이아웃 안 밀림). */}
          <span className="llm-input-help">
            <button
              type="button"
              className="llm-input-help-btn"
              aria-label={t('ui.llm-input.chat.legend-toggle')}
            >
              <Info size={14} />
            </button>
            <div className="llm-input-asub" role="tooltip">
              <span
                className="llm-input-asub-banner"
                dangerouslySetInnerHTML={{ __html: t('ui.llm-input.banner-text') }}
              />
              <span className="llm-input-asub-legend">
                <span><i style={{ background: 'var(--info)' }} />{t('ui.llm-input.chat.legend-text')}</span>
                <span><i style={{ background: 'var(--text-3)', border: '1px dashed var(--text-1)' }} />{t('ui.llm-input.chat.legend-thinking')}</span>
                <span><i style={{ background: 'var(--text-3)' }} />{t('ui.llm-input.chat.legend-tool-use')}</span>
                <span><i style={{ background: 'var(--success)' }} />{t('ui.llm-input.chat.legend-tool-result')}</span>
              </span>
              <span className="llm-input-asub-stateless">{t('ui.llm-input.chat.stateless')}</span>
            </div>
          </span>
        </div>

        {/* system 프롬프트 전문 — 헤더 칩(SystemPinChip) 토글 시 헤더 바로 아래 펼침. */}
        {pinOpen && systemHash ? <SystemPinBody content={systemContent} t={t} /> : null}
      </div>

      <ChatRoom messages={messages} search={search} typing={typing} conversationKey={sessionId} />
    </>
  );
}
