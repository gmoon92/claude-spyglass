# build-infra 패널: Vite + Bun + React 18 빌드/인프라 명세

> 작성: build-infra 전문가 / 근거 HEAD `2126e11` (claude-spyglass) · bun 1.3.11 (실측), CI는 `1.2.x`
> 대안 C(풀 마이그레이션) 전제 — buildless ESM 정체성을 의도적으로 폐기하고 Vite 빌드 파이프라인 도입.
> 본 문서는 **개발 작업 문서**다. React 코드는 작성하지 않는다. 모든 주장에 `파일:라인` 근거를 붙였다.

---

## 0. 실측 현황 (근거 고정)

### 0-1. 현재 자산 서빙 모델 (buildless)

spyglass 데몬은 별도 정적 서버/미들웨어 없이 **`Bun.serve` 의 `fetch` 한 줄이 모든 라우팅을 처리**한다.

- 데몬 부팅: `Bun.serve({ port, hostname, fetch: (req) => handleRequest(req, db) })`
  근거: `packages/server/src/runtime/lifecycle.ts:150-153`
- 기본 포트 9999 / 호스트 127.0.0.1
  근거: `packages/server/src/runtime/config.ts:14`(`DEFAULT_PORT = 9999`), `:34`(PORT), `:35`(HOST `127.0.0.1`)
- 라우팅 디스패처: `handleRequest()` 가 path prefix 로 분기
  근거: `packages/server/src/runtime/dispatch.ts:38`
- 정적 자산 루트 결정:
  ```
  WEB_ROOT = process.env.SPYGLASS_WEB_ROOT ?? fileURLToPath(new URL('../../../web/', import.meta.url))
  ```
  근거: `dispatch.ts:26-28`. `webFile(subPath)` 가 `Bun.file(pathJoin(WEB_ROOT, subPath))` 로 파일을 연다 — 근거 `dispatch.ts:31-33`.

정적 서빙 분기는 dispatch.ts 의 4개 지점이다(근거 라인 포함):

| URL | 처리 | 근거 |
|-----|------|------|
| `/` (Accept != json) | `webFile('/index.html')` 반환, `text/html` | `dispatch.ts:99-127` |
| `/assets/*` | `webFile(safePath)`, ext별 mimeMap(js/css/svg/ico) | `dispatch.ts:134-150` |
| `/locales/*` | `webFile`, `application/json`, `Cache-Control: max-age=300` | `dispatch.ts:152-164` |
| `/favicon.svg`·`/favicon.ico` | `webFile`, svg/ico mime | `dispatch.ts:166-175` |

**중요 제약**: dispatch 의 자산 서빙은
- ① `js/css/svg/ico` 4개 확장자만 mime 매핑을 가진다(그 외 `application/octet-stream`) — `dispatch.ts:139-145`.
  Vite 산출물은 `.woff2`, `.map`, 해시 png 등 새 확장자를 만들 수 있으므로 **mimeMap 확장이 필수**.
- ② `/assets/` 프리픽스에 정확히 매칭되는 정적 파일만 반환하고, **SPA fallback(존재하지 않는 경로 → index.html)이 없다**. 현재 web 은 main.js 가 해시 라우팅이라 무관하나, React Router 도입 시 영향을 받는다(§4-4).
- ③ 캐시 헤더는 locales 에만 있다. 해시 파일명 자산에 `immutable` 캐시를 주는 최적화는 미적용 — Vite 도입 후 추가 여지(§5).

### 0-2. 현재 진입 자산 (index.html)

`packages/web/index.html` 은 980줄(`wc -l`)이며 **하나의 ESM 엔트리 + 3개 classic script** 로 부팅한다.

```
975: <script src="/assets/js/i18n.js"></script>          ← classic, window.I18n 노출
976: <script src="/assets/js/i18n-dom.js"></script>       ← classic
977: <script src="/assets/js/lang-switcher.js"></script>  ← classic
978: <script type="module" src="/assets/js/main.js"></script>  ← ESM 단일 엔트리
```
근거: `index.html:975-978`.

