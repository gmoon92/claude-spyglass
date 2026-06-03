/**
 * cors.ts — CORS origin 허용 판단 + 응답 헤더 생성 SSoT.
 *
 * @description
 *   기존에 7개 파일 10곳에 흩어져 있던 `Access-Control-Allow-Origin: '*'`
 *   하드코딩을 단일 모듈로 통합한다 (보안: 와일드카드 제거).
 *
 *   설계 원칙 (CLAUDE.md "동일 판단 로직은 한 곳에만"):
 *     - origin 허용 여부 판단과 CORS 헤더 생성을 이 모듈 안에서만 수행한다.
 *     - 호출 측은 raw `Request`(또는 Origin 헤더 문자열)만 넘기고, 허용/비허용
 *       판단은 절대 호출 측에서 재계산하지 않는다.
 *
 *   위치 근거 (패키지 의존 방향 types→storage→{metrics,...}→server):
 *     CORS 판단은 storage 의존이 전혀 없는 순수 런타임 로직이고, 이를 소비하는
 *     `metrics`(rank 2)·`server`(rank 3) 양쪽에서 import 가능해야 한다. 두 패키지가
 *     공통으로 import 할 수 있는 가장 낮은 rank 는 `types`(rank 0)뿐이다.
 *     (rank 1 storage 는 CORS 와 무관한 책임이라 부적합.) types 는 이미 i18n.ts 가
 *     런타임 함수를 export 하는 선례가 있어 "타입만" 패키지가 아니다.
 *
 *   동작:
 *     - 기본 허용 origin = localhost 계열 (http://localhost:*, http://127.0.0.1:*,
 *       http://[::1]:* — 포트 무관, http/https 무관).
 *     - 추가 allowlist 는 env `SPYGLASS_CORS_ORIGINS` (콤마 구분, 정확 일치).
 *     - 허용 origin → 그 origin 을 echo + `Vary: Origin`.
 *     - Origin 헤더 없는 요청(curl·동일 출처 server-side fetch 등) → CORS 헤더 미부여.
 *       (요청 자체는 차단하지 않는다 — 기존 동작 회귀 방지.)
 *     - 비허용 origin → CORS 헤더 미부여 (요청 차단은 하지 않음).
 */

/** 허용 메서드/헤더 — preflight 와 실제 응답에서 공통 사용. */
const ALLOW_METHODS = 'GET, POST, OPTIONS';
const ALLOW_HEADERS = 'Content-Type';

/** localhost 계열 host (포트 제외) 화이트리스트. */
const LOCALHOST_HOSTS = new Set<string>(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * env `SPYGLASS_CORS_ORIGINS` 를 파싱해 정규화된 origin 집합으로 반환.
 * 콤마 구분, 각 항목 trim, 빈 항목 제거, 후행 슬래시 제거.
 * 매 호출마다 env 를 읽어 테스트에서 env 주입이 즉시 반영되도록 한다.
 */
function configuredAllowlist(): Set<string> {
  const raw = process.env.SPYGLASS_CORS_ORIGINS;
  if (!raw) return new Set();
  const out = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim().replace(/\/+$/, '');
    if (trimmed) out.add(trimmed);
  }
  return out;
}

/**
 * origin 문자열이 localhost 계열인지 판정 (포트·스킴 무관).
 * 잘못된 형식(파싱 불가)이면 false.
 */
function isLocalhostOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // URL.hostname 은 IPv6 의 대괄호를 벗긴 '::1' 형태를 준다.
  return LOCALHOST_HOSTS.has(url.hostname) || LOCALHOST_HOSTS.has(`[${url.hostname}]`);
}

/**
 * 주어진 Origin 헤더 값이 허용되는지 판단 (SSoT).
 * @param origin Request 의 Origin 헤더 값 (없으면 null/undefined).
 * @returns 허용되면 정규화 없이 그대로 echo 할 origin, 아니면 null.
 */
export function resolveAllowedOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  if (isLocalhostOrigin(origin)) return origin;
  // env allowlist 는 정확 일치 (후행 슬래시만 정규화).
  const normalized = origin.replace(/\/+$/, '');
  if (configuredAllowlist().has(normalized)) return origin;
  return null;
}

/**
 * Request → 병합할 CORS 응답 헤더 맵.
 * 허용 origin 이면 `Access-Control-Allow-Origin`(echo) + `Vary: Origin`,
 * 아니면(Origin 없음·비허용) 빈 객체.
 *
 * 호출 측은 이 맵을 응답 헤더에 펼쳐(spread/merge) 넣기만 하면 된다 —
 * 허용 판단은 전적으로 이 함수 내부 책임.
 */
export function corsHeaders(req: Request): Record<string, string> {
  return corsHeadersForOrigin(req.headers.get('origin'));
}

/**
 * Origin 헤더 문자열만 가진 경우의 변형 (Request 객체가 없을 때).
 * 판단 로직은 corsHeaders 와 동일하게 resolveAllowedOrigin 을 단일 경유.
 */
export function corsHeadersForOrigin(origin: string | null | undefined): Record<string, string> {
  const allowed = resolveAllowedOrigin(origin);
  if (!allowed) return {};
  return {
    'Access-Control-Allow-Origin': allowed,
    'Vary': 'Origin',
  };
}

/**
 * 기존 헤더 맵에 CORS 헤더를 병합한 새 맵을 반환 (호출 측 편의).
 * Content-Type 등 기본 헤더 + CORS 를 한 줄로 합치는 용도.
 */
export function withCorsHeaders(
  base: Record<string, string>,
  req: Request,
): Record<string, string> {
  return { ...base, ...corsHeaders(req) };
}

/**
 * Headers 인스턴스에 CORS 헤더를 in-place 로 적용 (proxy 응답 헤더처럼
 * Headers 객체를 직접 다루는 경로용).
 */
export function applyCorsHeaders(headers: Headers, req: Request): void {
  const cors = corsHeaders(req);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
}

/**
 * OPTIONS preflight 응답 (204). 허용 origin 일 때만 CORS 헤더를 부여하고,
 * Methods/Headers 도 함께 내려준다. 비허용·Origin 부재 시 헤더 없는 204.
 */
export function preflightResponse(req: Request): Response {
  const cors = corsHeaders(req);
  const headers: Record<string, string> = { ...cors };
  if (cors['Access-Control-Allow-Origin']) {
    headers['Access-Control-Allow-Methods'] = ALLOW_METHODS;
    headers['Access-Control-Allow-Headers'] = ALLOW_HEADERS;
  }
  return new Response(null, { status: 204, headers });
}
