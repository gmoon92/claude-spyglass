/**
 * features/llm-input/llm-input-chat-model.ts — 대화형(Chat) 뷰 순수 변환 SSoT (payload-chat-redesign)
 *
 * 책임: 느슨한 `messages[]`(API 원본 페이로드)를 채팅 타임라인 아이템 배열로 변환한다.
 *   ChatRoom.tsx 는 이 순수 함수 결과만 렌더한다(컴포넌트는 변환 로직을 재구현하지 않는다 — 캡슐화 원칙).
 *
 * 4종 content part → 4종 위계 아이템:
 *   - text                        → kind 'text'   (좌우 말풍선)
 *   - thinking / redacted_thinking → kind 'think'  (assistant 사고 거품. redacted 는 본문 없음 = 잠금)
 *   - tool_use                    → kind 'action' (행동 카드. id 보관)
 *   - tool_result                 → 직전 tool_use 액션에 **tool_use_id 로 귀속**(인접 가정 금지).
 *                                    짝 못 찾으면 kind 'orphan-result'(진단 노출, 숨기지 않음).
 *   - 그 외/빈 content            → kind 'unknown'(원본 JSON 으로 폴백 렌더)
 *
 * 충실도 원칙:
 *   - tool_result 의 성공/실패는 API content part 의 `is_error` 필드를 **직접 읽는다**(이 데이터 소스의 SSoT).
 *     hook 요청 행용 toolHasError() 는 형태(`{payload, tool_name}`)가 달라 여기 적용 불가 — 혼용 금지.
 *   - 결과 요약을 지어내지 않는다. 실제 content 의 미리보기(previewFromContent)만 노출한다.
 *   - 원본 배열 순서를 보존한다(msgIndex). 재배열 금지.
 *
 * @module features/llm-input/llm-input-chat-model
 */
import { type MessageLike, type ContentPart, previewFromContent, formatBytes } from './llm-input-state';

/** tool_use 에 귀속된 tool_result(결과 칩) 데이터. */
export interface ChatResult {
  /** API content part 의 is_error 직독(이 소스의 SSoT). */
  isError: boolean;
  /** 실제 content 미리보기(지어낸 요약 아님). */
  preview: string;
  /** 짝지어진 tool_use id(tool_use_id). */
  toolUseId: string | null;
  /** 원본 tool_result part('{ }' 원본 보기). */
  raw: unknown;
}

export type ChatItemKind = 'text' | 'think' | 'action' | 'orphan-result' | 'system' | 'unknown';

/** 채팅 타임라인 단일 아이템(느슨한 합집합 — kind 로 분기). */
export interface ChatItem {
  kind: ChatItemKind;
  /** 'user' | 'assistant' | 그 외(원본 role). think 는 항상 'assistant'. */
  role: string;
  /** 원본 messages 배열 인덱스(#index, 화면 표기·병렬 그룹핑 키). */
  msgIndex: number;
  /** text / think / orphan 미리보기 본문. */
  text?: string;
  /** think: redacted_thinking 이면 true(본문 비공개 = 잠금 표시). */
  redacted?: boolean;
  /** action: 도구명(tool_use.name). */
  toolName?: string;
  /** action / orphan: tool_use.id 또는 tool_result.tool_use_id. */
  toolUseId?: string | null;
  /** action: tool_use.input(원본). */
  input?: unknown;
  /** action: 귀속된 결과(없으면 null = 결과 대기/미수신). orphan: 결과 본체. */
  result?: ChatResult | null;
  /** unknown: 원본 part type 문자열. */
  partType?: string;
  /** 원본 part 또는 메시지('{ }' 원본 보기). */
  raw?: unknown;
}

/** content part 의 느슨한 확장(thinking/tool_use/tool_result 필드 포함). */
interface LoosePart extends ContentPart {
  thinking?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
}

/**
 * messages[] → ChatItem[] 순수 변환.
 * 전방 1-pass: tool_use 를 id 로 등록해 두고, 뒤따르는(다른 user 메시지일 수 있는) tool_result 를 id 로 귀속.
 */
