/**
 * features/llm-input/ChatRoom.tsx — "API 페이로드" 대화형(Chat) 뷰 (payload-chat-redesign · 컨셉 ③ Dual-Lane)
 *
 * proxy 원본 messages[] 를 사람↔Claude 채팅 타임라인으로 렌더한다. 4종 content part 를 시각 위계로 분리:
 *   text=좌우 말풍선 / thinking=회색 점선 사고 거품(기본 접힘) / tool_use=중립 rail 행동 카드 /
 *   tool_result=행동 카드 하단 ↳ 결과 칩(성공·실패 — is_error 직독). tool_result 는 role=user 여도 말풍선 금지.
 *
 * 레이아웃(2차 현행화):
 *   - 헤더(검색·대화/원본 토글·LIVE·범례)는 LLMInput a-head 가 소유. ChatRoom 은 split(타임라인+인스펙터)만.
 *   - chat-shell = grid [타임라인 | 리사이저 | 인스펙터]. 가운데 .chat-resizer 드래그로 좌우 폭 조절(localStorage 영속).
 *   - 타임라인·인스펙터 각각 내부 스크롤. 진입 시 타임라인은 맨 아래(최신)로, 위로 올리면 "최신 대화로 ↓".
 *   - '더 보기'/'↗ 자세히' 버튼 폐기 — 말풍선·카드를 **클릭**하면 우측 인스펙터에 전문/원본 표시 + 선택 박스 강조.
 *
 * 재사용(재구현 금지):
 *   - 변환: toChatModel/groupParallelActions + inspectorPayloadOf/lastInspectablePayload (llm-input-chat-model.ts)
 *   - 도구 아이콘: ToolIcon (badges — toolIconHtml SSoT) / 분류 칩: Chip / 검색 하이라이트: splitHighlight
 *   - 글리프: ChatClaude/ChatUser/ChatThink/ChatReturn/ChatPin + Check/ErrorIcon/Warn/Search/Chevron (인스펙터 검색은 헤더 a-bar 로 일원화)
 *
 * @module features/llm-input/ChatRoom
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ToolIcon } from '../../components/render/badges';
import { Chip, type ChipTone } from '../../components/design-system/chips/Chip';
import {
  ChatClaude,
  ChatUser,
  ChatThink,
  ChatReturn,
  ChatPin,
  Check,
  ErrorIcon,
  Warn,
  Search,
  Chevron,
  Info,
  Bolt,
} from '../../components/design-system/icons';
import { type MessageLike, splitHighlight, formatBytes, SEARCH_MIN_LEN } from './llm-input-state';
import {
  toChatModel,
  groupParallelActions,
  inspectorPayloadOf,
  lastInspectablePayload,
  injectedLabelKey,
  type ChatItem,
  type ChatRenderItem,
  type ActionGroup,
  type InspectorPayload,
  type InspectorTFunc,
} from './llm-input-chat-model';

/**
 * system_prompt 재사용 비용 집계(server getSystemPromptUsageStats 와 동형).
 * 칩의 캐시 효율 신호 + 모달 집계 카드가 공유하는 표면.
 */
export interface SystemUsageLike {
  reqs?: number | null;
  total_input_tokens?: number | null;
  total_cache_read?: number | null;
  total_cache_create?: number | null;
  cache_hit_pct?: number | null;
  distinct_sessions?: number | null;
  distinct_models?: number | null;
  first_seen_at?: number | null;
  last_seen_at?: number | null;
}

/** system_prompts meta(LLMInput SystemMeta 와 동형 — PinnedSystem 이 export 와 함께 사용). */
export interface SystemMetaLike {
  segment_count?: number | null;
  byte_size?: number | null;
  ref_count?: number | null;
  usage?: SystemUsageLike | null;
  [k: string]: unknown;
}

/** 캐시 효율 등급 SSoT — 칩 dot 색과 모달 카드 색이 같은 임계값을 쓰도록 한 곳에서 결정. */
export type CacheEfficiency = 'high' | 'medium' | 'low';
export function cacheEfficiencyLevel(pct: number | null | undefined): CacheEfficiency | null {
  if (pct == null) return null;
  if (pct >= 90) return 'high';
  if (pct >= 50) return 'medium';
  return 'low';
}

