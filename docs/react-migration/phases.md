# 페이즈별 상세 작업 명세

> 대상: `claude-spyglass` `packages/web` (Vanilla JS buildless ESM, 105 .js) → React 18 + Vite + TypeScript(strict). 대안 C 풀 마이그레이션.
> 기준 HEAD `2126e11` · v3.0.7. 정본 작업지시서 `react-migration-master-prompt.md`(교정판 v2). 6 패널 합의 반영(`panel-consensus.md`).
> task id 는 `tasks.json` 과 1:1 대응. 본 문서는 개발 작업 문서이며 React 코드를 포함하지 않는다.

## baseline (불변식 — 매 머지 게이트 기준선)

- bun test: 174 pass / 0 fail / 20 snapshot / 12 files
- web typecheck: 0 에러 (`bun run --cwd packages/web typecheck`, CI blocking)
- innerHTML 130건 · design-system 30 .js · 순환 의존 0

---

## 페이즈 1 — 빌드 인프라 + 전역 스토어 (0~2주)

**목표**: Vite+React18+TS 파이프라인 도입, 서버 서빙 계약 결정, Zustand 스토어(state.js 흡수)·Zod 스키마 설계. 회귀 보루를 Vite 환경에서 1:1 재현.

| task | 대상 | 작업 방식 | 검증 |
|------|------|-----------|------|
| P1-01 | vite.config.ts·package.json·tsconfig | react()·base:'/'·outDir:dist·assetsDir:assets·dev proxy(/api·/events·/collect·/v1·/health·/locales→9999). tsconfig jsx:react-jsx, include 에 .js+.ts/.tsx 동시. | typecheck 0 + bun test 174 불변 + 거짓통과 검증 |
| P1-02 | .architecture-decision-serving.md | 방식 A(WEB_ROOT→dist)+locales publicDir 복사+mimeMap 확장+SPA fallback(페이즈4). 백엔드 무수정 경계 명시. | 문서 task, dispatch.ts 경로 1:1 대조 |
| P1-03 | .migration-gap-report-i18n.md | window.I18n 39파일 의존 전수 조사, 병존 classic 유지 결정. | 스냅샷 I18n 모킹 보존 확인 |
| P1-04 | src/stores/app-store.ts | state.js getter/setter 11쌍 + 라우팅 슬라이스 Zustand 이식. 초기값 SSoT=state.js:14-26. | app-store.test.ts (state.test.ts 14 동치) |
| P1-05 | app-store-persist.test.ts | persist 미들웨어(partialize/migrate)로 date-range-storage 흡수. | 12 case 회귀 0 (버전/파싱실패/custom) |
| P1-06 | bunfig.toml | **러너 선결 결정**(bun 유지/Vitest) + import resolve 정합. P1-04 이전 게이트. | 12파일 174 pass 재현(거짓통과 검증) |
| P1-07 | src/schema/sse-schema.ts | SSE 3 이벤트 + API 응답 Zod 스키마, @spyglass/types 정규화. | 페이로드 fixture 검증 |
| P1-08 | .migration-coverage-map.md | 105 .js 전수 소속 매핑(orphan 0) + innerHTML 130건 사이트별 인벤토리(파일:라인→소유 task). | 문서/인벤토리 task, 후속 게이트 기준선 |

**예상 기간**: 2주. **머지 순서**: P1-01 → P1-06(러너 선결) → P1-02 → P1-03 → P1-08 → P1-04 → P1-05 → P1-07.
**핵심 GAP**: 서빙 계약(P1-02), i18n 전역(P1-03), 러너 결정(P1-06, 선결 게이트). **신규**: P1-08 전수 매핑이 M1(무소속 26파일)·M2(innerHTML 추적) 사각지대를 닫는다.

---

## 페이즈 2 — 원자적 저위험 컴포넌트화 (2~5주)

**목표**: design-system 30개 + render/* + components 3개 stateless TSX 이식. settings-view 1590줄 폼 분해 선행 후 React 전환. (전부 leaf/배럴, 회귀 위험 최소 구간.)

| task | 대상 | 작업 방식 | 검증 |
|------|------|-----------|------|
| P2-01 | design-system/icons 21 | stateless TSX, SSoT 토큰 경유(hex 직접 금지) | 신규 SVG 스냅샷 |
| P2-02 | primitives 3 | 클릭 핸들러 prop 화 | 렌더 테스트 |
| P2-03 | markers 2 + badges/chips/feedback/stats 5 | stateless TSX | 스냅샷 |
| P2-04 | render/* 8파일 | renderers 배럴 우회→render/* 직접 import 경로 교정 | **renderers 20 골든마스터 diff 0** (정규화 비교, data-*/id/class 토큰 엄격) |
| P2-05 | .architecture-decision-settings.md | 진단/Hook/Graph DB/Proxy 4영역 경계 설계 | 설계 task |
| P2-06 | settings 진단/Hook 폼 | 분해(refactor)→이식(feat) 분리 | 신규 폼 핸들링 테스트(공백 보강) |
| P2-07 | settings Graph DB/Proxy 폼 | 동일 | 폼 테스트(apiFetch 모킹) |
| P2-08 | components 3 | date-range 스토어 연결 | date-range-storage(12)·get-date-range(20) 게이트 |

