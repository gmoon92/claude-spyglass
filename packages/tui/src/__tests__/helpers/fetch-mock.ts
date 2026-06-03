/**
 * fetch-mock.ts — 특성화 테스트 전용 globalThis.fetch 수작업 mock 헬퍼.
 *
 * 소스 변경 없음. hooks(useSessionTurns/useStripStats/useProxyRequests)는
 * 전역 fetch 를 직접 호출하므로, 새 의존성(msw/nock) 없이 globalThis.fetch 를
 * 교체했다가 afterEach 에서 반드시 원복한다.
 *
 * 사용 패턴:
 *   const fm = new FetchMock();
 *   afterEach(() => fm.restore());
 *   fm.route('/api/sessions/s1/turns', { ok: true, json: { success: true, data: [...] } });
 *   ...
 *
 * route 미등록 URL 은 기본 404 응답(또는 onUnmatched 콜백)으로 처리한다.
 */

/** 한 URL 매칭에 대한 응답 스펙. */
export type RouteSpec = {
  /** HTTP status (기본 200). ok 는 status<400 로 자동 계산되며 명시 시 우선. */
  status?: number;
  ok?: boolean;
  /** res.json() 이 resolve 할 값. */
  json?: unknown;
  /** json 대신 throw 를 시뮬레이트(JSON parse 에러 등). */
  jsonThrows?: boolean;
  /** fetch 자체가 reject 하도록(network error). */
  reject?: Error;
};

type Matcher = (url: string) => boolean;

type Route = { match: Matcher; spec: RouteSpec };

/** url 문자열 또는 substring 으로 매처를 만든다. */
function toMatcher(pattern: string | RegExp): Matcher {
  if (pattern instanceof RegExp) return (url) => pattern.test(url);
  return (url) => url.includes(pattern);
}

/** RouteSpec → 가짜 Response 객체. */
function toResponse(spec: RouteSpec): Response {
  const status = spec.status ?? 200;
  const ok = spec.ok ?? status < 400;
  return {
    ok,
    status,
    json: async () => {
      if (spec.jsonThrows) throw new SyntaxError('Unexpected token in JSON');
      return spec.json;
    },
  } as unknown as Response;
}

export class FetchMock {
  private readonly original: typeof globalThis.fetch;
  private routes: Route[] = [];
  /** 매칭 안 된 요청 처리(기본 404). */
  private unmatched: RouteSpec = { status: 404, ok: false, json: {} };
  /** 호출된 URL 기록 — 중복 방지/호출 횟수 검증용. */
  public calls: string[] = [];

  constructor() {
    this.original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      this.calls.push(url);
      const route = this.routes.find((r) => r.match(url));
      const spec = route?.spec ?? this.unmatched;
      if (spec.reject) throw spec.reject;
      return toResponse(spec);
    }) as typeof globalThis.fetch;
  }

  /** URL(substring/RegExp) → 응답 등록. 동일 패턴 재등록 시 마지막 것이 우선. */
  route(pattern: string | RegExp, spec: RouteSpec): this {
    this.routes.unshift({ match: toMatcher(pattern), spec });
    return this;
  }

  /** 매칭 안 된 요청 기본 응답 변경. */
  setUnmatched(spec: RouteSpec): this {
    this.unmatched = spec;
    return this;
  }

  /** 특정 substring 을 포함한 호출 횟수. */
  callCount(substr: string): number {
    return this.calls.filter((u) => u.includes(substr)).length;
  }

  /** 전역 fetch 원복 — afterEach 에서 반드시 호출. */
  restore(): void {
    globalThis.fetch = this.original;
  }
}

/** React effect 의 async fetch + setState 가 해소되도록 짧게 대기한다. */
export async function flushAsync(ms = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
