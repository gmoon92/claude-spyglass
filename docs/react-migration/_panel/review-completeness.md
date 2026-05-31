# 완전성 검토 — tasks.json / phases.md vs 마스터 작업지시서

> 검토자: 완전성 검토 패널. 기준 HEAD `2126e11` · v3.0.7.
> 대조 대상: `react-migration-master-prompt.md`(교정판 v2, 5 페이즈) ↔ `tasks.json`(36 task) · `phases.md`.
> 본 문서는 누락 task·모호 done_criteria 만 기록하는 검토 산출물이다. 실측은 `packages/web` 소스 직접 확인으로 검증했다.

---

## 0. 결론 요약

마스터 8개 요구 차원 중 **5개는 충분, 2개는 부분, 1개는 누락**. 추가로 **파일 커버리지 사각지대(약 26개 top-level .js 무소속)** 와 **수동 verify done_criteria 의 합격 기준 부재** 가 가장 큰 완전성 결함이다.

| 차원 | 상태 | 근거 task | 결함 |
|------|------|-----------|------|
| innerHTML 130건 전수 | ▲ 부분 | P2-05(settings만 매핑) | 130건→소속 task 매핑·최종 0건 게이트 없음 |
| 12 테스트 계승 | ● 충분 | P1-04/05/06, P2-04/08, P3-01/02/03/05, P4-04/05, P5-01 | 12/12 전수 매핑 확인 |
| api 역전 | ● 충분 | P3-03 (Tidy First 4단계) | — |
| useSSE | ● 충분 | P4-04 + cleanup Gap | — |
| Vite dev/운영 분기 | ▲ 부분 | P1-01(dev) · P1-02(운영 문서) · P4-07(entry) | electron 패키징 변경/검증 task 없음 |
| strict 승격 | ● 충분 | P5-02 | — |
| Playwright 신규도입 | ✕ 누락 | (없음) | 도입 여부 결정 task·Gap 모두 부재. 수동 verify 누적분 자동화 미결 |
| 가상스크롤 | ● 충분 | P5-05 (측정 선행) | — |

---

## 1. 누락 task (빠진 작업)

### M1. 파일 커버리지 사각지대 — top-level .js 약 26개 무소속 ★최대 결함★

`tasks.json` 은 105 .js 중 **카테고리/글롭으로 묶인 것**(design-system 30·`render/*` 8·`components/` 3·`session-detail/` 7·`util/*`·`state/*`)과 **개별 명명된 11개 top-level**만 다룬다. 그 외 다수 top-level 파일은 **어느 task 도 소유하지 않고, 어느 글롭에도 안 걸린다.**

무소속(또는 소유 모호) top-level 파일:
- **대시보드/통계 뷰**: `obs-panel.js`(burn-rate/cache-health/live-pulse/tool-categories/anomaly-badge 카드 렌더 — api.js 가 import), `cache-panel.js`, `context-chart.js`, `sparkline.js`, `tool-stats.js`, `metrics-api.js`, `system-prompt-library.js`, `version-check.js`, `infra.js`, `request-types.js`, `tool-colors.js`
- **툴팁/리사이즈 헬퍼**: `cache-panel-tooltip.js`, `cache-tooltip.js`, `obs-tooltip.js`, `stat-tooltip.js`, `col-resize.js`, `panel-resize.js`, `resize-utils.js`, `left-panel-vertical-resize.js`, `dom-preserve.js`
- **i18n 계열**: `i18n.js`, `i18n-dom.js`, `i18n-utils.js`, `lang-switcher.js` (P1-03 은 *전략 결정 문서*일 뿐 이식 task 아님)

영향: `obs-panel.js` 의 카드 렌더 함수는 P3-03(api 역전)에서 **호출부**만 스토어 dispatch 로 바뀔 뿐, **뷰 컴포넌트 자체의 TSX 이식 task 가 없다.** 대안 C(풀 마이그레이션)는 모든 .js 제거가 목표인데, 이 26개가 어느 페이즈에서 .tsx 가 되는지 명세에 없다. P5-01 이 "잔여 .js 일괄 전환"으로 흡수한다고 볼 수도 있으나, P5-01 의 대상 목록은 `renderers·formatters·dom·app-rail·util/*·state/anomaly-cache·views/default-view` 로 **한정 열거**되어 위 파일들을 명시 포함하지 않는다.

→ **필요 조치**: (a) 105 파일 전수 → 소속 task 매핑표(orphan 0 확인) 추가, 또는 (b) obs-panel/cache-panel/context-chart/sparkline/tool-stats 등 대시보드 뷰 이식 task 를 P3 또는 P4 에 신설, (c) P5-01 done_criteria 를 "잔여 .js 전부"의 **열거 아닌 전수**로 재정의.