- `main.js` 는 30+개 모듈을 `import` 하는 단일 ESM 그래프의 루트다. 근거: `main.js:2-48` (chart.js, infra.js, app-rail.js, meta-docs-view.js, settings-view.js, renderers.js … 상대경로 `./*.js` import).
- `i18n.js` 는 **classic script** 로 `window.I18n = I18n` 전역을 노출한다 — 근거 `i18n.js:282`. 이 전역은 ESM 모듈들이 런타임에 참조하는 **암묵 의존**이다. → 마이그레이션 코엑시스턴스 설계의 핵심 제약(§4).
- CSS는 `<link>` 25개로 직접 cascade(`index.html:90-113`). FOUC 방지 인라인 스크립트가 `.app-ready` 클래스 + localStorage 선반영을 처리(`index.html:10-83`).

### 0-3. 타입 안전망 (R5)

- web `tsconfig.json`: `strict:false` + `checkJs:true` + `allowJs:true`, `moduleResolution:"bundler"`, lib `["ESNext","DOM","DOM.Iterable"]`, paths `@spyglass/types → ../types/src/index.ts`.
  근거: `packages/web/tsconfig.json:2-22`. include 는 `assets/js/**/*.js` + `*.d.ts`, exclude `__tests__`.
- typecheck 스크립트: `tsc --noEmit -p tsconfig.json` — `packages/web/package.json:8`.
- CI `web-typecheck` 잡은 **blocking**(continue-on-error 없음), `bun run --cwd packages/web typecheck` 실행.
  근거: `.github/workflows/test.yml:32-46`. setup-bun 은 `1.2.x` 고정(`:40`).

### 0-4. 운영(데스크톱) 패키징 경로

- Electron 메인이 packaged 모드에서 `SPYGLASS_WEB_ROOT = process.resourcesPath/app/web` 를 child(server bin)에 주입.
  근거: `packages/desktop/src/main/server-process.js:121`. dev 모드는 env 미주입, `import.meta.url` fallback(`server-process.js:95-96`, `:136-143`).
- 서버 바이너리는 `bun build --compile --minify --target=bun-darwin-<arch>` 산출물.
  근거: `packages/desktop/package.json` scripts `build:server-bin`.
- electron-builder 가 `../web` → `app/web` 로 복사하되 `__tests__`·`*.test.ts` 제외.
  근거: `packages/desktop/electron-builder.yml` extraResources `from: ../web / to: app/web / filter: ["**/*","!**/__tests__/**","!**/*.test.ts"]`.

**패키징 함의**: 현재는 `packages/web` 디렉토리 **전체를 그대로** 동봉한다(소스 JS 그 자체가 런타임 자산). Vite 도입 후에는 **`dist/` 만 동봉**해야 하므로 electron-builder `from`/`filter` 변경이 필수다(§3-3).

---

## 1. Vite + Bun + React 18 셋업 명세

### 1-1. 의존성 (packages/web/package.json 신규)

현재 `packages/web/package.json` 은 typecheck 스크립트 하나뿐이다(근거 `package.json` 전문). 다음을 추가한다.

| 구분 | 패키지 | 용도 |
|------|--------|------|
| dependencies | `react@^18`, `react-dom@^18` | 런타임 |
| dependencies | `zustand` | 전역 스토어(master prompt §페이즈1) |
| dependencies | `zod` | JSON 파싱 스키마 검증(master prompt §2-3) |
| dependencies | `react-router-dom@^6` | 라우팅(페이즈4) |
| devDependencies | `vite@^5`, `@vitejs/plugin-react` | 빌드/HMR |
| devDependencies | `typescript@^5` | 기존과 동일(루트 `^5.0.0`) |
| devDependencies | `@types/react`, `@types/react-dom` | 타입 |

- **러너는 Bun 유지**. 설치/스크립트 실행은 `bun install` / `bun run` / `bun test`. Vite 자체는 dev 서버/번들러로만 사용(러너 교체 아님). 근거: 루트 `package.json` workspaces·`"test":"bun test"`, bun engines `>=1.2.0`.
- Vite 는 내부적으로 esbuild/rollup 을 쓰므로 Bun 과 충돌 없음. dev 시 `bunx vite` 또는 `bun run dev` 로 기동.

### 1-2. 스크립트 (packages/web/package.json)

