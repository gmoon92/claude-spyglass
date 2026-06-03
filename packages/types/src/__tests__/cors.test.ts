/**
 * cors.test.ts — CORS SSoT 단위 테스트.
 *
 * @description
 *   `Access-Control-Allow-Origin: '*'` 전면 제거 후의 새 동작을 단언한다:
 *     - 허용: localhost 계열(포트·스킴 무관) + env allowlist(정확 일치)
 *     - 허용 시 origin echo + Vary: Origin
 *     - Origin 부재·비허용 → CORS 헤더 미부여(차단은 하지 않음)
 *     - preflight(OPTIONS) 204 + 허용 시 Methods/Headers 동봉
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  resolveAllowedOrigin,
  corsHeaders,
  corsHeadersForOrigin,
  withCorsHeaders,
  applyCorsHeaders,
  preflightResponse,
} from '../cors';

const ENV_KEY = 'SPYGLASS_CORS_ORIGINS';

afterEach(() => {
  delete process.env[ENV_KEY];
});

function reqWithOrigin(origin: string | null): Request {
  const headers: Record<string, string> = {};
  if (origin !== null) headers['Origin'] = origin;
  return new Request('http://localhost/api/x', { headers });
}

// =============================================================================
// resolveAllowedOrigin — 판단 SSoT
// =============================================================================

describe('resolveAllowedOrigin — localhost 계열', () => {
  it('http://localhost:포트 (포트 무관) 허용', () => {
    expect(resolveAllowedOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(resolveAllowedOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(resolveAllowedOrigin('http://localhost')).toBe('http://localhost');
  });

  it('http://127.0.0.1:포트 허용', () => {
    expect(resolveAllowedOrigin('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(resolveAllowedOrigin('http://127.0.0.1')).toBe('http://127.0.0.1');
  });

  it('IPv6 루프백 http://[::1]:포트 허용', () => {
    expect(resolveAllowedOrigin('http://[::1]:3000')).toBe('http://[::1]:3000');
    expect(resolveAllowedOrigin('http://[::1]')).toBe('http://[::1]');
  });

  it('https localhost 도 허용 (스킴 무관)', () => {
    expect(resolveAllowedOrigin('https://localhost:3000')).toBe('https://localhost:3000');
  });
});

describe('resolveAllowedOrigin — 비허용/엣지', () => {
  it('외부 origin 은 비허용(null)', () => {
    expect(resolveAllowedOrigin('https://evil.example.com')).toBeNull();
    expect(resolveAllowedOrigin('http://attacker.io:3000')).toBeNull();
  });

  it('localhost 를 부분 문자열로 위장한 도메인은 비허용', () => {
    expect(resolveAllowedOrigin('http://localhost.evil.com')).toBeNull();
    expect(resolveAllowedOrigin('http://127.0.0.1.evil.com')).toBeNull();
  });

  it('Origin 헤더 부재(null/undefined/빈문자열) → null', () => {
    expect(resolveAllowedOrigin(null)).toBeNull();
    expect(resolveAllowedOrigin(undefined)).toBeNull();
    expect(resolveAllowedOrigin('')).toBeNull();
  });

  it('파싱 불가 문자열 → null', () => {
    expect(resolveAllowedOrigin('not-a-url')).toBeNull();
  });
});

describe('resolveAllowedOrigin — env allowlist (SPYGLASS_CORS_ORIGINS)', () => {
  it('콤마 구분 정확 일치 허용', () => {
    process.env[ENV_KEY] = 'https://app.example.com, https://dash.example.com';
    expect(resolveAllowedOrigin('https://app.example.com')).toBe('https://app.example.com');
    expect(resolveAllowedOrigin('https://dash.example.com')).toBe('https://dash.example.com');
  });

  it('allowlist 에 없는 origin 은 여전히 비허용', () => {
    process.env[ENV_KEY] = 'https://app.example.com';
    expect(resolveAllowedOrigin('https://other.example.com')).toBeNull();
  });

  it('후행 슬래시는 정규화하여 일치', () => {
    process.env[ENV_KEY] = 'https://app.example.com/';
    expect(resolveAllowedOrigin('https://app.example.com')).toBe('https://app.example.com');
  });

  it('env 미설정 시 외부 origin 은 비허용', () => {
    expect(resolveAllowedOrigin('https://app.example.com')).toBeNull();
  });
});

// =============================================================================
// corsHeaders / corsHeadersForOrigin — 헤더 생성
// =============================================================================

describe('corsHeaders — 허용 시 echo + Vary', () => {
  it('허용 origin → Allow-Origin echo + Vary: Origin', () => {
    const h = corsHeaders(reqWithOrigin('http://localhost:3000'));
    expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    expect(h['Vary']).toBe('Origin');
  });

  it('와일드카드(*) 는 절대 반환하지 않는다', () => {
    const h = corsHeaders(reqWithOrigin('http://localhost:3000'));
    expect(h['Access-Control-Allow-Origin']).not.toBe('*');
  });
});

describe('corsHeaders — 비허용/부재 시 빈 객체', () => {
  it('Origin 부재 → 빈 객체 (헤더 미부여)', () => {
    expect(corsHeaders(reqWithOrigin(null))).toEqual({});
  });

  it('비허용 origin → 빈 객체 (헤더 미부여, 차단 아님)', () => {
    expect(corsHeaders(reqWithOrigin('https://evil.example.com'))).toEqual({});
  });
});

describe('corsHeadersForOrigin — Request 없이 origin 문자열로', () => {
  it('판단은 resolveAllowedOrigin 과 동일', () => {
    expect(corsHeadersForOrigin('http://127.0.0.1:9999')['Access-Control-Allow-Origin'])
      .toBe('http://127.0.0.1:9999');
    expect(corsHeadersForOrigin('https://evil.example.com')).toEqual({});
    expect(corsHeadersForOrigin(null)).toEqual({});
  });
});

// =============================================================================
// withCorsHeaders / applyCorsHeaders — 병합 헬퍼
// =============================================================================

describe('withCorsHeaders — base 헤더 병합', () => {
  it('base 헤더 보존 + 허용 시 CORS 추가', () => {
    const h = withCorsHeaders(
      { 'Content-Type': 'application/json' },
      reqWithOrigin('http://localhost:3000'),
    );
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
  });

  it('비허용 시 base 만 유지', () => {
    const h = withCorsHeaders(
      { 'Content-Type': 'application/json' },
      reqWithOrigin('https://evil.example.com'),
    );
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('applyCorsHeaders — Headers in-place', () => {
  it('허용 시 Headers 에 CORS set', () => {
    const headers = new Headers({ 'X-Test': '1' });
    applyCorsHeaders(headers, reqWithOrigin('http://localhost:3000'));
    expect(headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(headers.get('Vary')).toBe('Origin');
    expect(headers.get('X-Test')).toBe('1');
  });

  it('비허용 시 CORS 헤더 미부여', () => {
    const headers = new Headers();
    applyCorsHeaders(headers, reqWithOrigin('https://evil.example.com'));
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

// =============================================================================
// preflightResponse — OPTIONS 204
// =============================================================================

describe('preflightResponse', () => {
  it('허용 origin → 204 + Allow-Origin/Methods/Headers', () => {
    const res = preflightResponse(reqWithOrigin('http://localhost:3000'));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('비허용/부재 origin → 204 + CORS 헤더 없음', () => {
    const res = preflightResponse(reqWithOrigin('https://evil.example.com'));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull();
  });
});
