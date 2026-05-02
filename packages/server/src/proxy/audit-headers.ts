/**
 * proxy 모듈 — 클라이언트/응답 헤더에서 감사 메타 추출 (v20)
 *
 * 책임:
 *  - 요청 헤더(클라이언트 측): user-agent, x-app, anthropic-beta, x-stainless-* (SDK 메타)
 *  - 응답 헤더(Anthropic 측): anthropic-organization-id, request-id (api_request_id의 msg_xxx와 별개의 req_xxx)
 *  - SDK 메타 4종을 단일 JSON 컬럼(client_meta_json)으로 묶어 정규화
 *
 * 외부 노출:
 *  - extractClientHeaders(req) : 요청 헤더에서 client_user_agent / client_app / anthropic_beta / client_meta_json 추출
 *  - extractResponseHeaders(res): 응답 헤더에서 anthropic_org_id / anthropic_request_id 추출
 *
 * 호출자: handler.ts (요청 진입 시 / 응답 도착 후 createProxyRequest 직전)
 * 의존성: 없음
 */

/**
 * 요청 헤더에서 클라이언트/요청 감사 메타 추출.
 *
 * @returns DB의 proxy_requests.client_* 및 anthropic_beta 컬럼에 그대로 들어갈 값들
 */
export function extractClientHeaders(req: Request): {
  clientUserAgent: string | null;
  clientApp: string | null;
  anthropicBeta: string | null;
  clientMeta: string | null;
} {
  const clientUserAgent = req.headers.get('user-agent') || null;
  const clientApp = req.headers.get('x-app') || null;
  const anthropicBeta = req.headers.get('anthropic-beta') || null;

  const sdkPackageVersion = req.headers.get('x-stainless-package-version') || null;
  const sdkRuntime = req.headers.get('x-stainless-runtime') || null;
  const sdkRuntimeVersion = req.headers.get('x-stainless-runtime-version') || null;
  const sdkOs = req.headers.get('x-stainless-os') || null;
  const sdkArch = req.headers.get('x-stainless-arch') || null;

  // SDK 메타 4종을 한 JSON으로 정규화 (4개의 별도 컬럼보다 효율적, 공통적으로 함께 활용)
  const clientMeta = (sdkPackageVersion || sdkRuntime || sdkOs || sdkArch)
    ? JSON.stringify({
        package_version: sdkPackageVersion,
        runtime: sdkRuntime,
        runtime_version: sdkRuntimeVersion,
        os: sdkOs,
        arch: sdkArch,
      })
    : null;

  return { clientUserAgent, clientApp, anthropicBeta, clientMeta };
}

/**
 * 응답 헤더에서 Anthropic 측 감사 메타 추출.
 *
 * - anthropic_request_id: 응답 헤더의 `request-id` (req_xxx). state.apiRequestId(msg_xxx)와 별개.
 *   양쪽 모두 저장하면 OAuth/billing 추적과 메시지 추적을 분리해서 할 수 있음.
 */
export function extractResponseHeaders(response: Response): {
  anthropicOrgId: string | null;
  anthropicRequestId: string | null;
} {
  return {
    anthropicOrgId: response.headers.get('anthropic-organization-id') || null,
    anthropicRequestId:
      response.headers.get('request-id') || response.headers.get('x-request-id') || null,
  };
}