```jsonc
"scripts": {
  "dev":       "vite",                       // HMR 개발 서버 (기본 5173)
  "build":     "vite build",                 // → dist/
  "preview":   "vite preview",               // dist 검증
  "typecheck": "tsc --noEmit -p tsconfig.json"  // 기존 유지 (CI blocking)
}
```
- 운영 빌드 명령은 미션 요구대로 **`bun run build`**(= `vite build`).
- `typecheck` 는 R5 게이트 보존을 위해 **이름·동작 유지**. 단 include 글롭이 `.js`→`.ts/.tsx` 로 옮겨가는 동안 tsconfig include 를 동시 확장(§1-4).

### 1-3. vite.config.ts (신규, packages/web/)

핵심 옵션(추측 아닌, 위 서빙 모델에서 도출되는 제약 기반):

```ts
// packages/web/vite.config.ts  (신규)
export default defineConfig({
  plugins: [react()],
  // 데몬 dispatch 가 /assets/ prefix 로만 정적 파일을 찾으므로(dispatch.ts:135)
  // 산출 자산 디렉토리를 'assets' 로 고정해 URL 계약을 유지한다.
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',        // dist/assets/*.js|css → 기존 /assets/ 라우팅과 호환
    emptyOutDir: true,
    sourcemap: true,            // 운영 디버깅 (dispatch mimeMap 에 .map 추가 필요, §3-2)
  },
  server: {
    port: 5173,
    proxy: {
      // dev HMR 중 REST/SSE/collect 는 데몬(9999)로 프록시 (백엔드 무수정 전제)
      '/api':     { target: 'http://127.0.0.1:9999', changeOrigin: true },
      '/events':  { target: 'http://127.0.0.1:9999', changeOrigin: true },
      '/collect': { target: 'http://127.0.0.1:9999', changeOrigin: true },
      '/v1':      { target: 'http://127.0.0.1:9999', changeOrigin: true },
      '/health':  { target: 'http://127.0.0.1:9999', changeOrigin: true },
      '/locales': { target: 'http://127.0.0.1:9999', changeOrigin: true },
    },
  },
});
```

**도출 근거**:
- 프록시 대상 경로(`/api`,`/events`,`/collect`,`/v1`,`/health`,`/locales`)는 dispatch 분기 그대로다 — `dispatch.ts:56`(/v1), `:61`(/collect), `:69`(/events), `:77`(/api), `:82`(/health), `:152`(/locales). dev 서버는 이들을 9999 데몬으로 위임하고 React 앱만 5173 에서 HMR 한다.
- `/events` 의 **GET = SSE 스트림**(`dispatch.ts:69-74`, `sseRouter`). Vite proxy 는 SSE(text/event-stream) 패스스루를 지원하므로 별도 설정 불필요하나, 버퍼링 회피를 위해 `changeOrigin` 만 둔다. SSE 핸드셰이크 검증은 sse 패널 문서로 위임.
- `assetsDir:'assets'` 로 고정하는 이유: dispatch 의 정적 서빙이 **`/assets/` 프리픽스에 강결합**(`dispatch.ts:135`). dist 산출물이 `/assets/` 아래로 떨어지면 운영 데몬이 무수정에 가깝게 서빙 가능(§3).

### 1-4. tsconfig.json 변경 (packages/web/tsconfig.json)

현행(`tsconfig.json:2-22`)에서 **추가**할 항목:

```jsonc
{
  "compilerOptions": {
    // ... 기존 유지 ...
    "jsx": "react-jsx",            // React 18 자동 런타임 (import React 불필요)
    "moduleResolution": "bundler", // 이미 설정됨 (tsconfig.json:5) — Vite와 호환
    "types": ["vite/client"],      // import.meta.env, ?url 등 Vite 타입
    "strict": false                // 페이즈5까지 유지 (master prompt §페이즈5)
  },
  "include": [
    "assets/js/**/*.js",           // 구 Vanilla (병존 기간)
    "src/**/*.ts", "src/**/*.tsx", // 신 React
    "assets/js/**/*.d.ts", "vite.config.ts"
  ]
}
```
- `strict:false`·`checkJs:true` 는 **병존 기간 동안 유지**(R5 baseline 보존). `strict:true` 승격은 페이즈5에서 `.tsx` 전환 완료 후 — master prompt `:75-76`.
- include 에 구 `.js` 와 신 `.ts/.tsx` 를 **동시 포함**해 단일 typecheck 게이트가 둘 다 검증하게 한다(CI 무수정 — `test.yml:46` 그대로 동작).
- React 신규 코드는 `packages/web/src/` 에 둔다(구 `assets/js/` 와 디렉토리 분리 → 병존 중 충돌·혼동 방지).

