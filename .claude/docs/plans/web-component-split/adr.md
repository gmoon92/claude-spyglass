# ADR: Web 컴포넌트 분리 (web-component-split)

## 상태: 완료 (2026-04-19)

## 결정 1 — no-build + native ESM 채택

**채택**: no-build + 브라우저 native ESM (`<script type="module">`)
**기각**: Vite 빌드 도입

**근거**
- 서드파티 npm 의존성 없는 바닐라 JS → import map 불필요
- 빌드 아웃풋 `dist/`와 소스 `src/` 이중 관리 부담 제거
- 디자인 문서(screen-inventory.md)와 실제 파일 경로 1:1 유지
- 로컬 모니터링 도구 — CDN 최적화 불필요, HTTP/1.1 연결 재사용으로 10-15파일 충분

## 결정 2 — CSS 로드 순서 규칙

`design-tokens.css` → `layout.css` → 컴포넌트 CSS 순서 보장.
컴포넌트 CSS는 `:root` 변수를 새로 정의 불가 — `design-tokens.css`만 정의 권한 보유.

## 결정 3 — JS 단방향 import 그래프

```
formatters.js  ← (no deps)
chart.js       ← (no deps)
renderers.js   ← formatters
infra.js       ← (no deps)
left-panel.js  ← formatters, renderers
session-detail.js ← formatters, renderers, api[API const만]
api.js         ← formatters, chart, infra, left-panel, renderers
main.js        ← 전체
```

순환 import 없음. `main.js`가 SSE, selectProject/Session 등 조율 담당.

## 결정 4 — 전역 onclick 처리

인라인 `onclick` 속성은 이미 이벤트 위임으로 처리되어 있었음 → `window.*` 노출 불필요.
expand-copy 버튼만 `navigator.clipboard` 인라인 호출 유지 (외부 함수 참조 없음).

## 결정 5 — 서버 정적 핸들러

`/assets/` prefix → `packages/web/assets/` 매핑.
MIME 맵: `js → application/javascript`, `css → text/css`, `svg → image/svg+xml`.
경로 트래버설 방지: `path.replace(/\.\./g, '')`.
기존 favicon 핸들러 유지 (하위 호환).