export function toChatModel(messages: MessageLike[]): ChatItem[] {
  const items: ChatItem[] = [];
  // tool_use_id → 해당 action 아이템(인접이 아니라 id 로 결합 — 병렬 호출 안전).
  const actionById = new Map<string, ChatItem>();

  messages.forEach((m, i) => {
    const role = String(m?.role ?? 'unknown');
    const content = m?.content;

    // role=system — 주입된 컨텍스트/리마인더(claudeMd·스킬 카탈로그·hook 출력 등). Claude 발화가 아니므로
    // 'text'(=Claude 말풍선)로 흘려보내지 않고 별도 위계('system')로 분리한다. 보통 string 본문이지만
    // 배열이면 text part 만 모아 한 덩어리로(나머지 part 는 system 컨텍스트에선 의미 없음).
    if (role === 'system') {
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((p): p is LoosePart => !!p && typeof p === 'object' && (p as LoosePart).type === 'text')
                .map((p) => (typeof p.text === 'string' ? p.text : ''))
                .join('\n')
            : '';
      items.push({ kind: 'system', role, msgIndex: i, text, raw: m });
      return;
    }

    if (typeof content === 'string') {
      items.push({ kind: 'text', role, msgIndex: i, text: content, raw: m });
      return;
    }

    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as LoosePart;
        const type = String(p.type ?? 'unknown');

        if (type === 'text' && typeof p.text === 'string') {
          items.push({ kind: 'text', role, msgIndex: i, text: p.text, raw: part });
        } else if (type === 'thinking' || type === 'redacted_thinking') {
          const text = type === 'thinking' && typeof p.thinking === 'string' ? p.thinking : '';
          items.push({
            kind: 'think',
            role: 'assistant',
            msgIndex: i,
            text,
            redacted: type === 'redacted_thinking',
            raw: part,
          });
        } else if (type === 'tool_use') {
          const id = typeof p.id === 'string' ? p.id : null;
          const item: ChatItem = {
            kind: 'action',
            role: 'assistant',
            msgIndex: i,
            toolName: typeof p.name === 'string' ? p.name : '',
            toolUseId: id,
            input: p.input,
            result: null,
            raw: part,
          };
          items.push(item);
          if (id) actionById.set(id, item);
        } else if (type === 'tool_result') {
          const tid = typeof p.tool_use_id === 'string' ? p.tool_use_id : null;
          const result: ChatResult = {
            isError: p.is_error === true,
            preview: previewFromContent(p.content),
            toolUseId: tid,
            raw: part,
          };
          const target = tid ? actionById.get(tid) : undefined;
          if (target && (target.result === null || target.result === undefined)) {
            target.result = result;
          } else {
            // 짝 tool_use 미발견(또는 이미 결과 보유) — 숨기지 않고 진단 노출.
            items.push({
              kind: 'orphan-result',
              role,
              msgIndex: i,
              toolUseId: tid,
              text: result.preview,
              result,
              raw: part,
            });
          }
        } else {
          items.push({ kind: 'unknown', role, msgIndex: i, partType: type, raw: part });
        }
      }
      return;
    }

    // 빈/비정형 content — 원본 폴백.
    items.push({ kind: 'unknown', role, msgIndex: i, partType: 'empty', raw: m });
  });

  return items;
}

/**
 * 같은 메시지(msgIndex)의 연속 action 아이템을 병렬 그룹으로 묶는다(렌더 보조).
 * 반환: 평탄 아이템과 'action-group'(병렬 2개 이상) 의 혼합 — ChatRoom 이 순서대로 렌더.
 */
export interface ActionGroup {
  kind: 'action-group';
  msgIndex: number;
  actions: ChatItem[];
}
export type ChatRenderItem = ChatItem | ActionGroup;

export function groupParallelActions(items: ChatItem[]): ChatRenderItem[] {
  const out: ChatRenderItem[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (cur.kind === 'action') {
      // 같은 msgIndex 의 연속 action 수집.
      const run: ChatItem[] = [cur];
      let j = i + 1;
      while (j < items.length && items[j].kind === 'action' && items[j].msgIndex === cur.msgIndex) {
        run.push(items[j]);
        j++;
      }
      if (run.length > 1) {
        out.push({ kind: 'action-group', msgIndex: cur.msgIndex, actions: run });
      } else {
        out.push(cur);
      }
      i = j;
    } else {
      out.push(cur);
      i++;
    }
  }
  return out;
}