---

## 2. 2-모드 분기 통합 (dev HMR vs 운영 dist)

미션 핵심: spyglass 데몬이 정적 자산을 직접 서빙하므로 **개발(Vite HMR)과 운영(데몬이 dist 서빙)을 한 코드베이스로 통합**해야 한다.

### 2-1. 모드 정의

| 모드 | 자산 출처 | 서버 | 비고 |
|------|-----------|------|------|
| **dev** | `vite dev`(5173) HMR | 데몬(9999)은 API/SSE만, 정적은 Vite | `bun run --cwd packages/web dev` + `bun run dev`(데몬) 동시 기동 |
| **운영(local daemon)** | `packages/web/dist/`(빌드 산출) | 데몬(9999)이 dist 를 직접 서빙 | `bun run --cwd packages/web build` 후 데몬 restart |
| **운영(packaged desktop)** | `app/web/dist`(동봉) | standalone bin | `SPYGLASS_WEB_ROOT` 주입 |

### 2-2. 데몬이 dist 를 서빙하도록 하는 변경점 (dispatch.ts)

현재 `WEB_ROOT` 는 `packages/web/` 를 직접 가리키고 `webFile('/index.html')`·`/assets/*` 를 그 아래에서 찾는다(`dispatch.ts:26-33`, `:122`, `:135-137`). Vite 도입 후 산출물은 `packages/web/dist/` 아래에 생긴다. 두 통합 방식 중 **방식 A 권장**.

**방식 A — WEB_ROOT 를 dist 로 이동 (최소 변경, 권장)**
- `WEB_ROOT` fallback 을 `../../../web/` → `../../../web/dist/` 로 바꾼다.
  변경점: `dispatch.ts:28` 의 `new URL('../../../web/', import.meta.url)` → `'../../../web/dist/'`.
- packaged 주입도 `app/web` → `app/web/dist` 로 변경(또는 electron-builder 가 dist 만 `app/web` 으로 복사 — §3-3).
- 장점: dispatch 의 나머지 분기(index.html, /assets, /locales, favicon)는 **URL 계약이 그대로** 유지됨. Vite `assetsDir:'assets'`(§1-3) + `base:'/'` 가 dist 내부를 `dist/index.html` + `dist/assets/*` 구조로 만들기 때문(§3-1).
- 단, `/locales/*` 는 dist 밖(`packages/web/locales/`)에 있으므로(아래 §2-3) WEB_ROOT 단일 이동만으로는 깨진다 → §2-3 처리 필요.

**방식 B — 환경변수 모드 스위치**
- `SPYGLASS_WEB_MODE=dev|dist` 같은 플래그로 dispatch 가 루트를 분기. dev 모드면 데몬이 정적 서빙을 아예 비활성(Vite 가 담당), 운영이면 dist 서빙.
- 장점: dev 시 데몬이 stale 자산을 서빙하는 사고 방지. 단점: dispatch 분기 코드 증가. → dev 는 Vite proxy(§1-3)가 API만 데몬으로 넘기므로 **방식 B 의 dev 분기는 사실상 불필요**. 방식 A + Vite proxy 조합으로 충분.

> 결론: **방식 A(WEB_ROOT→dist) + Vite proxy(dev) + locales 경로 보정(§2-3)** 을 채택. dispatch 변경은 1줄(+locales 보정). 백엔드 로직(API/SSE/collect/proxy)은 무수정.

### 2-3. locales 경로 처리 (병존 깨짐 방지)

- 현재 `/locales/*` 는 `webFile(safePath)` = `WEB_ROOT/locales/*` 에서 찾는다(`dispatch.ts:152-164`). `packages/web/locales/` 가 실존(ls 확인). WEB_ROOT 를 `dist/` 로 옮기면 `dist/locales/` 를 찾게 되어 404.
- 처리안 ① **Vite `publicDir` 활용**: `packages/web/locales` 를 Vite public 대상으로 두면 `vite build` 가 `dist/locales/` 로 그대로 복사 → WEB_ROOT=dist 만으로 정합. (권장 — dispatch 무수정)
  - 단 Vite 기본 `publicDir`는 `public/` 1개라, `locales` 를 그쪽으로 옮기거나 `viteStaticCopy` 플러그인으로 명시 복사.