### M2. innerHTML 130건 전수 매핑·최종 0건 게이트 없음

`baseline.innerHTML:130` 은 기록되지만, **130건 각각을 소유 task 에 귀속시키는 인벤토리가 없다.** innerHTML 이 명시 언급된 곳은 P2-05(settings-view innerHTML 집중 매핑) 하나뿐. M1 의 무소속 파일들이 innerHTML 의 상당량을 보유(obs-panel·cache-panel·meta-docs 계열)하므로, innerHTML 폐기는 부분적으로만 추적된다. P5-06 최종 보고서 done_criteria 에도 **"innerHTML 잔여 0건"** 검증이 없다.

→ **필요 조치**: P1 에 innerHTML 130건 사이트별 인벤토리(파일:라인 → 소유 task) 산출 task 추가. P5-06 에 "innerHTML 잔여 0 + 잔존 시 사유" 게이트 추가.

### M3. 구(舊) .js 삭제·dangling import 제거 검증 task 없음

대안 C 는 buildless 폐기 + 모든 .js → .tsx 전환이다. 그러나 task 들은 대부분 **신규 TSX 생성**만 done_criteria 로 두고, **대응 구 .js 삭제 및 `index.html`/배럴의 잔여 import 제거**를 게이트하지 않는다. P4-06("main.js 폐기")·P4-07("병존 종료")만 일부 다룸. design-system/render/session-detail 의 구 .js 가 언제 삭제되고 누가 "죽은 import 0"을 확인하는지 명세에 없다.

→ **필요 조치**: 각 이식 task done_criteria 에 "구 .js 제거 + 참조 0(grep)" 추가, 또는 페이즈별 "dead module 0" 게이트 task 신설.

### M4. electron-builder 패키징 변경·검증 task 없음

P1-02 done_criteria 가 "electron-builder from:../web/dist 변경점 기록"을 **문서화**하지만, 실제로 패키징 설정을 변경하고 **패키징된 앱이 dist 를 서빙하는지 검증하는 실행 task 가 없다.** 운영 분기(데몬 dist 서빙)의 end-to-end 확인 공백.

→ **필요 조치**: P4 또는 P5 에 electron 패키징 전환 + 패키지 빌드 verify task 신설.

### M5. Playwright 도입 여부 결정 task / 수동 verify 자동화 미결

마스터 §6: "Playwright 신규 도입은 결정 시에만 별도 비용 페이즈로 분리." `tasks.json` 에는 Playwright task 도, **도입 여부를 명시 결정/보류하는 Gap 항목도 없다.** 동시에 P3-01(resize/redraw)·P4-06(3모드)·P4-07(FOUC/lang 4종·SPA fallback)·P5-04(프레임)·P5-05 가 모두 "수동 verify"에 의존 — 이는 정확히 Playwright 가 자동화할 표면이다. 수동 검증 부채가 누적되는데 자동화 go/no-go 가 어디에도 기록되지 않는다.

→ **필요 조치**: "Playwright 도입 보류/도입" 결정을 `panel-consensus.md §5 미결 Gap` 에 항목 추가하고, 수동 verify task 들이 그 결정에 연결되도록 명시.

---

## 2. 모호한 done_criteria (합격 기준 불명확)

### A1. "수동 verify 통과" — 합격 임계·증거 산출물 미정의 (P3-01, P4-06, P4-07, P5-04, P5-05)
- P3-01 `resize/redraw 수동 verify 통과`: 무엇을 관찰하면 통과인지(예: N px 리사이즈 후 깜빡임 0/도넛 재그림 1회), 누가 검증하는지, 증거(스크린샷/캡처) 요구가 없다.
- P4-06 `3모드 수동 verify 통과`: 3모드 전환 외 "init 순서·tooltip/resize/SSE 초기화" 각 항목의 합격 조건이 없다.
- P4-07 `FOUC/lang 인라인 보존 ... SPA fallback 동작`: "lang 우선순위 4종"의 4종 구체값·기대 결과 매트릭스가 done_criteria 에 없다(test_strategy 에만 암시).
- → 각 수동 verify 에 **합격 체크리스트 + 증거 아티팩트(스크린샷/로그) 첨부**를 done_criteria 로 못박을 것.