**예상 기간**: 3주. **병렬 가능**: P2-01~04(design-system+render) ∥ P2-05~07(settings) ∥ P2-08(components), 모두 P1-04 이후 별도 worktree.
**난이도 교정**: settings-view 는 "저위험" 아님 — 1590줄 분해 선행 필수.

---

## 페이즈 3 — 중위험 결합 컴포넌트 + API 데이터 역전 (5~9주)

**목표**: chart.js useRef 캡슐화, left-panel/session-detail 분해+스토어 결합, api.js 9개 render 사이드이펙트 제거(데이터 흐름 역전).

| task | 대상 | 작업 방식 | 검증 |
|------|------|-----------|------|
| P3-01 | chart.js → Chart.tsx | useRef canvas, setSourceData→props, donutMode→스토어 | 데이터 변환 골든마스터(신규)+context-window(6), resize 수동 verify |
| P3-02 | left-panel.js → Sidebar.tsx | _allProjects/_allSessions→스토어, render→JSX | left-panel(2) 마운트 가드 재정의 + 언마운트 cleanup(신규) |
| P3-03 | api.js 역전 | **Tidy First 4단계**: A 특성화 → B render→임시어댑터(refactor:) → C 어댑터→Zustand 액션(feat:) → D 역참조 0. 9 사이트별 작은 커밋. | api.test.ts(10)+스냅샷 diff 0+api→stores 역참조 0 |
| P3-04 | .architecture-decision-session-detail.md | 7파일 facade 경계, table 골격 보존 | 설계 task, 특성화 보강 계획 |
| P3-05 | flat-view·turn-rows → SessionLog/TurnRows | parseToolDetail 선행 Tidy 추출 | parseToolDetail(10)+신규 스냅샷 |
| P3-06 | turn-views 1117 분해 | 턴 카드 서브컴포넌트, 분해→이식 분리 | 출력 동치 |
| P3-07 | system-reminder*·detail-view | TSX | 컴포넌트 테스트 |
| P3-08 | llm-input-view 902 → LLMInput | toggle/expand/scroll 상태 분리, state→스토어 | 컴포넌트 테스트 |
| P3-09 | 대시보드/통계 뷰(obs-panel·cache-panel·context-chart·sparkline·tool-stats·metrics-api 등) → TSX | M1 무소속 사각지대 해소. 카드 렌더 TSX 이식 | 카드 렌더 골든마스터(신규)+구 .js 삭제·import 0 |

**예상 기간**: 4주. **순차 강제**: P3-02(left-panel) → P3-03(api 역전) → (P4-05 SSE 핸들러). **격리**: api.js 역전은 전용 worktree, render-coupled fetcher 가 main.js 단일 소비처라 위험 좁게 격리. **P3-09**: P1-08 매핑·P3-01 chart 선행. 툴팁/리사이즈 헬퍼는 P1-08 매핑 결과에 따라 P3-09 또는 P5-01 귀속.
**P3-05 SSoT 정정**: parseToolDetail 는 render/extract.js:212 export 로 이미 존재 → "추출"이 아닌 "재연결"(동작 동치 확인 후 단일화).

---

## 페이즈 4 — 고위험 모놀리식 해체 + 라우팅/SSE (9~15주)

**목표**: meta-docs-view 1370 분해, sse.js→useSSE 훅, main.js 1036 폐기→React Router v6, index.html 진입 전환.

| task | 대상 | 작업 방식 | 검증 |
|------|------|-----------|------|
| P4-01 | .architecture-decision-meta-docs.md | flow/catalog/search/sidebar/tool-stats 5분할 | 설계 task, 특성화 보강 계획 |
| P4-02 | meta-docs catalog+검색 | MetaDocsCatalog/Search TSX | 검색 필터 테스트(신규) |
| P4-03 | meta-docs flow+tool-stats | TSX 통합 | scopeMode/searchText/activeRow 검증 |
| P4-04 | sse.js → useSSE 훅 | 재연결/5초 backoff + 3 이벤트 + Zod + 언마운트 cleanup(신규 계약) | sse.test.ts(8) 동치 + cleanup Red(Gap) |
| P4-05 | SSE 핸들러 → 스토어 액션 | onNewRequest/onNewProxyRequest/onSessionUpdate 이전 | events.test.ts(6)→스토어 흡수 + sse 회귀 |
| P4-06 | main.js 폐기 → React Router | App/BrowseLayout/MetaDocsLayout/SettingsLayout, appMode→useNavigate. sink라 마지막 통째 교체. **진성 빅뱅** | bun test 전량 + 3모드 수동 verify(체크리스트 4항+증거) + main.js 삭제·import 0 |
| P4-08 | electron-builder dist 전환 | from:../web/dist 전환 + 패키지 빌드 운영 분기 verify. 서버/electron 커밋 분리 격리 | 운영 모드 dist 서빙·앱 기동 verify |
| P4-07 | index.html 진입 전환 | Vite 번들, FOUC/lang 인라인 보존, classic i18n 처리, dispatch SPA fallback 1분기. **진성 빅뱅(비가역)** | lang 4종 매트릭스+FOUC+SPA fallback 수동 verify(증거) |