- 처리안 ② dispatch 의 locales 분기만 별도 루트(`WEB_ROOT/../locales` 또는 `LOCALES_ROOT` env)로 분리. dispatch 2줄 변경.
- → **처리안 ①(Vite 가 dist/locales 로 복사)** 권장. dispatch·서버 무수정, electron-builder 도 dist 한 덩어리만 동봉(§3-3).

### 2-4. 개발 워크플로 (2-모드 구동 절차)

```
# dev (HMR)
터미널1: bun run dev                       # 데몬 9999 (API/SSE/collect)
터미널2: bun run --cwd packages/web dev    # Vite 5173 (HMR, /api·/events 를 9999로 proxy)
브라우저: http://127.0.0.1:5173

# 운영 검증 (데몬이 dist 서빙)
bun run --cwd packages/web build           # → packages/web/dist
bun run dev                                # 데몬 restart, http://127.0.0.1:9999
```

---

## 3. dist 산출물 구조와 패키징 변경점

### 3-1. 예상 dist 구조 (Vite §1-3 설정 기준)

```
packages/web/dist/
  index.html              ← Vite가 해시 자산 link 주입한 진입 HTML
  assets/
    index-<hash>.js        ← 번들 엔트리
    index-<hash>.css
    <chunk>-<hash>.js      ← code-split 청크
    *.map                  ← sourcemap (build.sourcemap:true)
  locales/                 ← publicDir 복사분 (§2-3 처리안①)
  favicon.svg
```
- 산출 자산이 `dist/assets/` 아래로 떨어지므로 데몬 `/assets/*` 라우팅과 정합(`dispatch.ts:135`).

### 3-2. dispatch mimeMap 확장 (필수)

`dispatch.ts:139-145` mimeMap 은 `js/css/svg/ico` 4종뿐. Vite 산출물 대응 위해 다음 추가:

| 확장자 | mime | 사유 |
|--------|------|------|
| `map` | `application/json` | sourcemap (build.sourcemap) |
| `woff2`/`woff` | `font/woff2`·`font/woff` | 폰트 self-host 시(현재는 Google Fonts CDN — `index.html:87-89`. self-host 전환 시 필요) |
| `png`/`webp`/`json` | `image/png`·`image/webp`·`application/json` | 해시 이미지·매니페스트 |

- 미추가 시 `application/octet-stream` 으로 떨어져(`dispatch.ts:147`) 브라우저가 sourcemap/font 를 거부할 수 있음.

### 3-3. electron-builder 변경 (packaged)

현재 `from: ../web / to: app/web / filter: ["**/*", "!**/__tests__/**", "!**/*.test.ts"]` — 근거 `electron-builder.yml` extraResources.

Vite 도입 후:
- **`from: ../web/dist / to: app/web`** 로 변경(소스 JS 가 아닌 빌드 산출물만 동봉).
- `build:mac` 파이프라인에 **`bun run --cwd ../web build` 선행 단계 추가** 필요(현재 `build:server-bins` 만 선행 — `desktop/package.json` scripts). dist 가 없으면 빈 디렉토리 동봉됨.
- filter 의 `__tests__`/`*.test.ts` 제외는 dist 에 테스트가 안 들어가므로 사실상 무의미해지나 안전상 유지 가능.
- `SPYGLASS_WEB_ROOT` 주입값(`server-process.js:121`)은 dist 를 `app/web` 으로 복사하면 **무수정 유지**. (dist 를 `app/web/dist` 로 복사하면 주입값도 변경 필요 → `app/web` 으로 복사가 변경 최소.)

### 3-4. .gitignore / 빌드 산출물

- `packages/web/dist/` 를 `.gitignore` 에 추가(루트 `.gitignore` 존재 — `ls` 확인). dist 는 빌드 산출물이라 미추적.
- node_modules: web 패키지가 react 등 신규 deps 를 가지면 `bun install` 이 루트 lockfile(`bun.lock`) 갱신. CI `--frozen-lockfile`(`test.yml:45`) 이므로 lockfile 커밋 필수.

---

## 4. 구 Vanilla 자산 ↔ 신 React 자산 병존 전략

점진 전환(페이즈1~5, master prompt §4) 동안 한 번에 main.js 를 폐기하지 않는다. 다음 제약과 전략을 따른다.