### A2. "측정 없으면 종결" — 무측정 무작업 통과 허용 (P5-04, P5-05)
P5-04 `측정으로 입증된 리렌더 비용에만 적용, 측정 없으면 종결`. over-engineering 가드 취지는 타당하나, **"측정"의 정의·임계(프레임 예산 16ms? 이벤트율 5–20/s 부하 시나리오?)가 없어** 측정 자체를 생략하고 "종결"로 통과시킬 수 있다. P5-05 동일.
- → "측정"을 **필수 산출물**(부하 시나리오 + 프로파일 결과)로 정의하고, 임계 초과 시에만 적용/미초과 시 "불필요" 결론을 **측정 데이터와 함께** 기록하도록 강제.

### A3. "모놀리식 해체 완료" — 객관적 종료 조건 부재 (P4-03, P2-07)
- P4-03 `meta-docs 모놀리식 해체 완료`: 객관 지표(meta-docs-view.js/meta-docs-flow.js 라인 0 또는 삭제, import 잔여 0)가 없다.
- P2-07 `settings-view 분해+이식 완료`: settings-view.js 1590줄이 0이 되는지/삭제되는지 명시 없음.
- → "원본 파일 삭제 + 참조 0"을 종료 조건으로 명문화.

### A4. 폼 컴포넌트 목록 미열거 (P2-06, P2-07)
P2-05 가 4영역(진단/Hook/Graph DB/Proxy) 경계를 설계하지만, P2-06/07 done_criteria 는 산출 컴포넌트 수/이름을 열거하지 않아 "어디까지가 완료"인지 P2-05 산출물에 전적으로 의존. P2-05 미완 시 P2-06/07 합격 판정 불가.

### A5. "vite dev ... 동작" — 동작의 검증 방법 미명시 (P1-01)
P1-01 `vite dev(5173, ... proxy→9999)·vite build(dist/assets) 동작`. "동작"의 검증(예: `/api/*` 프록시가 9999 로 패스스루되어 200, `/events` SSE 스트림 유지)이 typecheck/test 게이트로는 커버되지 않는다(둘 다 런타임 프록시를 안 탄다). 프록시 정합은 별도 런타임 확인이 필요.

### A6. context-window.test.ts(6) 계승 귀속 약함 (P3-01)
12 테스트 중 `context-window.test.ts`(6 case)는 P3-01 에 "context-window(6) 등 차트 의존"으로만 언급. context-chart.js(M1 무소속)와의 관계상 회귀 게이트 소유가 모호. 명시 귀속 권고.

---

## 3. 양호 확인 (누락 아님)

- **12 테스트 1:1 계승**: state(14)→P1-04, date-range-storage(12)→P1-05, api(10)→P3-03, left-panel(2)→P3-02, sse(8)→P4-04, events(6)→P4-05, renderers(20 snap)→P2-04, parseToolDetail(9)→P3-05, formatters(53)·anomaly(14)→P5-01, get-date-range(20)→P2-08, context-window(6)→P3-01. **12/12 + 174 case 전수 귀속 확인.** P1-06 의 "12파일 174 pass 재현 + 거짓통과 검증" 게이트 견고.
- **api 역전(P3-03)**: Tidy First 4단계(특성화→임시어댑터 refactor→Zustand 액션 feat→역참조 0) + 9 사이트별 작은 커밋 = bisect 해상도 확보. 충분.
- **useSSE(P4-04)**: 5초 backoff·3 이벤트·Zod·언마운트 cleanup(신규 계약 Red) 명시. 충분.
- **strict 승격(P5-02)** / **가상스크롤(P5-05, 측정 선행)** / **순환 의존 0(변경 불필요 결론)**: 충분.

---

## 4. 권고 — 추가/보정 task 후보

| ID(제안) | 페이즈 | 내용 | 해소 결함 |
|----------|--------|------|-----------|
| P1-08 | 1 | innerHTML 130건 사이트별 인벤토리(파일:라인→소유 task) + 105 파일 전수 소속 매핑표 | M1, M2 |
| P3-09 | 3 | obs-panel/cache-panel/context-chart/sparkline/tool-stats/metrics-api 대시보드 뷰 → TSX 이식 | M1 |
| P4-08 | 4 | electron-builder dist 전환 + 패키지 빌드 verify | M4 |
| (Gap 추가) | — | Playwright 도입 보류/도입 결정 + 수동 verify 자동화 연결 | M5 |
| (done_criteria 보정) | 전 | 수동 verify 합격 체크리스트+증거 / "측정" 산출물 정의 / "해체 완료"=원본 삭제+참조 0 / 구 .js 삭제 게이트 | A1~A3, M3 |
| (P5-06 보정) | 5 | 최종 게이트에 "innerHTML 잔여 0 + .js 잔여 0(전 파일 .tsx)" 추가 | M2, M3 |
