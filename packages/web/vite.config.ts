import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// P1-01: Vite + React 18 빌드 파이프라인 스캐폴딩 (인프라 추가 전용).
// - 기존 Vanilla 자산(assets/js/*.js)·index.html(buildless ESM 엔트리)은 무수정 병존.
// - build 진입은 React 전용 엔트리(index.react.html)로 한정해, vite build 가
//   vanilla index.html/main.js 모놀리식 그래프를 번들링하지 않도록 격리한다
//   (기존 코드 변환 금지 / 진입 전환은 P4-07 소관).
// - 데몬(9999) 정적 서빙 계약 정합(WEB_ROOT→dist, locales dist 복사, mimeMap 확장,
//   SPA fallback)은 P1-02 서빙 계약 결정에서 확정한다. 본 설정은 dev proxy + dist 산출만.
const DAEMON_TARGET = 'http://127.0.0.1:9999';

// dispatch.ts 의 정적/REST/SSE 라우팅 prefix 와 1:1 정합.
// 근거: dispatch.ts:56(/v1)·61(/collect)·69(/events)·77(/api)·82(/health)·152(/locales).
const PROXY_PREFIXES = ['/api', '/events', '/collect', '/v1', '/health', '/locales'] as const;

const proxy = Object.fromEntries(
  PROXY_PREFIXES.map((prefix) => [
    prefix,
    {
      target: DAEMON_TARGET,
      changeOrigin: true,
      // SSE(/events, text/event-stream) 스트리밍 패스스루 유지.
      // http-proxy 는 기본적으로 응답을 버퍼링하지 않고 스트림을 그대로 흘려보내므로
      // EventSource 핸드셰이크/재연결이 보존된다. WebSocket 아님 → ws:false.
      ws: false,
    },
  ])
);

export default defineConfig({
  plugins: [react()],
  base: '/',
  // 데몬 dispatch 가 /assets/ prefix 로만 정적 파일을 찾으므로(dispatch.ts:135)
  // 산출 자산 디렉토리를 'assets' 로 고정해 URL 계약을 유지한다.
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // React 전용 엔트리만 빌드. 기존 index.html(vanilla)은 P4-07 까지 무수정 병존.
      input: resolve(__dirname, 'index.react.html'),
    },
  },
  server: {
    port: 5173,
    proxy,
  },
});