### 4-1. 핵심 제약: classic script 전역 의존

- `i18n.js`(classic, `window.I18n` 노출 — `i18n.js:282`)가 main.js 보다 먼저 로드되고(`index.html:975-978`), ESM 모듈들이 런타임에 `window.I18n` 을 참조한다.
- React 컴포넌트도 전환 기간엔 동일 `window.I18n` 을 재사용해야 i18n 출력이 일관된다. **i18n 을 ESM import 로 전환하는 것은 별도 트랙**(스냅샷 테스트가 I18n 모킹에 의존 — master prompt §2-1, `renderers.test.ts.snap`).
- Vite dev/build 는 `index.html` 의 classic `<script src>` 를 그대로 처리(번들 외부 자산으로 취급)하거나 ESM 으로 끌어올릴 수 있음. **병존 기간엔 classic 3종을 index.html 에 그대로 두고** React 엔트리만 추가하는 방식이 회귀 위험 최소.

### 4-2. 병존 방식: 동일 페이지 마운트 포인트 분할 (권장)

- React 앱을 **DOM 서브트리 단위로 점진 마운트**한다(전체 라우터 교체는 페이즈4까지 미룸).
- 절차:
  1. `index.html` 에 React 엔트리 `<script type="module" src="/src/main.tsx">` 를 main.js 와 **병렬 추가**(둘 다 로드).
  2. 페이즈2~3 컴포넌트(design-system 30개, settings-view 등)를 React 로 만들면, 해당 영역의 기존 DOM 컨테이너에 `createRoot(el).render(<Comp/>)` 로 **부분 마운트**. 기존 main.js 의 그 영역 렌더 호출은 비활성.
  3. 셀렉터 계약(ID/class/`data-*`)을 JSX 에 1:1 유지(master prompt §2-1) → 미전환 영역의 main.js DOM 조작과 충돌 없음.
- 출력 동일성은 `renderers.test.ts.snap` 골든마스터로 검증(master prompt §2-1).

### 4-3. dev HMR 중 병존

- Vite dev 는 `index.html` 을 진입점으로 삼아 classic script(i18n 3종)와 module(main.js, main.tsx)을 모두 서빙. classic script 는 Vite 가 `/assets/js/i18n.js` 경로로 그대로 패스(데몬 proxy 불필요 — Vite 가 web 디렉토리 루트 자산을 직접 서빙).
- 단 main.js 의 상대 import(`./chart.js` 등 — `main.js:2-48`)는 Vite dev 가 ESM 으로 그대로 해석 가능(buildless 였으므로 이미 표준 ESM). 추가 변환 불필요.

### 4-4. React Router 도입 시 SPA fallback (페이즈4)

- main.js 폐기 후 React Router v6 로 전환하면(master prompt §페이즈4) 클라이언트 라우팅 경로(`/sessions/:id` 등)에 직접 진입/새로고침 시 데몬이 404 를 낸다 — dispatch 에 **SPA fallback 부재**(§0-1 ②).
- 처리: dispatch 의 404 직전(`dispatch.ts:177-187`)에 **"json 미요청 GET 은 index.html 반환"** 분기 추가, 또는 `/assets`·`/api`·`/events` 등 알려진 prefix 가 아닌 GET 을 index.html 로 폴백. 단 현재 main.js 가 해시 라우팅이면 페이즈4 전까지 불필요 → **페이즈4 도입 시점에 dispatch 1분기 추가**로 처리.

### 4-5. 병존 종료 (페이즈5)

- 전 파일 `.tsx` 전환 완료 시 `index.html` 의 classic script(i18n 3종)·main.js 제거, React 엔트리 단일화. WEB_ROOT=dist 로 운영 일원화. `strict:true` 승격(master prompt §페이즈5).

---

## 5. 인프라 리스크 / 미결(Gap) 항목