/**
 * 상시 인스펙터(우측 패널)에 띄울 단일 항목 페이로드.
 * ChatRoom 의 ↗ 버튼 클릭과 '진입 시 마지막 항목 기본 노출' 이 **공유**하는 표현(호출측 재계산 금지).
 *   - title: 항목 종류·화자 식별(예: 'Claude 답변', 'Read', 'tool_result')
 *   - meta : 보조 메타 한 줄(role · #index · 바이트 등)
 *   - text : 전문(full) 탭 본문 — 사람이 읽는 평이 텍스트
 *   - raw  : 원본(raw) 탭 본문 — 원본 part/메시지 JSON
 */
export interface InspectorPayload {
  title: string;
  meta: string;
  text: string;
  raw: string;
}

/** i18n 번역 함수 시그니처(react-i18next t 와 동형 — 모듈 순수성 위해 로컬 정의). */
export type InspectorTFunc = (key: string, vars?: Record<string, unknown>) => string;

/** 안전 JSON 직렬화(순환·비직렬화 방어 — 컴포넌트 try/catch 중복 제거). */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
}

/**
 * ChatItem → 인스펙터 페이로드. kind 별로 전문/원본을 구성한다(지어내지 않음 — 실제 필드만).
 * title/meta 라벨만 t(i18n)로 조립하고, text/raw 추출(핵심)은 본 함수가 소유한다(SSoT).
 */
export function inspectorPayloadOf(item: ChatItem, t: InspectorTFunc): InspectorPayload {
  const idx = `#${item.msgIndex + 1}`;
  const raw = safeJson(item.raw);
  switch (item.kind) {
    case 'text': {
      const who = item.role === 'user' ? 'user' : 'assistant';
      const label = item.role === 'user' ? t('ui.llm-input.chat.speaker-user') : t('ui.llm-input.chat.speaker-claude');
      return {
        title: `${label} (${who})`,
        meta: `${who} · ${idx} · ${formatBytes((item.text ?? '').length)}`,
        text: item.text ?? '',
        raw,
      };
    }
    case 'think': {
      const thinkBody = (item.text ?? '').trim();
      return {
        title: item.redacted ? t('ui.llm-input.chat.thinking-redacted') : t('ui.llm-input.chat.thinking-label'),
        meta: `thinking · ${idx}`,
        // redacted=봉인 안내 / 본문 빈(서명만 재전송)=미포함 안내 / 그 외=본문.
        text: item.redacted
          ? t('ui.llm-input.chat.thinking-redacted-body')
          : thinkBody || t('ui.llm-input.chat.thinking-empty-body'),
        raw,
      };
    }
    case 'action': {
      const name = item.toolName || 'tool';
      const inputBlock = item.input !== undefined ? `[input]\n${safeJson(item.input)}` : '';
      const res = item.result;
      const resultBlock = res ? `\n\n[result${res.isError ? ' · error' : ''}]\n${res.preview}` : '';
      return {
        title: name,
        meta: `tool_use · ${idx}${item.toolUseId ? ` · ${item.toolUseId}` : ''}`,
        text: `${inputBlock}${resultBlock}`.trim() || '(no input)',
        raw,
      };
    }
    case 'orphan-result':
      return {
        title: 'tool_result',
        meta: `tool_result · ${idx}${item.toolUseId ? ` · ${item.toolUseId}` : ''}`,
        text: item.result?.preview ?? item.text ?? '',
        raw,
      };
    case 'system':
      return {
        title: t('ui.llm-input.chat.system-context-title'),
        meta: `system · ${idx} · ${formatBytes((item.text ?? '').length)}`,
        text: item.text ?? '',
        raw,
      };
    default:
      return {
        title: item.partType ?? 'part',
        meta: idx,
        text: '',
        raw,
      };
  }
}

/**
 * 렌더 항목 배열에서 '마지막 항목' 인스펙터 페이로드를 뽑는다(진입 기본 노출).
 * action-group 이면 그룹의 마지막 action 을 대상으로 한다. 비면 null.
 */
export function lastInspectablePayload(
  items: ChatRenderItem[],
  t: InspectorTFunc,
): InspectorPayload | null {
  if (items.length === 0) return null;
  const last = items[items.length - 1];
  if ((last as ActionGroup).kind === 'action-group') {
    const grp = last as ActionGroup;
    const action = grp.actions[grp.actions.length - 1];
    return action ? inspectorPayloadOf(action, t) : null;
  }
  return inspectorPayloadOf(last as ChatItem, t);
}