**예상 기간**: 6주. **병렬 가능**: useSSE(P4-04)는 sse.js 단일 소비처라 독립성 높음, meta-docs(P4-01~03)는 getDateRange만 의존 → P3-03 이전 착수 가능. **최종 통합**: P4-06(전 컴포넌트 통합)은 P3-03·P4-03·P4-05·P3-08 전부 선행, 머지 직전 main 최신 store 로 rebase.
**진성 빅뱅 2개(P4-06·P4-07)**: 자동 게이트(bun test) 사각 + 수동 verify 의존 → 회귀 0 의 실질 구멍. 완화는 "수동 verify 판정 기준 사전 체크리스트 + 증거 아티팩트". lang 우선순위 4종 매트릭스=(1)localStorage spyglass:lang (2)?lang= 쿼리 (3)navigator.language (4)기본값.

---

## 페이즈 5 — TS strict 승격 + 렌더링 최적화 (15~20주)

**목표**: 잔여 .js→.ts/.tsx 전환, strict:true 단일화, any 제거+Zod 전면, 측정 선행 perf 최적화.

| task | 대상 | 작업 방식 | 검증 |
|------|------|-----------|------|
| P5-01 | 잔여 .js→.ts/.tsx **전수** | P1-08 매핑 기준 잔여 전부(renderers·formatters·dom·app-rail·util/*·state/*·views/* + i18n 4종·헬퍼 잔여). 열거 아닌 전수 | formatters(53)·anomaly(14)+스냅샷 + 잔여 .js 0 |
| P5-02 | tsconfig strict:true | checkJs 임시 tsconfig 폐기, strict 위반 0 | typecheck 0(거짓통과 검증) |
| P5-03 | any 제거 + Zod 전면 | JSON 파싱부 스키마 적용 | strict 0 + 스키마 테스트 |
| P5-04 | React.memo/useMemo | **측정 선행** — SSE 고주기 부하 시나리오(5~20 ev/s) + Profiler. 임계 16ms 프레임 예산 | 측정 데이터 필수 + 임계 초과분만 적용(무측정 통과 금지) |
| P5-05 | 가상 스크롤 부분 도입 | **측정 선행** — 대량 목록(턴 N≥500/카탈로그 N≥1000) 프로파일. 임계 16ms | 측정 데이터 필수 + 가시영역 출력 동치 |
| P5-06 | .migration-final-report.md | 최종 게이트 + Gap 종합 | bun test 전량 + strict typecheck 0 + **innerHTML 0·.js 0·orphan 0** |

**예상 기간**: 5주. **over-engineering 가드**: P5-04/05 는 측정된 성능 문제가 없으면 "불필요" 결론이 정당(stabilization 패널 W12 합의). 단 '측정' 은 필수 산출물(부하 시나리오+프로파일) — 측정 자체를 생략하고 "종결"로 통과시키는 것은 금지(review-completeness A2).

---

## 전체 의존성 게이트 (요약)

```
P1-01 (Vite/TS) ──┬─ P1-06 러너결정(선결, 모든 후속 선행)
                  ├─ P1-02 서빙계약(GAP) ─┬─ (P4-07)
                  ├─ P1-03 i18n(GAP)      ┘
                  ├─ P1-08 전수매핑+innerHTML 인벤토리 ── (P3-09·P5-01 기준선)
                  ├─ P1-04 store ──┬─ P1-05 persist
                  │                ├─ P2-* / P3-* / P4-*
                  └─ P1-07 Zod ── P4-04 useSSE
P2-04 render 스냅샷 ── P3-01 chart ── P3-09 대시보드 뷰
P3-02 left-panel → P3-03 api역전 → P4-05 SSE핸들러 → P4-06 router → P4-08 electron → P4-07 entry → P5-* strict/최적화
P4-06 → P5-01 .ts전수전환(P1-08·P3-09 선행) → P5-02 strict → P5-03 any제거 → P5-04/05 측정 → P5-06 최종(innerHTML0·.js0·orphan0)
```

총 task 39개 (P1 8 · P2 8 · P3 9 · P4 8 · P5 6 — 설계/문서/인벤토리 task 7개 포함). 예상 총 기간 20주.
**검토 라운드 반영(신규 3 task)**: P1-08(전수 매핑+innerHTML 인벤토리, M1·M2), P3-09(대시보드 뷰 이식, M1), P4-08(electron 패키징 verify, M4). 상세 반영 내역은 `panel-consensus.md §6`.