| # | 항목 | 영향 | 권장 |
|---|------|------|------|
| G1 | dispatch mimeMap 4종 한정(`dispatch.ts:139`) | sourcemap·font·png 자산 octet-stream 으로 거부 | §3-2 mimeMap 확장 (백엔드 무수정 원칙의 **예외** — 사용자 확인 필요) |
| G2 | locales 가 dist 밖(`packages/web/locales/`) | WEB_ROOT=dist 이동 시 /locales 404 | §2-3 publicDir 복사로 dist/locales 정합 |
| G3 | SPA fallback 부재(`dispatch.ts:177`) | React Router 직접진입 404 | 페이즈4 시 dispatch 1분기 추가(§4-4) |
| G4 | `i18n.js` classic 전역(`window.I18n` `i18n.js:282`) | ESM/번들 전환 시 전역 의존 끊김 + 스냅샷 모킹 영향 | 병존 기간 classic 유지(§4-1), i18n ESM화는 별도 트랙 |
| G5 | electron-builder `from:../web` 전체 동봉 | dist 미빌드 시 빈 자산 동봉 | §3-3 `from:../web/dist` + build 선행 단계 |
| G6 | CI setup-bun `1.2.x`(`test.yml:40`) vs 로컬 1.3.11 | Vite/React 빌드의 bun 버전 민감도 | dev/CI bun 버전 정렬 검토(빌드는 Vite 가 담당하므로 영향 낮음) |
| G7 | 캐시 헤더 미적용(해시 자산) | 운영 캐시 효율 저하 | 페이즈5 최적화 — 해시 파일에 `Cache-Control: immutable` (dispatch /assets 분기에 추가) |

> **백엔드 무수정 원칙과의 충돌 명시**: 미션은 "백엔드 무수정"이나, dispatch 의 정적 서빙(mimeMap 확장 G1, WEB_ROOT→dist §2-2, SPA fallback G3)은 **클라이언트 자산을 데몬이 서빙하기 위한 인프라 접합부**다. REST API/SSE 핸들러 로직(`/api`·`/events`·`/collect`·`/v1` 분기 내부)은 무수정이며, 변경은 **정적 자산 라우팅 분기로 한정**된다. 이 경계 해석은 휴먼 검증 포인트로 남긴다.

---

## 6. 작업 격리·회귀 안전망 (인프라 관점)

- 실제 구현은 **git worktree** 로 격리(미션 요구). 본 패널은 문서 단계이므로 worktree 미생성.
- 회귀 보루: `bun test`(web 12개 + 스냅샷 `renderers.test.ts.snap`) + CI `web-typecheck` blocking(`test.yml:32-46`). Vite 도입 후에도 이 두 게이트를 **그대로 유지**(typecheck include 확장만, §1-4).
- 인프라 변경(vite.config·tsconfig·dispatch·electron-builder)은 **작은 커밋**으로 분리: ① vite/react deps+config ② tsconfig jsx ③ dispatch WEB_ROOT→dist+locales ④ mimeMap ⑤ electron-builder dist. 각 커밋 후 `bun test` + `typecheck` 게이트 통과 확인. git bisect 로 회귀 추적 가능하도록 커밋 단위 독립성 유지.

---

## 부록 A. 근거 파일 인덱스

| 영역 | 파일 | 핵심 라인 |
|------|------|-----------|
| 정적 서빙 디스패처 | `packages/server/src/runtime/dispatch.ts` | 26-33(WEB_ROOT/webFile), 99-127(/), 134-150(/assets), 152-164(/locales), 166-175(favicon), 139-145(mimeMap), 177-187(404) |
| 데몬 Bun.serve | `packages/server/src/runtime/lifecycle.ts` | 150-153 |
| 포트/호스트 | `packages/server/src/runtime/config.ts` | 14, 34, 35 |
| 진입 HTML | `packages/web/index.html` | 975-978(scripts), 90-113(css), 10-83(FOUC) |
| ESM 엔트리 | `packages/web/assets/js/main.js` | 2-48(imports) |
| i18n 전역 | `packages/web/assets/js/i18n.js` | 282(window.I18n) |
| web tsconfig | `packages/web/tsconfig.json` | 2-22 |
| web typecheck | `packages/web/package.json` | 8 |
| CI typecheck | `.github/workflows/test.yml` | 32-46 |
| desktop env 주입 | `packages/desktop/src/main/server-process.js` | 95-96, 112-143(특히 121) |
| desktop 빌드 | `packages/desktop/package.json` | scripts(build:server-bin, build:mac) |
| 패키징 동봉 | `packages/desktop/electron-builder.yml` | extraResources(from:../web → app/web) |
| 런타임 환경 | (실측) bun 1.3.11 / CI bun 1.2.x | — |
