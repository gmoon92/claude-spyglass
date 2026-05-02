/**
 * proxy 모듈 — system 본문 정규화 + SHA-256 hash 계산 (v22 / system-prompt-exposure ADR-002)
 *
 * 책임:
 *  - LLM 요청의 `body.system`(string 또는 [{type:'text',text,cache_control?}] 배열)을
 *    결정적 문자열로 정규화한 뒤 SHA-256 hex hash를 만든다.
 *  - 같은 system 페르소나가 들어오면 항상 동일 hash가 반환되어야 한다 (dedup 키 안정성).
 *  - billing-header(매 요청 변동) / cache_control(메타) / 공백 차이를 hash 입력에서 제거.
 *
 * 정규화 규칙 (ADR-002):
 *  1. system === null/undefined            → null 반환
 *  2. typeof system === 'string'           → texts = [system]
 *  3. Array.isArray(system) 인 경우 각 항목에 대해:
 *     - item.type !== 'text'                            → skip (cache_control 등 메타 무시)
 *     - typeof item.text !== 'string'                   → skip
 *     - item.text.startsWith('x-anthropic-billing-header:') → skip (idx 무관, prefix 매칭)
 *     - 그 외                                            → texts.push(item.text)
 *  4. texts.length === 0 → null 반환
 *  5. normalized = texts.join('\n\n')      (블록 순서 유지)
 *  6. BOM(﻿) 제거 + CRLF → LF 변환    (HTTP 전송 환경 차이 흡수)
 *  7. hash = SHA-256(utf8(normalized)).hex
 *
 * 외부 노출:
 *  - normalizeSystem(system: unknown): NormalizedSystem | null
 *
 * 호출자: proxy/request-parser.ts (요청 본문 파싱 단계)
 *
 * 의존성: node:crypto (SHA-256)
 *
 * 모듈 경계 (ADR-007 — v21 system_reminder ⊥ v22 system_hash):
 *  - 본 모듈은 `body.system` 본문 정규화만 책임진다.
 *  - user 메시지 안의 `<system-reminder>` 블록 추출은 v21 `extractSystemReminders`에 잔존.
 *  - 두 함수는 같은 파일에서 import 순환을 만들지 않는다.
 */

import { createHash } from 'node:crypto';

/**
 * 정규화된 system 본문 + 해시 + 메타.
 * upsertSystemPrompt(queries/system-prompt.ts)와 createProxyRequest 양쪽이 받는 형태.
 */
export interface NormalizedSystem {
  /** SHA-256(normalized) hex 64자. content-addressable PK. */
  hash: string;
  /** 정규화된 system 본문 (idx[0] billing-header 제외, idx[1]+ join). DB content 컬럼에 그대로 저장. */
  normalized: string;
  /** 정규화에 사용된 text 항목 수 (system_prompts.segment_count로 저장). */
  segmentCount: number;
  /** UTF-8 byte 길이 (system_prompts.byte_size + proxy_requests.system_byte_size). */
  byteSize: number;
}

/**
 * billing-header 식별 — text가 `x-anthropic-billing-header:` prefix로 시작하면 hash 입력에서 제거.
 * idx/길이 단독 판별은 미래 변경(SDK가 prefix 변경)에 취약하므로 prefix 매칭만 사용.
 */
function isBillingHeaderText(text: string): boolean {
  return text.startsWith('x-anthropic-billing-header:');
}

/**
 * UTF-8 byte 길이 — JS string은 UTF-16 기준이라 length로 byte 수 못 셈.
 * Node의 Buffer.byteLength가 표준이지만 Bun도 호환.
 */
function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * system 필드 정규화 + SHA-256 hash 계산.
 *
 * @param system  요청 본문의 body.system 필드 (string | array | null | undefined)
 * @returns NormalizedSystem 또는 정규화 결과가 비었을 때 null
 *
 * 예시:
 *   normalizeSystem("You are Claude.")
 *     → { hash: "...", normalized: "You are Claude.", segmentCount: 1, byteSize: 15 }
 *   normalizeSystem([
 *     { type: 'text', text: 'x-anthropic-billing-header: cch=abc' },
 *     { type: 'text', text: 'You are Claude.', cache_control: {...} },
 *   ])
 *     → billing-header 제외 후 ['You are Claude.']만 정규화 → 같은 hash 반환
 */
export function normalizeSystem(system: unknown): NormalizedSystem | null {
  if (system === null || system === undefined) return null;

  // 정규화 후 결합할 텍스트 항목 수집
  let texts: string[];
  if (typeof system === 'string') {
    texts = [system];
  } else if (Array.isArray(system)) {
    texts = [];
    for (const item of system) {
      // cache_control 등 메타 객체는 통째로 제거 (text 필드만 대상)
      if (!item || typeof item !== 'object') continue;
      const obj = item as { type?: unknown; text?: unknown };
      if (obj.type !== 'text') continue;
      if (typeof obj.text !== 'string') continue;
      if (isBillingHeaderText(obj.text)) continue;
      texts.push(obj.text);
    }
  } else {
    return null;
  }

  if (texts.length === 0) return null;

  // 결정적 구분자로 결합 + 환경 차이 흡수 (BOM/CRLF). 본문 의미는 보존.
  let normalized = texts.join('\n\n');
  normalized = normalized.replace(/﻿/g, '').replace(/\r\n/g, '\n');

  const hash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  const byteSize = utf8ByteLength(normalized);

  return { hash, normalized, segmentCount: texts.length, byteSize };
}
