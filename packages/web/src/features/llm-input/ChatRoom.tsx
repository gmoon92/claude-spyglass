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
 *   - 글리프: ChatClaude/ChatUser/ChatThink/ChatReturn/ChatPin + Check/ErrorIcon/Warn/Search/Chevron / 검색입력: SearchBox
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
} from '../../components/design-system/icons';
import { SearchBox } from '../../components/SearchBox';
import { type MessageLike, splitHighlight, formatBytes, SEARCH_MIN_LEN } from './llm-input-state';
import {
  toChatModel,
  groupParallelActions,
  inspectorPayloadOf,
  lastInspectablePayload,
  type ChatItem,
  type ChatRenderItem,
  type ActionGroup,
  type InspectorPayload,
} from './llm-input-chat-model';

type TFunc = (key: string, vars?: Record<string, unknown>) => string;

/** system_prompts meta(LLMInput SystemMeta 와 동형 — PinnedSystem 이 export 와 함께 사용). */
export interface SystemMetaLike {
  segment_count?: number | null;
  byte_size?: number | null;
  ref_count?: number | null;
  [k: string]: unknown;
}

export interface ChatRoomProps {
  messages: MessageLike[];
  /** 검색어(LLMInput a-head 소유 — 타임라인 하이라이트용). */
  search: string;
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
  const segs = splitHighlight(text, term);
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

/** 긴 본문 클램프 — 미리보기(max-height + 페이드). 검색 매칭 시 펼침. 전문은 인스펙터(박스 클릭). */
function ClampText({ text, term }: { text: string; term: string }): ReactElement {
  const matched = term.length >= SEARCH_MIN_LEN && text.toLowerCase().includes(term);
  const expanded = matched || !isLong(text);
  return (
    <div className={`chat-clamp${expanded ? ' chat-clamp--open' : ''}`}>
      <div className="chat-clamp-content">
        <Highlighted text={text} term={term} />
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
export interface PinnedSystemProps {
  hash?: string | null;
  content?: string | null;
  meta?: SystemMetaLike | null;
  open: boolean;
  onToggle: (open: boolean) => void;
  onRefsClick?: (hash: string) => void;
  t: TFunc;
}
export function PinnedSystem({ hash, content, meta, open, onToggle, onRefsClick, t }: PinnedSystemProps): ReactElement {
  if (!hash) {
    return (
      <section className="chat-pin chat-pin--empty">
        <p>{t('ui.llm-input.no-system-field')}</p>
      </section>
    );
  }
  const refCount = meta?.ref_count ?? 0;
  return (
    <details className="chat-pin" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className="chat-pin-title">
          <span className="chat-ico">
            <ChatPin size={13} />
          </span>
          {t('ui.llm-input.chat.system-title')}
          <span className="chat-think-note" data-tip={t('ui.llm-input.chat.system-tip')}>
            (system prompt)
          </span>
        </span>
        <span className="chat-pin-sub">{t('ui.llm-input.chat.system-sub')}</span>
        <span className="chat-pin-meta">
          <span data-tip={t('ui.llm-input.segment-count-title')}>segment {meta?.segment_count ?? '?'}</span>
          <span data-tip={t('ui.llm-input.byte-size-title')}>{formatBytes(meta?.byte_size ?? (content?.length ?? 0))}</span>
          {hash ? (
            <button
              type="button"
              className="chat-refs-toggle llm-input-refs-toggle"
              data-refs-hash={hash}
              aria-haspopup="dialog"
              aria-expanded="false"
              data-tip={t('ui.llm-input.ref-count-btn-title', { count: refCount })}
              onClick={(e) => {
                e.stopPropagation();
                onRefsClick?.(hash);
              }}
            >
              ref {refCount}
            </button>
          ) : null}
        </span>
      </summary>
      {content ? <pre>{content}</pre> : <p className="chat-pin-sub">{t('ui.llm-input.system-load-failed')}</p>}
    </details>
  );
}

/** text 말풍선 행 — 클릭 시 인스펙터에 전문/원본 표시 + 선택 강조. */
function TextRow({
  item,
  term,
  selected,
  onActivate,
  t,
}: {
  item: ChatItem;
  term: string;
  selected: boolean;
  onActivate: () => void;
  t: TFunc;
}): ReactElement {
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
              <ChatUser size={12} /> {t('ui.llm-input.chat.speaker-user')} <span className="orig">(user)</span>
            </>
          ) : (
            <>
              {t('ui.llm-input.chat.speaker-claude')} <span className="orig">(assistant)</span>
            </>
          )}
          {/* 인덱스를 화자 줄 뒤에 — "Claude (assistant) #476" */}
          <span className="chat-idx">#{item.msgIndex + 1}</span>
        </span>
        <button
          type="button"
          className={`chat-bubble${isUser ? ' chat-bubble--me' : ' chat-bubble--claude'}${selected ? ' chat-selected' : ''}`}
          aria-pressed={selected}
          data-tip={t('ui.llm-input.chat.inspect-tip')}
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
  t,
}: {
  item: ChatItem;
  term: string;
  selected: boolean;
  onActivate: () => void;
  t: TFunc;
}): ReactElement {
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
        <span className="chat-think-lbl" data-tip={t('ui.llm-input.chat.thinking-tip')}>
          {item.redacted ? t('ui.llm-input.chat.thinking-redacted') : t('ui.llm-input.chat.thinking-label')}
        </span>
        <span className="chat-think-note">· {t('ui.llm-input.chat.thinking-note')}</span>
      </summary>
      {item.redacted ? (
        <div className="chat-think-body">{t('ui.llm-input.chat.thinking-redacted-body')}</div>
      ) : emptyBody ? (
        <div className="chat-think-body chat-think-empty" data-tip={t('ui.llm-input.chat.thinking-empty-tip')}>
          {t('ui.llm-input.chat.thinking-empty-body')}
        </div>
      ) : (
        <button type="button" className="chat-think-body chat-think-body--btn" data-tip={t('ui.llm-input.chat.inspect-tip')} onClick={onActivate}>
          <ClampText text={item.text ?? ''} term={term} />
        </button>
      )}
    </details>
  );
}

