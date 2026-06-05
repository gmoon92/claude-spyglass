import { resolve } from 'node:path';
import { cpSync, existsSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// P4-10: 운영 진입 전환 — build input = index.html(#react-root) + 데몬 정적 자산 외부화 plugin.
// - 기존 Vanilla CSS 자산(assets/css/*.css)은 데몬(/assets/*)이 직접 서빙한다. Vite 번들 그래프에
//   끌어오지 않고 <head> 에 raw <link> 태그로 외부 주입한다(externalizeDaemonAssets). 이렇게 해야
//   index.html 소스는 FOUC/lang 인라인 + #react-root + module 진입만 유지하면서, dev(Vite 5173)·
//   build(dist) 양쪽에서 동일한 CSS24 가 로드된다.
//   (과거 classic i18n.js(window.I18n) 외부 주입은 react-i18next 단일화로 제거됐다 — i18n SSoT = lib/i18n.ts.)
// - locales 는 build 후 dist/locales 로 복사(F2, P1-02 §3) — WEB_ROOT→dist 시 /locales/* 정합.
// - 데몬(9999) 정적 서빙 계약(WEB_ROOT→dist, mimeMap .map, SPA fallback)은 dispatch.ts 에서 처리.
const DAEMON_TARGET = 'http://127.0.0.1:9999';

// dispatch.ts 의 정적/REST/SSE 라우팅 prefix 와 1:1 정합.
// 근거: dispatch.ts:56(/v1)·61(/collect)·69(/events)·77(/api)·82(/health)·152(/locales).
const PROXY_PREFIXES = ['/api', '/events', '/collect', '/v1', '/health', '/locales'] as const;

// 데몬(/assets/css/*)이 서빙하는 CSS 24종 — index.html 구 <head> link 순서를 SSoT 로 보존.
// cascade 순서가 시각에 영향(design-tokens 가 최선두) → 배열 순서 = 주입 순서 = 구 link 순서.
const DAEMON_CSS = [
  '/assets/css/design-tokens.css',
  '/assets/css/card.css',
  '/assets/css/state.css',
  '/assets/css/keyboard-help.css',
  '/assets/css/layout.css',
  '/assets/css/header.css',
  '/assets/css/left-panel.css',
  '/assets/css/default-view.css',
  '/assets/css/detail-view.css',
  '/assets/css/table.css',
  '/assets/css/badges.css',
  '/assets/css/skeleton.css',
  '/assets/css/cache-panel.css',
  '/assets/css/turn-view.css',
  '/assets/css/llm-input.css',
  '/assets/css/syslib.css',
  '/assets/css/meta-docs.css',
  '/assets/css/context-chart.css',
  '/assets/css/tool-stats.css',
  '/assets/css/flow-diagram.css',
  '/assets/css/obs-panel.css',
  '/assets/css/app-rail.css',
  '/assets/css/settings-view.css',
  '/assets/css/design-system/_index.css',
] as const;

/**
 * 데몬 정적 자산 외부화 — index.html 에 CSS24(head) 를 주입한다.
 *   - transformIndexHtml 은 dev/build 양쪽에서 발화 → 두 환경의 진입 HTML 이 동일.
 *   - closeBundle: build 후 locales → dist/locales 복사(F2) — dispatch /locales/* 분기 무수정 유지.
 *   - 과거 body-prepend 로 주입하던 classic i18n.js(window.I18n) 스크립트는 react-i18next 단일화로 제거됨.
 */
function externalizeDaemonAssets(): Plugin {
  return {
    name: 'spyglass-externalize-daemon-assets',
    transformIndexHtml() {
      return [
        ...DAEMON_CSS.map((href) => ({
          tag: 'link',
          attrs: { rel: 'stylesheet', href },
          injectTo: 'head' as const,
        })),
      ];
    },
    closeBundle() {
      // WEB_ROOT→dist 전환(dispatch.ts) 후 데몬이 dist/ 만 서빙하므로, 데몬-서빙 classic 자산을 dist 로 복사한다.
      //   - assets/{css,js} → dist/assets/{css,js}: index.html 이 외부 참조하는 CSS24 + classic i18n1(+의존 모듈).
      //     Vite 산출(dist/assets/index-<hash>.js·favicon)과 파일명이 겹치지 않아 recursive 병합이 안전.
      //   - locales → dist/locales (F2, P1-02 §3): /locales/* 분기 정합. dev 는 proxy 위임이라 불요.
      const copies: Array<[string, string]> = [
        // assets 는 이제 css 만 보유한다(과거 assets/js/i18n.js 는 react-i18next 단일화로 제거).
        [resolve(__dirname, 'assets'), resolve(__dirname, 'dist/assets')],
        [resolve(__dirname, 'locales'), resolve(__dirname, 'dist/locales')],
        // dispatch favicon 분기(/favicon.svg|ico)는 WEB_ROOT 루트에서 찾는다. 진입 HTML 의 <link> 는
        // Vite 가 해시 자산으로 재작성하지만, 하드코딩/레거시 /favicon.svg 요청 호환을 위해 루트에도 복사.
        [resolve(__dirname, 'favicon.svg'), resolve(__dirname, 'dist/favicon.svg')],
      ];
      // dist 는 운영 산출물 — __tests__/*.test/*.spec/*.d.ts 같은 비런타임 파일은 제외한다.
      // (제외하지 않으면 dist/assets/js/__tests__ 가 bun test packages/web/ 수집에 잡혀 테스트가 중복된다.)
      // P5-01: assets/js SSoT 가 .ts 로 전환됐다 — 이 소스 .ts/.tsx 는 Vite 가 이미 번들에 흡수하므로
      //   dist/assets/js 로 raw 복사하지 않는다(번들 흡수분과 중복·미서빙 소스 노출 방지). 데몬이 raw 로
      //   서빙하는 잔여 classic 자산은 i18n 3종(.js)뿐이며 .js 는 계속 복사 대상으로 남는다.
      const isCopyable = (p: string): boolean =>
        !/(^|[/\\])__tests__([/\\]|$)/.test(p) &&
        !/\.(test|spec)\.[cm]?[jt]sx?$/.test(p) &&
        !/\.d\.ts$/.test(p) &&
        !/\.tsx?$/.test(p);
      for (const [src, dest] of copies) {
        if (existsSync(src)) cpSync(src, dest, { recursive: true, filter: isCopyable });
      }
    },
  };
}

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
  plugins: [react(), externalizeDaemonAssets()],
  base: '/',
  // 데몬 dispatch 가 /assets/ prefix 로만 정적 파일을 찾으므로(dispatch.ts:135)
  // 산출 자산 디렉토리를 'assets' 로 고정해 URL 계약을 유지한다.
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    // 운영 빌드 소스맵 비활성(감사 §1) — 2MB+ .map 운영 노출 제거 + 빌드 산출 경량화.
    //   디버깅이 필요하면 환경변수로 일시 활성: SPYGLASS_SOURCEMAP=1 npm run build.
    sourcemap: process.env.SPYGLASS_SOURCEMAP === '1',
    rollupOptions: {
      // 운영 진입(P4-10): index.html(#react-root) 단일 엔트리. 구 index.react.html 은 P5-01 정리 대상.
      input: resolve(__dirname, 'index.html'),
      output: {
        // vendor 분리(감사 §1) — 변경 빈도 낮은 node_modules(react/router/zustand 등)를 별도 청크로
        //   격리해 앱 코드 변경 시 vendor 청크 캐시 히트를 유지(브라우저 재다운로드 감소).
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy,
  },
});