/** 토큰 수 축약(45,824,080 → "45.8M") — 툴팁/카드 공용. */
export function formatTokenCompact(n: number | null | undefined): string {
  if (n == null) return '0';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export interface ChatRoomProps {
  messages: MessageLike[];
  /** 검색어(LLMInput a-head 소유 — 타임라인 하이라이트용). */
  search: string;
  /** "작성 중" 신호 — true 면 타임라인 하단에 Claude 타이핑 버블(점 애니메이션). */
  typing?: boolean;
  /**
   * "보고 있는 대화"의 정체성 키(= sessionId). 이 값이 바뀌면 **신선한 진입**(세션 전환)으로 보고
   * 다음 비어있지 않은 렌더에서 최신(맨 아래)으로 강제 점프한다. 같은 키 내 messages 변동(실시간 append·
   * 같은 세션 proxy 자동 advance)은 진입이 아니므로 바닥 근처일 때만 추종(위로 올려 읽는 중이면 방해 안 함).
   */
  conversationKey?: string;
}

/** 행 활성화(클릭) 콜백 — 자신의 ChatItem 과 선택 key 를 인스펙터로 올린다. */
type ActivateFn = (item: ChatItem, key: string) => void;

/** localStorage 키 — 좌측(타임라인) 폭 % 영속. */
const SPLIT_KEY = 'spyglass:chat-split';
const SPLIT_MIN = 40;
const SPLIT_MAX = 80;
const SPLIT_DEFAULT = 68;

/** 검색 하이라이트 텍스트(splitHighlight 재사용, mark 클래스는 llm-input.css SSoT). */
function Highlighted({ text, term }: { text: string; term: string }): ReactNode {
  // splitHighlight 는 텍스트 길이에 비례 — (text,term) 불변이면 재실행 회피(선택 변경 등 무관 리렌더 보호).
  const segs = useMemo(() => splitHighlight(text, term), [text, term]);
  return (
    <>
      {segs.map((s, i) =>
        s.mark ? (
          <mark key={i} className="llm-input-mark">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** 긴 본문 판정 임계 — 이보다 길면 클램프(미리보기). 전문은 인스펙터에서 정독. */
const CLAMP_CHARS = 480;
function isLong(text: string): boolean {
  return text.length > CLAMP_CHARS || (text.match(/\n/g)?.length ?? 0) > 8;
}

/**
 * 타임라인 행에 실제로 DOM 주입할 본문 cap — 거대 메시지(수십~수백 KB)를 통째로 렌더하면
 * 클램프(CSS 높이 제한)로 가려도 페인트·splitHighlight 비용이 메시지 크기에 비례해 폭증한다.
 * 미리보기는 이 cap 까지만 그리고 전문은 인스펙터(행 클릭)에서 본다 — 렌더 비용을 크기와 무관하게 상한.
 */
const PREVIEW_CAP = 1200;

/**
 * 미리보기 슬라이스 — cap 이하면 원문, 초과면:
 *  - 검색 term 매칭 위치가 있으면 그 주변 윈도우(매치 가시성 보존),
 *  - 없으면 앞부분 cap. 잘린 끝/앞에는 … 표시. (대화 행은 미리보기 — 전문은 인스펙터)
 */
function previewSlice(text: string, term: string): string {
  if (text.length <= PREVIEW_CAP) return text;
  if (term.length >= SEARCH_MIN_LEN) {
    const idx = text.toLowerCase().indexOf(term);
    if (idx >= 0) {
      const start = Math.max(0, idx - 200);
      const end = Math.min(text.length, start + PREVIEW_CAP);
      return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    }
  }
  return text.slice(0, PREVIEW_CAP) + '…';
}

/** 긴 본문 클램프 — 미리보기(max-height + 페이드). 검색 매칭 시 펼침. 전문은 인스펙터(박스 클릭). */
function ClampText({ text, term }: { text: string; term: string }): ReactElement {
  const matched = term.length >= SEARCH_MIN_LEN && text.toLowerCase().includes(term);
  const expanded = matched || !isLong(text);
  // 거대 본문은 cap 슬라이스만 DOM 주입(매치 시 윈도우) — 전문은 인스펙터. 렌더 비용 상한.
  const body = previewSlice(text, term);
  return (
    <div className={`chat-clamp${expanded ? ' chat-clamp--open' : ''}`}>
      <div className="chat-clamp-content">
        <Highlighted text={body} term={term} />
      </div>
    </div>
  );
}

/** 도구명 → 분류 칩 톤(Chip tone 매핑 — Skill/MCP/Task/Agent). */
function toolTone(name: string): ChipTone | null {
  if (name === 'Skill' || name.startsWith('Skill')) return 'skill';
  if (name.startsWith('mcp__')) return 'mcp';
  if (name.startsWith('Task')) return 'task';
  if (name === 'Agent' || name.startsWith('Agent')) return 'agent';
  return null;
}

/** action 아이템 input → 한 줄 평이 부제(지어내지 않음 — 실제 input 값 미리보기). */
function actionSubtitle(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const pick = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
  return (
    pick('file_path') ?? pick('path') ?? pick('pattern') ?? pick('command') ?? pick('query') ?? pick('url') ?? ''
  );
}

/** 아이템이 검색어에 매칭되는지(text/think/action input·결과 미리보기 대상). */
function itemMatches(item: ChatItem, needle: string): boolean {
  if (!needle) return false;
  const hay = [item.text ?? '', item.toolName ?? '', actionSubtitle(item.input), item.result?.preview ?? '']
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

/**
 * system 핀 공지 — meta 칩·ref_count·본문 토글. LLMInput a-head 가 렌더한다(헤더 흡수, 2차 현행화).
 * 타임라인이 아니라 헤더 영역에 고정해 대화 흐름과 분리한다.
 */
export interface SystemPinChipProps {
  hash?: string | null;
  size?: number | null;
  content?: string | null;
  meta?: SystemMetaLike | null;
  /** 본문 펼침 여부(controlled — 호출처 pinOpen). */
  open: boolean;
  onToggle: (open: boolean) => void;
  onRefsClick?: (hash: string) => void;
}
/**
 * 시스템 프롬프트 한 줄 칩 — a-head 헤더에 흡수(payload-chat-redesign, 헤더 1줄 통합).
 *  - 과거 둘째 줄 amber 배너(`.chat-pin`)를 폐기하고 segment/size/ref 를 req 옆 칩 한 개로 압축.
 *  - 클릭 = 본문 펼침 토글(전문 pre 는 SystemPinBody 가 헤더 아래에 렌더 — open SSoT 공유).
 *  - hash 없으면 a-bar 빈 system 칩(pill--empty) — 기존 계약 유지.
 */
export function SystemPinChip({ hash, size, content, meta, open, onToggle, onRefsClick }: SystemPinChipProps): ReactElement {
  const { t } = useTranslation();
  if (!hash) {
    return <span className="pill pill--empty">{t('ui:llm-input.system-none')}</span>;
  }
  const refCount = meta?.ref_count ?? 0;
  const bytes = formatBytes(meta?.byte_size ?? size ?? content?.length ?? 0);
  // 캐시 효율 신호 — "이 프롬프트가 N회 재사용됐다" 숫자 단독은 노이즈. 진짜 인사이트는
  // 그 재사용이 캐시를 탔는가(=토큰 비용 절감)인가다. cache_hit_pct 가 낮으면 매 요청마다
  // 입력 토큰을 통째로 다시 과금하는 비용 누수 신호 → dot 색(low=red)으로 즉시 인지시킨다.
  const cachePct = meta?.usage?.cache_hit_pct ?? null;
  const efficiency = cacheEfficiencyLevel(cachePct);
  const inputTok = meta?.usage?.total_input_tokens ?? null;
  const refTip =
    efficiency != null
      ? t('ui:llm-input.ref-count-btn-title', {
          count: refCount,
          pct: cachePct,
          tokens: formatTokenCompact(inputTok),
        })
      : t('ui:llm-input.ref-count-btn-title-nostat', { count: refCount });
  return (
    <span className="llm-input-syspin">
      <button
        type="button"
        className={`pill llm-input-syspin-btn${open ? ' is-open' : ''}`}
        aria-expanded={open}
        data-tip={t('ui:llm-input.chat.system-tip')}
        onClick={() => onToggle(!open)}
      >
        <span className="chat-ico">
          <ChatPin size={11} />
        </span>
        <span className="llm-input-syspin-label">{t('ui:llm-input.chat.system-title')}</span>
        <span className="llm-input-syspin-meta" data-tip={t('ui:llm-input.segment-count-title')}>
          seg {meta?.segment_count ?? '?'} · {bytes}
        </span>
        {efficiency != null ? (
          <span
            className="llm-input-syspin-cache"
            data-efficiency={efficiency}
            data-tip={t('ui:llm-input.cache-signal-title', { pct: cachePct })}
            aria-label={t('ui:llm-input.cache-signal-title', { pct: cachePct })}
          />
        ) : null}
      </button>
      <button
        type="button"
        className="chat-refs-toggle llm-input-refs-toggle"
        data-refs-hash={hash}
        aria-haspopup="dialog"
        aria-expanded="false"
        data-tip={refTip}
        onClick={(e) => {
          e.stopPropagation();
          onRefsClick?.(hash);
        }}
      >
        ref {refCount}
      </button>
    </span>
  );
}

/** 시스템 프롬프트 전문 — SystemPinChip 토글 open 시 헤더 바로 아래에 표시. */
export function SystemPinBody({ content }: { content?: string | null }): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="llm-input-syspin-body">
      {content ? <pre>{content}</pre> : <p className="chat-pin-sub">{t('ui:llm-input.system-load-failed')}</p>}
    </div>
  );
}

/** text 말풍선 행 — 클릭 시 인스펙터에 전문/원본 표시 + 선택 강조. */
function TextRow({
  item,
  term,
  selected,
  onActivate,
}: {
  item: ChatItem;
  term: string;
  selected: boolean;
  onActivate: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const isUser = item.role === 'user';
  return (
    <div className={`chat-row${isUser ? ' chat-row--me' : ''}`}>
      {!isUser ? (
        <span className="chat-avatar chat-avatar--claude" aria-hidden="true">
          <ChatClaude size={16} />
        </span>
      ) : null}
      <div className={`chat-bubble-wrap${isUser ? ' chat-bubble-wrap--me' : ''}`}>
        <span className="chat-speaker">
          {isUser ? (
            <>
              <ChatUser size={12} /> {t('ui:llm-input.chat.speaker-user')} <span className="orig">(user)</span>
            </>
          ) : (
            <>
              {t('ui:llm-input.chat.speaker-claude')} <span className="orig">(assistant)</span>
            </>
          )}
          {/* 인덱스를 화자 줄 뒤에 — "Claude (assistant) #476" */}
          <span className="chat-idx">#{item.msgIndex + 1}</span>
        </span>
        <button
          type="button"
          className={`chat-bubble${isUser ? ' chat-bubble--me' : ' chat-bubble--claude'}${selected ? ' chat-selected' : ''}`}
          aria-pressed={selected}
          data-tip={t('ui:llm-input.chat.inspect-tip')}
          onClick={onActivate}
        >
          <span className="chat-bubble-body">
            <ClampText text={item.text ?? ''} term={term} />
          </span>
        </button>
      </div>
    </div>
  );
}

/** thinking 사고 거품 — summary 는 펼침 토글, 본문 클릭은 인스펙터. */
function ThinkRow({
  item,
  term,
  selected,
  onActivate,
}: {
  item: ChatItem;
  term: string;
  selected: boolean;
  onActivate: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const matched = term.length >= SEARCH_MIN_LEN && itemMatches(item, term);
  const [open, setOpen] = useState(false);
  // 본문 빈(서명만 재전송된 thinking) — 클릭/펼침 대신 안내 문구. redacted 와 별개.
  const emptyBody = !item.redacted && !(item.text ?? '').trim();
  const isOpen = open || matched || emptyBody; // 안내가 보이도록 빈 본문은 기본 펼침
  return (
    <details
      className={`chat-think${item.redacted ? ' chat-think--locked' : ''}${emptyBody ? ' chat-think--empty' : ''}${selected ? ' chat-selected' : ''}`}
      open={isOpen}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="chat-ico">
          <ChatThink size={13} />
        </span>
        <span className="chat-think-lbl" data-tip={t('ui:llm-input.chat.thinking-tip')}>
          {item.redacted ? t('ui:llm-input.chat.thinking-redacted') : t('ui:llm-input.chat.thinking-label')}
        </span>
        <span className="chat-think-note">· {t('ui:llm-input.chat.thinking-note')}</span>
      </summary>
      {item.redacted ? (
        <div className="chat-think-body">{t('ui:llm-input.chat.thinking-redacted-body')}</div>
      ) : emptyBody ? (
        <div className="chat-think-body chat-think-empty" data-tip={t('ui:llm-input.chat.thinking-empty-tip')}>
          {t('ui:llm-input.chat.thinking-empty-body')}
        </div>
      ) : (
        <button type="button" className="chat-think-body chat-think-body--btn" data-tip={t('ui:llm-input.chat.inspect-tip')} onClick={onActivate}>
          <ClampText text={item.text ?? ''} term={term} />
        </button>
      )}
    </details>
  );
}

/** ↳ 결과 칩 — is_error 직독(이 소스 SSoT). 색+아이콘+라벨 동반(색맹 안전). 전문은 인스펙터. */
function ResultChip({ result }: { result: NonNullable<ChatItem['result']> }): ReactElement {
  const { t } = useTranslation();
  const err = result.isError;
  return (
    <div className={`chat-result${err ? ' chat-result--err' : ' chat-result--ok'}`}>
      <div className="chat-result-hd">
        <span className="chat-result-arrow"><ChatReturn size={13} /></span>
        <span className="chat-result-dot" />
        <span className="chat-verdict">
          {err ? <ErrorIcon size={12} /> : <Check selected size={12} />}
          {err ? t('ui:llm-input.chat.result-error') : t('ui:llm-input.chat.result-ok')}
        </span>
        {result.toolUseId ? (
          <span className="chat-result-ru" data-tip={t('ui:llm-input.chat.tool-result-tip')}>
            tool_result · {result.toolUseId}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** tool_use 행동 카드 한 칸 — 클릭 시 input·결과 전문을 인스펙터에. */
function ActionCall({
  item,
  selected,
  onActivate,
}: {
  item: ChatItem;
  selected: boolean;
  onActivate: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const tone = toolTone(item.toolName ?? '');
  const sub = actionSubtitle(item.input);
  const res = item.result ?? null;
  return (
    <button
      type="button"
      className={`chat-act-call${selected ? ' chat-selected' : ''}`}
      data-tip={t('ui:llm-input.chat.inspect-tip')}
      onClick={onActivate}
    >
      <div className="chat-act-hd">
        <ToolIcon toolName={item.toolName} eventType={res ? null : 'pre_tool'} />
        <span className="chat-act-name">{item.toolName || 'tool'}</span>
        <span className="chat-act-orig" data-tip={t('ui:llm-input.chat.tool-use-tip')}>
          tool_use
        </span>
        {tone ? <Chip tone={tone} label={tone.toUpperCase()} /> : null}
        {item.toolUseId ? <span className="chat-act-id">{item.toolUseId}</span> : null}
      </div>
      {sub ? (
        <div className="chat-act-sub">
          {t('ui:llm-input.chat.tool-use-sub', { tool: item.toolName || 'tool' })} <code>{sub}</code>
        </div>
      ) : null}
      {res ? (
        <ResultChip result={res} />
      ) : (
        <div className="chat-result">
          <div className="chat-result-hd">
            <span className="chat-result-arrow"><ChatReturn size={13} /></span>
            <span className="chat-result-hint">{t('ui:llm-input.chat.result-pending')}</span>
          </div>
        </div>
      )}
    </button>
  );
}

/** orphan tool_result — 짝 못 찾은 결과(숨기지 않고 진단). 클릭 시 인스펙터. */
function OrphanRow({ item, selected, onActivate }: { item: ChatItem; selected: boolean; onActivate: () => void }): ReactElement {
  const { t } = useTranslation();
  return (
    <button type="button" className={`chat-action chat-orphan-card${selected ? ' chat-selected' : ''}`} data-tip={t('ui:llm-input.chat.inspect-tip')} onClick={onActivate}>
      <div className="chat-act-call">
        <div className="chat-result">
          <div className="chat-result-hd">
            <span className="chat-orphan">
              <Warn size={12} />
              {t('ui:llm-input.chat.orphan', { id: item.toolUseId ?? '?' })}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

/** unknown part — 클릭 시 인스펙터(원본 JSON)로 진단. */
function UnknownRow({ item, selected, onActivate }: { item: ChatItem; selected: boolean; onActivate: () => void }): ReactElement {
  const { t } = useTranslation();
  return (
    <button type="button" className={`chat-action${selected ? ' chat-selected' : ''}`} data-tip={t('ui:llm-input.chat.inspect-tip')} onClick={onActivate}>
      <div className="chat-act-call">
        <div className="chat-act-sub chat-unknown-lbl">{t('ui:llm-input.chat.unknown', { type: item.partType ?? 'part' })}</div>
      </div>
    </button>
  );
}

/**
 * system 컨텍스트 행 — 주입된 컨텍스트/리마인더(claudeMd·스킬 목록·hook 출력 등). Claude 발화가 아니므로
 * 말풍선이 아닌 중립 카드로 분리하고 기본 접힘(거대 본문 노이즈 차단). summary 펼침은 미리보기, 클릭은 인스펙터.
 */
function SystemRow({
  item,
  term,
  selected,
  onActivate,
}: {
  item: ChatItem;
  term: string;
  selected: boolean;
  onActivate: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const matched = term.length >= SEARCH_MIN_LEN && itemMatches(item, term);
  const [open, setOpen] = useState(false);
  const isOpen = open || matched;
  const bytes = formatBytes((item.text ?? '').length);
  return (
    <details
      className={`chat-system${selected ? ' chat-selected' : ''}`}
      open={isOpen}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="chat-ico">
          <Info size={13} />
        </span>
        <span className="chat-system-lbl" data-tip={t('ui:llm-input.chat.system-context-tip')}>
          {t('ui:llm-input.chat.system-context-title')}
        </span>
        <span className="chat-system-meta">#{item.msgIndex + 1} · {bytes}</span>
      </summary>
      <button
        type="button"
        className="chat-system-body"
        data-tip={t('ui:llm-input.chat.inspect-tip')}
        onClick={onActivate}
      >
        <ClampText text={item.text ?? ''} term={term} />
      </button>
    </details>
  );
}

/**
 * 하네스 자동 주입 user 메시지 행(recap/caveat/슬래시 래퍼). role='user' 지만 사람 발화가 아니므로
 * "당신" 말풍선이 아닌 별도 중립 카드로 분리한다(SystemRow 와 동형 위계). 기본 접힘, summary 펼침은
 * 미리보기, 본문 클릭은 인스펙터. 라벨은 injectedLabelKey(SSoT)로 종류별 매핑.
 */
function InjectedRow({
  item,
  term,
  selected,
  onActivate,
}: {
  item: ChatItem;
  term: string;
  selected: boolean;
  onActivate: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const matched = term.length >= SEARCH_MIN_LEN && itemMatches(item, term);
  const [open, setOpen] = useState(false);
  const isOpen = open || matched;
  const bytes = formatBytes((item.text ?? '').length);
  return (
    <details
      className={`chat-injected${selected ? ' chat-selected' : ''}`}
      open={isOpen}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="chat-ico">
          <Bolt size={13} />
        </span>
        <span className="chat-injected-lbl" data-tip={t('ui:llm-input.chat.injected-tip')}>
          {t(injectedLabelKey(item.injectedKind))}
        </span>
        <span className="chat-injected-meta">#{item.msgIndex + 1} · {bytes}</span>
      </summary>
      <button
        type="button"
        className="chat-injected-body"
        data-tip={t('ui:llm-input.chat.inspect-tip')}
        onClick={onActivate}
      >
        <ClampText text={item.text ?? ''} term={term} />
      </button>
    </details>
  );
}

/**
 * "작성 중" 타이핑 버블 — Claude 측(좌측 정렬, 말풍선 아바타 동반). 카카오톡/디스코드식 점 3개 애니메이션.
 * 시각은 점 애니메이션만(텍스트 라벨 폐기 — 군더더기 제거). 의미는 aria-label 로 스크린리더에만 전달.
 * LIVE 활동 중 다음 턴 페이로드 도착 전까지 노출.
 */
function TypingBubble(): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="chat-row chat-row--typing" aria-live="polite">
      <span className="chat-avatar chat-avatar--claude" aria-hidden="true">
        <ChatClaude size={16} />
      </span>
      <div className="chat-bubble-wrap">
        <span className="chat-speaker">
          {t('ui:llm-input.chat.speaker-claude')} <span className="orig">(assistant)</span>
        </span>
        <div className="chat-bubble chat-bubble--claude chat-typing" role="status" aria-label={t('ui:llm-input.chat.typing')}>
          <span className="chat-typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 우측 상시 인스펙터 패널 — 선택 항목의 전문(full)/원본(raw)을 표시.
 *  - 자체 검색박스 폐기 — 헤더(a-bar) 검색(term)이 좌측 타임라인·우측 인스펙터 본문을 동시 하이라이트.
 *  - 헤더 한 줄 통합: 제목 + meta(역할·#idx·byte)를 좌측에, 전문/원본 토글을 우측에.
 *    전문/원본(mode)은 본문 표현 토글로 viewMode(폐기됨)와 무관하게 유지.
 */
function InspectorPanel({
  insp,
  mode,
  onMode,
  term,
}: {
  insp: InspectorPayload | null;
  mode: 'full' | 'raw';
  onMode: (m: 'full' | 'raw') => void;
  /** 헤더 검색에서 내려온 정규화 term(좌/우 공용 하이라이트). */
  term: string;
}): ReactElement {
  const { t } = useTranslation();
  const src = insp ? (mode === 'full' ? insp.text : insp.raw) : '';
  return (
    <aside className="chat-inspector" aria-label={t('ui:llm-input.chat.inspector-aria')}>
      <div className="chat-inspector-hd">
        <span className="chat-inspector-title">
          <span className="chat-ico"><Search size={13} /></span>
          <span className="chat-inspector-label">{insp ? insp.title : t('ui:llm-input.chat.inspector-empty')}</span>
          {insp ? <span className="chat-inspector-meta">{insp.meta}</span> : null}
        </span>
        <span className="chat-inspector-toggle" role="group">
          <button type="button" className={mode === 'full' ? 'on' : ''} aria-pressed={mode === 'full'} onClick={() => onMode('full')}>
            {t('ui:llm-input.chat.inspector-full')}
          </button>
          <button type="button" className={mode === 'raw' ? 'on' : ''} aria-pressed={mode === 'raw'} onClick={() => onMode('raw')}>
            {t('ui:llm-input.chat.inspector-raw')}
          </button>
        </span>
      </div>
      {insp ? (
        <div className="chat-inspector-body">
          <Highlighted text={src} term={term} />
        </div>
      ) : (
        <div className="chat-inspector-body chat-inspector-body--empty">
          <span className="chat-ico"><Search size={28} /></span>
          <span>{t('ui:llm-input.chat.inspector-empty-hint')}</span>
        </div>
      )}
    </aside>
  );
}

/** localStorage 에서 좌측 폭 % 복원(SSR/차단 환경 안전). */
function readSplit(): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SPLIT_KEY) : null;
    const n = raw ? parseFloat(raw) : NaN;
    if (Number.isFinite(n)) return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, n));
  } catch {
    /* noop */
  }
  return SPLIT_DEFAULT;
}

export function ChatRoom(props: ChatRoomProps): ReactElement {
  const { t: tBase } = useTranslation();
  const t = tBase as unknown as InspectorTFunc;
  const { messages, search, typing = false, conversationKey } = props;

  const renderItems = useMemo<ChatRenderItem[]>(() => groupParallelActions(toChatModel(messages)), [messages]);
  const term = search.trim().length >= SEARCH_MIN_LEN ? search.trim().toLowerCase() : '';

  // ── 상시 인스펙터 상태 ── 진입 기본 = 마지막 항목. 클릭 시 전환 + 선택 강조.
  const [insp, setInsp] = useState<InspectorPayload | null>(() => lastInspectablePayload(renderItems, t));
  const [inspMode, setInspMode] = useState<'full' | 'raw'>('full');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => {
    setInsp(lastInspectablePayload(renderItems, t));
    setSelectedKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderItems]);
  const activate: ActivateFn = (item, key) => {
    setInsp(inspectorPayloadOf(item, t));
    setSelectedKey(key);
  };

  // ── 진입 시 최신(맨 아래) 스크롤 + "최신으로" 점프 ──
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  // scrolledUp 의 ref 미러 — 추종 effect 는 새 카드 추가 *전* 위치로 판정해야 하므로(stale state 회피) ref 로 읽는다.
  const scrolledUpRef = useRef(false);
  // 신규 카드 stagger 판정용 — 직전 렌더의 renderItems 길이(다음 렌더에서 baseCount 로 읽힘).
  const prevCountRef = useRef(0);
  // 최신 점프 "예약" 플래그 — 마운트 + conversationKey(세션) 변경 시 true. 다음 비어있지 않은 렌더에서 1회 소진.
  // 빈 배열(로딩 중) 단계에서는 소진하지 않아, 세션 전환 후 실제 메시지가 도착한 프레임에 정확히 점프한다.
  const pendingJumpRef = useRef(true);
  const scrollToLatest = (smooth: boolean): void => {
    const el = timelineRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  // 세션(대화 정체성) 변경 = 신선한 진입 → 최신 점프 재예약. messages 는 같은 참조 유지라 renderItems effect
  // 는 이 프레임에 발화하지 않고, 새 세션 payload 가 도착해 renderItems 가 바뀌는 프레임에서 점프가 일어난다.
  useEffect(() => {
    pendingJumpRef.current = true;
  }, [conversationKey]);
  useEffect(() => {
    prevCountRef.current = renderItems.length; // 다음 렌더의 baseCount(신규 판정 기준) 갱신.

    if (pendingJumpRef.current) {
      // 진입/세션 전환 — 데이터가 아직 없으면 점프 보류(다음 갱신까지). 채워지면 즉시 맨 아래로(누가 첫 프롬프트를 보고 싶겠나).
      if (renderItems.length === 0) return undefined;
      pendingJumpRef.current = false;
      // 즉시 맨 아래(이미지·거대 본문 레이아웃 정착까지 더블 RAF 재보정).
      scrollToLatest(false);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        scrollToLatest(false);
        raf2 = requestAnimationFrame(() => scrollToLatest(false));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    // 같은 대화 내 갱신(실시간 append) — Claude 가 새 카드를 만들면 자동으로 따라 내려간다.
    // 판정은 **새 카드 추가 *전*** 사용자 위치(scrolledUpRef)로 한다 — 추가 *후* DOM 으로 nearBottom 을 재면
    // 방금 들어온 카드 높이(특히 수백 px 의 tool 카드)만큼 바닥에서 멀어져 "안 따라감"으로 항상 오판하기 때문.
    // 사용자가 위로 올려 과거를 읽는 중(scrolledUp)이면 끌어내리지 않고 "최신으로" 버튼으로 알린다.
    if (scrolledUpRef.current) return undefined;
    const raf = requestAnimationFrame(() => scrollToLatest(true));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderItems]);
  const onTimelineScroll = (): void => {
    const el = timelineRef.current;
    if (!el) return;
    // 사용자 능동 스크롤만 반영(추종 effect 가 추가 *전* 위치로 판정하도록 ref 미러). 임계 48px.
    const up = el.scrollHeight - el.scrollTop - el.clientHeight >= 48;
    scrolledUpRef.current = up;
    setScrolledUp(up);
  };
  // 타이핑 버블 등장 시 하단 추종(이미 바닥 근처일 때만 — 사용자가 위로 올려 읽는 중이면 방해 안 함).
  useEffect(() => {
    if (typing && !scrolledUpRef.current) scrollToLatest(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing]);

  // ── 좌우 폭 리사이저 ── localStorage 영속. pointer 드래그로 좌측 % 산출(clamp 40~80).
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [leftPct, setLeftPct] = useState<number>(() => readSplit());
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SPLIT_KEY, String(leftPct));
    } catch {
      /* noop */
    }
  }, [leftPct]);
  const onResizeStart = (e: ReactPointerEvent): void => {
    e.preventDefault();
    const shell = shellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const move = (ev: PointerEvent): void => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct)));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 각 아이템을 chat-reveal 래퍼로 감싼다(페이드+슬라이드 입장). 인덱스 기반 key 라 기존 아이템은
  // DOM 이 재사용돼 애니메이션이 재생되지 않고(이미 1회 forwards 종료), 새 턴으로 끝에 append 된 아이템만
  // 새 노드로 마운트돼 자연스럽게 등장한다 — "지금 작성된 글"을 모션으로 구분.
  const renderInner = (ri: ChatRenderItem, i: number): ReactElement => {
    const key = `i-${i}`;
    if ((ri as ActionGroup).kind === 'action-group') {
      const grp = ri as ActionGroup;
      return (
        <div className="chat-action chat-action--parallel">
          <div className="chat-parallel-hd">{t('ui:llm-input.chat.parallel', { count: grp.actions.length })}</div>
          {grp.actions.map((a, j) => {
            const gk = `g-${i}-${j}`;
            return <ActionCall item={a} selected={selectedKey === gk} onActivate={() => activate(a, gk)} key={gk} />;
          })}
        </div>
      );
    }
    const item = ri as ChatItem;
    switch (item.kind) {
      case 'text':
        return <TextRow item={item} term={term} selected={selectedKey === key} onActivate={() => activate(item, key)} />;
      case 'think':
        return <ThinkRow item={item} term={term} selected={selectedKey === key} onActivate={() => activate(item, key)} />;
      case 'action':
        return (
          <div className="chat-action">
            <ActionCall item={item} selected={selectedKey === key} onActivate={() => activate(item, key)} />
          </div>
        );
      case 'system':
        return <SystemRow item={item} term={term} selected={selectedKey === key} onActivate={() => activate(item, key)} />;
      case 'injected':
        return <InjectedRow item={item} term={term} selected={selectedKey === key} onActivate={() => activate(item, key)} />;
      case 'orphan-result':
        return <OrphanRow item={item} selected={selectedKey === key} onActivate={() => activate(item, key)} />;
      default:
        return <UnknownRow item={item} selected={selectedKey === key} onActivate={() => activate(item, key)} />;
    }
  };
  // 신규(이번 갱신에 끝에 append 된) 아이템만 순차 stagger 로 등장시킨다. baseCount = 직전 렌더 길이.
  // 인덱스 ≥ baseCount = 새 노드 → animationDelay 부여(첫 마운트(base 0)는 동시 페이드 — 거대 이력 cascade 방지).
  const baseCount = prevCountRef.current;
  const renderItem = (ri: ChatRenderItem, i: number): ReactElement => {
    const isNew = baseCount > 0 && i >= baseCount;
    const delay = isNew ? Math.min(i - baseCount, 8) * 60 : 0;
    const style = delay ? ({ animationDelay: `${delay}ms` } as CSSProperties) : undefined;
    return (
      <div className="chat-reveal" style={style} key={`i-${i}`}>
        {renderInner(ri, i)}
      </div>
    );
  };

  return (
    <div className="chat-room">
      <div className="chat-shell" ref={shellRef} style={{ '--chat-left': `${leftPct}%` } as CSSProperties}>
        {/* 좌측 — 대화 컬럼(내부 스크롤) */}
        <div className="chat-main">
          <div className="chat-timeline" ref={timelineRef} onScroll={onTimelineScroll}>
            {/* system 핀은 LLMInput a-head 로 흡수됨(헤더 고정). 타임라인은 순수 대화만. */}
            {messages.length === 0 ? (
              <p className="chat-pin-sub">{t('ui:llm-input.no-messages')}</p>
            ) : (
              renderItems.map((ri, i) => renderItem(ri, i))
            )}
            {/* "작성 중" — Claude 측 타이핑 버블(점 애니메이션). LIVE 활동 중 다음 턴 도착 전까지. */}
            {typing ? <TypingBubble /> : null}
          </div>
          <button
            type="button"
            className={`chat-jump-latest${scrolledUp ? ' chat-jump-latest--show' : ''}`}
            onClick={() => scrollToLatest(true)}
          >
            <Chevron dir="down" size={12} /> {t('ui:llm-input.chat.jump-latest')}
          </button>
        </div>

        {/* 리사이저 — 드래그로 좌우 폭 조절 */}
        <div
          className="chat-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('ui:llm-input.chat.resize-aria')}
          onPointerDown={onResizeStart}
        />

        {/* 우측 — 상시 인스펙터 (헤더 검색 term 공유) */}
        <InspectorPanel insp={insp} mode={inspMode} onMode={setInspMode} term={term} />
      </div>
    </div>
  );
}
