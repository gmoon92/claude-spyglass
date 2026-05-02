/**
 * proxy 모듈 — upstream 라우팅 + 포워딩 헤더
 *
 * 책임:
 *  - request body의 model에 따라 어느 외부 API로 포워딩할지 결정 (Anthropic / Moonshot / 커스텀)
 *  - 클라이언트 → upstream 포워딩 시 hop-by-hop 헤더 제거
 *
 * 환경변수:
 *  - ANTHROPIC_UPSTREAM_URL: 기본 Anthropic 대상 (기본 https://api.anthropic.com)
 *  - MOONSHOT_UPSTREAM_URL : kimi-* 모델용 (기본 https://api.moonshot.ai/anthropic)
 *  - CUSTOM_UPSTREAMS      : "prefix1=url1,prefix2=url2" 형식의 추가 매핑
 *  - SPYGLASS_PROXY_DEBUG  : '1'이면 forward 헤더 stdout 출력
 *
 * 외부 노출 (proxy 내부 전용):
 *  - selectUpstreamUrl(model) : 모델 prefix → upstream URL
 *  - buildForwardHeaders(req) : hop-by-hop 제거된 헤더 생성
 *  - UPSTREAM_URL             : 기본값 (handler에서 비교용)
 *
 * 의존성: 없음
 */

export const UPSTREAM_URL = (
  process.env.ANTHROPIC_UPSTREAM_URL || 'https://api.anthropic.com'
).replace(/\/$/, '');

const DEBUG_VERBOSE = process.env.SPYGLASS_PROXY_DEBUG === '1';

/**
 * 모델 prefix → 커스텀 upstream URL 매핑.
 * 첫 매칭 prefix를 사용. 매칭 없으면 UPSTREAM_URL.
 */
const CUSTOM_UPSTREAMS: Array<{ prefix: string; url: string }> = [
  {
    prefix: 'kimi-',
    url: (process.env.MOONSHOT_UPSTREAM_URL || 'https://api.moonshot.ai/anthropic').replace(/\/$/, ''),
  },
  ...(process.env.CUSTOM_UPSTREAMS || '')
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [prefix, url] = entry.split('=');
      return { prefix: prefix.trim(), url: url?.trim() || '' };
    })
    .filter((e) => e.prefix && e.url),
];

/**
 * model 이름의 prefix가 매칭되는 첫 커스텀 upstream URL을 반환.
 * 매칭 없거나 model이 null이면 기본 UPSTREAM_URL.
 */
export function selectUpstreamUrl(model: string | null): string {
  if (model) {
    for (const { prefix, url } of CUSTOM_UPSTREAMS) {
      if (model.startsWith(prefix)) return url;
    }
  }
  return UPSTREAM_URL;
}

/**
 * RFC 7230 hop-by-hop 헤더 — proxy가 통과시키지 말아야 할 헤더 목록.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * 클라이언트 요청 헤더에서 hop-by-hop을 제거한 forwarding용 헤더를 생성.
 */
export function buildForwardHeaders(req: Request): Headers {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  if (DEBUG_VERBOSE) {
    const obj: Record<string, string> = {};
    headers.forEach((v, k) => { obj[k] = v; });
    console.log('[PROXY] Request headers:', obj);
  }
  return headers;
}
