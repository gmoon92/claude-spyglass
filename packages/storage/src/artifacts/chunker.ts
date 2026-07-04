/**
 * chunker — conversation payload를 CAS 청크로 분해/재조립하는 공용 모듈 (CAS Phase 2)
 *
 * @description
 *   Anthropic /messages 요청 본문(proxy_requests.payload)은 append 구조라, 매 요청이
 *   직전까지의 system·messages·tools를 통째로 다시 담는다. 그래서 payload를 통짜로 해시하면
 *   dedup이 0%지만, system / 각 message / 각 tool 정의를 **블록 단위**로 쪼개면 대부분이
 *   이전 요청과 중복이다(dev 실측 95.2%). 이 모듈은 그 "블록 경계"를 재조립 가능한 형태로
 *   정의한다.
 *
 *   ┌─ 측정용 청킹(profiler)과의 관계 — 단위가 다른 별개 모듈 ──────────────────┐
 *   │ profiler/collectors/chunk-dedup.ts 는 dedup '측정'이 목적이라 message의 content │
 *   │ 만 세분화해 이론적 상한(dev 95.2%)을 잰다. 반면 CAS는 저장→복원이 목적이라       │
 *   │ message '전체 객체'(role 등 포함)를 단위로 삼아야 재조립이 성립한다. 청킹 '단위'가  │
 *   │ 서로 달라(측정 세분 vs 재조립 단위) 로직을 공유하지 않는다 — 억지 공유는 측정값을  │
 *   │ 바꿔 findings 문서와 어긋나므로, 목적이 다른 두 모듈로 분리 유지한다.             │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 *   분해 규약 (splitConversation):
 *     chunks[0]       = envelope. 원본 top-level 객체에서 system·messages[]·tools[] 자리를
 *                       {"$spyref": N} placeholder로 치환한 골격 JSON. 나머지 키(model,
 *                       max_tokens, metadata 등)는 그대로 보존 → 재조립 완전성.
 *     chunks[1..]     = 각 블록(system 1개, messages 원소별, tools 원소별)을 JSON.stringify 한 값.
 *                       placeholder의 N은 이 chunks 배열의 인덱스를 가리킨다.
 *
 *   재조립 규약 (joinConversation): envelope의 placeholder를 해당 청크 값으로 되꽂아
 *     원본과 JSON semantic 동일한 문자열을 복원한다(키 위치까지 보존).
 *
 *   불변식: 청크 문자열·해시는 반드시 '평문' 기준(압축/암호화 이전). 동일 블록은 동일
 *     청크 문자열을 산출해야 dedup이 성립한다.
 *
 * @dependencies Bun.CryptoHasher (SHA-256)
 * @flow
 *   write: proxy/handler/inbound.ts → splitConversation → artifact-store.store(각 청크)
 *   read : queries/proxy-payload.ts → artifact-store.load(각 청크) → joinConversation
 */

/** envelope 안에서 청크를 가리키는 placeholder. 원본 payload에 등장할 일이 없는 예약 형태. */
interface ChunkRef {
  $spyref: number;
}

/** splitConversation 결과. chunks[0]은 항상 envelope, 이후가 블록. */
export interface SplitConversation {
  chunks: string[];
}

const SPYREF_KEY = '$spyref';

/** placeholder 판별 — {"$spyref": <number>} 형태인가. */
function isChunkRef(v: unknown): v is ChunkRef {
  return (
    v != null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)[SPYREF_KEY] === 'number'
  );
}

/**
 * 평문 bytes → SHA-256 hex(64자). CAS의 content address 계산 SSoT.
 * 반드시 '평문'(압축/암호화 이전)에 적용해야 dedup 불변식이 성립한다.
 */
export function sha256HexBytes(bytes: Uint8Array): string {
  const h = new Bun.CryptoHasher('sha256');
  h.update(bytes);
  return h.digest('hex');
}

/**
 * conversation payload(JSON 문자열)를 CAS 청크로 분해한다.
 *
 * @param text 원본 payload 평문(JSON)
 * @returns 분해 결과. 아래 경우 null(호출자는 통짜 저장으로 fallback):
 *          - JSON 파싱 실패
 *          - top-level이 객체가 아님(배열/스칼라 — /messages 본문 형태가 아님)
 */
export function splitConversation(text: string): SplitConversation | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const src = obj as Record<string, unknown>;
  const chunks: string[] = ['']; // seq0 자리 예약 — envelope는 마지막에 채운다.
  // envelope는 src의 얕은 복제에서 system/messages/tools만 placeholder로 치환.
  const envelope: Record<string, unknown> = { ...src };

  /** 블록 값을 chunks에 추가하고 그 인덱스를 가리키는 placeholder를 반환. */
  const pushChunk = (value: unknown): ChunkRef => {
    const seq = chunks.length;
    chunks.push(JSON.stringify(value));
    return { [SPYREF_KEY]: seq } as ChunkRef;
  };

  if (src.system != null) {
    envelope.system = pushChunk(src.system);
  }
  if (Array.isArray(src.messages)) {
    envelope.messages = src.messages.map((m) => pushChunk(m));
  }
  if (Array.isArray(src.tools)) {
    envelope.tools = src.tools.map((t) => pushChunk(t));
  }

  chunks[0] = JSON.stringify(envelope);
  return { chunks };
}

/**
 * splitConversation으로 분해한 청크들을 원본 payload 문자열로 재조립한다.
 *
 * @param chunkTexts chunks[0]=envelope, 이후 블록. splitConversation 산출과 동일 순서.
 * @returns 원본과 JSON semantic 동일한 payload 문자열
 * @throws envelope 파싱 실패 또는 placeholder가 가리키는 청크 부재 시(데이터 손상 — 호출자 graceful 처리)
 */
export function joinConversation(chunkTexts: string[]): string {
  if (chunkTexts.length === 0) throw new Error('joinConversation: empty chunks');
  const envelope = JSON.parse(chunkTexts[0]) as Record<string, unknown>;

  /** placeholder → 실제 청크 값(JSON.parse). 인덱스 검증 포함. */
  const resolve = (ref: ChunkRef): unknown => {
    const seq = ref[SPYREF_KEY];
    if (seq < 1 || seq >= chunkTexts.length) {
      throw new Error(`joinConversation: chunk ref ${seq} out of range`);
    }
    return JSON.parse(chunkTexts[seq]);
  };

  if (isChunkRef(envelope.system)) {
    envelope.system = resolve(envelope.system);
  }
  if (Array.isArray(envelope.messages)) {
    envelope.messages = envelope.messages.map((m) => (isChunkRef(m) ? resolve(m) : m));
  }
  if (Array.isArray(envelope.tools)) {
    envelope.tools = envelope.tools.map((t) => (isChunkRef(t) ? resolve(t) : t));
  }

  return JSON.stringify(envelope);
}