/** ↳ 결과 칩 — is_error 직독(이 소스 SSoT). 색+아이콘+라벨 동반(색맹 안전). 전문은 인스펙터. */
function ResultChip({ result, t }: { result: NonNullable<ChatItem['result']>; t: TFunc }): ReactElement {
  const err = result.isError;
  return (
    <div className={`chat-result${err ? ' chat-result--err' : ' chat-result--ok'}`}>
      <div className="chat-result-hd">
        <span className="chat-result-arrow"><ChatReturn size={13} /></span>
        <span className="chat-result-dot" />
        <span className="chat-verdict">
          {err ? <ErrorIcon size={12} /> : <Check selected size={12} />}
          {err ? t('ui.llm-input.chat.result-error') : t('ui.llm-input.chat.result-ok')}
        </span>
        {result.toolUseId ? (
          <span className="chat-result-ru" data-tip={t('ui.llm-input.chat.tool-result-tip')}>
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
  t,
}: {
  item: ChatItem;
  selected: boolean;
  onActivate: () => void;
  t: TFunc;
}): ReactElement {
  const tone = toolTone(item.toolName ?? '');
  const sub = actionSubtitle(item.input);
  const res = item.result ?? null;
  return (
    <button
      type="button"
      className={`chat-act-call${selected ? ' chat-selected' : ''}`}
      data-tip={t('ui.llm-input.chat.inspect-tip')}
      onClick={onActivate}
    >
      <div className="chat-act-hd">
        <ToolIcon toolName={item.toolName} eventType={res ? null : 'pre_tool'} />
        <span className="chat-act-name">{item.toolName || 'tool'}</span>
        <span className="chat-act-orig" data-tip={t('ui.llm-input.chat.tool-use-tip')}>
          tool_use
        </span>
        {tone ? <Chip tone={tone} label={tone.toUpperCase()} /> : null}
        {item.toolUseId ? <span className="chat-act-id">{item.toolUseId}</span> : null}
      </div>
      {sub ? (
        <div className="chat-act-sub">
          {t('ui.llm-input.chat.tool-use-sub', { tool: item.toolName || 'tool' })} <code>{sub}</code>
        </div>
      ) : null}
      {res ? (
        <ResultChip result={res} t={t} />
      ) : (
        <div className="chat-result">
          <div className="chat-result-hd">
            <span className="chat-result-arrow"><ChatReturn size={13} /></span>
            <span className="chat-result-hint">{t('ui.llm-input.chat.result-pending')}</span>
          </div>
        </div>
      )}
    </button>
  );
}

/** orphan tool_result — 짝 못 찾은 결과(숨기지 않고 진단). 클릭 시 인스펙터. */
function OrphanRow({ item, selected, onActivate, t }: { item: ChatItem; selected: boolean; onActivate: () => void; t: TFunc }): ReactElement {
  return (
    <button type="button" className={`chat-action chat-orphan-card${selected ? ' chat-selected' : ''}`} data-tip={t('ui.llm-input.chat.inspect-tip')} onClick={onActivate}>
      <div className="chat-act-call">
        <div className="chat-result">
          <div className="chat-result-hd">
            <span className="chat-orphan">
              <Warn size={12} />
              {t('ui.llm-input.chat.orphan', { id: item.toolUseId ?? '?' })}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

/** unknown part — 클릭 시 인스펙터(원본 JSON)로 진단. */
function UnknownRow({ item, selected, onActivate, t }: { item: ChatItem; selected: boolean; onActivate: () => void; t: TFunc }): ReactElement {
  return (
    <button type="button" className={`chat-action${selected ? ' chat-selected' : ''}`} data-tip={t('ui.llm-input.chat.inspect-tip')} onClick={onActivate}>
      <div className="chat-act-call">
        <div className="chat-act-sub chat-unknown-lbl">{t('ui.llm-input.chat.unknown', { type: item.partType ?? 'part' })}</div>
      </div>
    </button>
  );
}

/**
 * 우측 상시 인스펙터 패널 — 선택 항목의 전문(full)/원본(raw)을 본문 내 검색과 함께 표시.
 * "인스펙터" 라벨 없이 선택 항목 제목만. 본문은 border-left accent 박스로 "선택 박스의 내용"임을 시각 연결.
 */
function InspectorPanel({
  insp,
  mode,
  onMode,
  search,
  onSearch,
  t,
}: {
  insp: InspectorPayload | null;
  mode: 'full' | 'raw';
  onMode: (m: 'full' | 'raw') => void;
  search: string;
  onSearch: (q: string) => void;
  t: TFunc;
}): ReactElement {
  const term = search.trim().length >= SEARCH_MIN_LEN ? search.trim().toLowerCase() : '';
  const src = insp ? (mode === 'full' ? insp.text : insp.raw) : '';
  return (
    <aside className="chat-inspector" aria-label={t('ui.llm-input.chat.inspector-aria')}>
      <div className="chat-inspector-hd">
        <span className="chat-inspector-title">
          <span className="chat-ico"><Search size={13} /></span>
          <span className="chat-inspector-label">{insp ? insp.title : t('ui.llm-input.chat.inspector-empty')}</span>
        </span>
        <span className="chat-inspector-toggle" role="group">
          <button type="button" className={mode === 'full' ? 'on' : ''} aria-pressed={mode === 'full'} onClick={() => onMode('full')}>
            {t('ui.llm-input.chat.inspector-full')}
          </button>
          <button type="button" className={mode === 'raw' ? 'on' : ''} aria-pressed={mode === 'raw'} onClick={() => onMode('raw')}>
            {t('ui.llm-input.chat.inspector-raw')}
          </button>
        </span>
      </div>
      {insp ? <div className="chat-inspector-meta">{insp.meta}</div> : null}
      {/* .feed-search 래퍼 필수 — feed-search-icon/clear 가 position:absolute. */}
      <div className="feed-search chat-inspector-search">
        <SearchBox value={search} placeholder={t('ui.llm-input.chat.inspector-search')} onSearch={onSearch} clearLabel={t('ui.llm-input.chat.search-clear')} />
      </div>
      {insp ? (
        <div className="chat-inspector-body">
          <Highlighted text={src} term={term} />
        </div>
      ) : (
        <div className="chat-inspector-body chat-inspector-body--empty">
          <span className="chat-ico"><Search size={28} /></span>
          <span>{t('ui.llm-input.chat.inspector-empty-hint')}</span>
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
  const { t } = useTranslation() as { t: TFunc };
  const { messages, search } = props;

  const renderItems = useMemo<ChatRenderItem[]>(() => groupParallelActions(toChatModel(messages)), [messages]);
  const term = search.trim().length >= SEARCH_MIN_LEN ? search.trim().toLowerCase() : '';

  // ── 상시 인스펙터 상태 ── 진입 기본 = 마지막 항목. 클릭 시 전환 + 선택 강조.
  const [insp, setInsp] = useState<InspectorPayload | null>(() => lastInspectablePayload(renderItems, t));
  const [inspMode, setInspMode] = useState<'full' | 'raw'>('full');
  const [inspSearch, setInspSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => {
    setInsp(lastInspectablePayload(renderItems, t));
    setInspSearch('');
    setSelectedKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderItems]);
  const activate: ActivateFn = (item, key) => {
    setInsp(inspectorPayloadOf(item, t));
    setInspSearch('');
    setSelectedKey(key);
  };

  // ── 진입 시 최신(맨 아래) 스크롤 + "최신으로" 점프 ──
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const scrollToLatest = (smooth: boolean): void => {
    const el = timelineRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  useEffect(() => {
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
  }, [renderItems]);
  const onTimelineScroll = (): void => {
    const el = timelineRef.current;
    if (!el) return;
    setScrolledUp(el.scrollHeight - el.scrollTop - el.clientHeight >= 48);
  };

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

  const renderItem = (ri: ChatRenderItem, i: number): ReactElement => {
    const key = `i-${i}`;
    if ((ri as ActionGroup).kind === 'action-group') {
      const grp = ri as ActionGroup;
      return (
        <div className="chat-action chat-action--parallel" key={`g-${i}`}>
          <div className="chat-parallel-hd">{t('ui.llm-input.chat.parallel', { count: grp.actions.length })}</div>
          {grp.actions.map((a, j) => {
            const gk = `g-${i}-${j}`;
            return <ActionCall item={a} selected={selectedKey === gk} onActivate={() => activate(a, gk)} t={t} key={gk} />;
          })}
        </div>
      );
    }
    const item = ri as ChatItem;
    switch (item.kind) {
      case 'text':
        return <TextRow item={item} term={term} selected={selectedKey === key} onActivate={() => activate(item, key)} t={t} key={key} />;
      case 'think':
        return <ThinkRow item={item} term={term} selected={selectedKey === key} onActivate={() => activate(item, key)} t={t} key={key} />;
      case 'action':
        return (
          <div className="chat-action" key={key}>
            <ActionCall item={item} selected={selectedKey === key} onActivate={() => activate(item, key)} t={t} />
          </div>
        );
      case 'orphan-result':
        return <OrphanRow item={item} selected={selectedKey === key} onActivate={() => activate(item, key)} t={t} key={key} />;
      default:
        return <UnknownRow item={item} selected={selectedKey === key} onActivate={() => activate(item, key)} t={t} key={key} />;
    }
  };

  return (
    <div className="chat-room">
      <div className="chat-shell" ref={shellRef} style={{ '--chat-left': `${leftPct}%` } as CSSProperties}>
        {/* 좌측 — 대화 컬럼(내부 스크롤) */}
        <div className="chat-main">
          <div className="chat-timeline" ref={timelineRef} onScroll={onTimelineScroll}>
            {/* system 핀은 LLMInput a-head 로 흡수됨(헤더 고정). 타임라인은 순수 대화만. */}
            {messages.length === 0 ? (
              <p className="chat-pin-sub">{t('ui.llm-input.no-messages')}</p>
            ) : (
              renderItems.map((ri, i) => renderItem(ri, i))
            )}
          </div>
          <button
            type="button"
            className={`chat-jump-latest${scrolledUp ? ' chat-jump-latest--show' : ''}`}
            onClick={() => scrollToLatest(true)}
          >
            <Chevron dir="down" size={12} /> {t('ui.llm-input.chat.jump-latest')}
          </button>
        </div>

        {/* 리사이저 — 드래그로 좌우 폭 조절 */}
        <div
          className="chat-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('ui.llm-input.chat.resize-aria')}
          onPointerDown={onResizeStart}
        />

        {/* 우측 — 상시 인스펙터 */}
        <InspectorPanel insp={insp} mode={inspMode} onMode={setInspMode} search={inspSearch} onSearch={setInspSearch} t={t} />
      </div>
    </div>
  );
}
