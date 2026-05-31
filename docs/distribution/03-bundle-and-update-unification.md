# spyglass 배포 마무리 — 전 의존성 번들 + Homebrew 업데이트 일원화 (설계)

> 대상: `claude-spyglass` 배포 채널. "반만 된" 배포 전략을 **단일 무과금 Homebrew Formula**로 마무리한다.
> 미션: 사용자가 `brew install spyglass` **한 번**으로 런타임·네이티브·정적자산까지 전부 받고, `brew upgrade` **하나**로 갱신되게 한다. git pull·Electron DMG·수동 라이브러리 설치 경로를 모두 제거한다.
> 선행: [`01-app-to-brew-rationale.md`](./01-app-to-brew-rationale.md)(과금 분석) · [`02-brew-improvement-plan.md`](./02-brew-improvement-plan.md)(cmux 자동화 차용).
> 구현 명세: [`tasks.json`](./tasks.json) (TaskCreate 1:1 등록용, D1~D6).
> 기준일 2026-05-31 · 루트 v3.1.0 · desktop v2.11.0.
> **이 디렉토리는 배포 작업 문서다. 본 단계에서는 구현 코드를 작성하지 않는다. React 워크트리 작업과 동시 진행하지 않는다.**

---

## 0. 검증된 현황 (착수 전 반드시 인지 — file:line 실측)

| 항목 | 실측 (2026-05-31) | 근거 |
|------|------------------|------|
| tap repo | **생성 완료** — `gmoon92/homebrew-claude-code-spyglass` (public). `brew tap gmoon92/claude-code-spyglass` 성공 | curl HTTP 200, `brew tap` Tapped 1 formula |
| 소스 repo | `gmoon92/claude-spyglass` **public**(오픈소스 유지). 배포 repo 분리는 후순위 | curl HTTP 200, visibility PUBLIC |
| release 자산 | v3.1.0(Latest)~v2.10.0 존재. `spyglass-3.1.0-darwin-{arm64,x64}.tar.gz(+.sha256)` 게시됨 | `gh release view v3.1.0` |
| Formula 동작 | tarball 실제 다운로드 성공, **sha256 placeholder만 불일치**로 install 실패. version도 2.10.0(구) | `brew install spyglass` 출력(arm64 실측 sha 779cd4…) |
| **SQLite** | `bun:sqlite` **Bun 런타임 내장** → standalone bin에 이미 번들. 수동 설치 0 | `packages/storage/src/migrator.ts:33` |
| **i18n locale (en/ja/ko/zh)** | `import ko from '../locales/ko.json'` **정적 import → bin 번들됨**. 동봉 불필요 | `packages/server/src/i18n.ts:12-15` |
| web 정적자산 | fs 서빙(`SPYGLASS_WEB_ROOT`). tarball에 **이미 동봉** | `packages/server/src/runtime/dispatch.ts:18`, `build-release-tarball.sh` |
| migrations `*.sql` | fs readdir(`SPYGLASS_MIGRATIONS_ROOT`). tarball에 **이미 동봉** | `packages/storage/src/migrator.ts:37`, `build-release-tarball.sh` |
| **LadybugDB native** | `@ladybugdb/core` `lbugjs.node`. `await import('@ladybugdb/core')` **런타임 lazy import**. tarball **미동봉** → graph `off` 폴백 | `packages/storage-graph/src/client.ts:120`, `build-release-tarball.sh`(native 단계 없음) |
| native 전수 | 런타임 필요 native = **`@ladybugdb/core` 하나뿐**. `iconv-corefoundation`은 electron-builder(빌드도구)용 | `find … -name '*.node'` |
| 자원 경로 env | `SPYGLASS_WEB_ROOT` + `SPYGLASS_MIGRATIONS_ROOT` **2개뿐**(locale용 _ROOT 없음=번들 확정) | `grep SPYGLASS_*_ROOT` |
| desktop | Electron `.app`(DMG). updateChannel `packaged`. **폐기 결정**(업데이트 일원화·무과금) | `packages/desktop/*` |
| git pull 경로 | `install.sh:118-145`(clone/pull) + `routes/version.ts:190`(`/api/update` git pull) | 〃 |
| updateChannel 분기 | `git`/`brew`/`packaged` 이미 설계. brew는 git pull 배지 숨김(단 brew 안내 배너 미구현) | `routes/version.ts:60-88`, `version-check.js:362-368` |

---

## 1. 미션 및 목표

배포를 **단일 무과금 Homebrew Formula**로 수렴한다.

1. **전 의존성 번들** — 사용자가 `brew install spyglass` 한 번으로 런타임(Bun=SQLite 포함)·네이티브(LadybugDB `.node`)·정적자산(web)·마이그레이션(`*.sql`)·i18n까지 전부 받는다. 수동 설치는 훅/프록시 설정(설정 페이지)만 남고, 라이브러리 수동 설치는 0.
2. **업데이트 일원화** — `brew upgrade spyglass` 하나로 앱+번들 라이브러리 통째 교체. git pull(`/api/update`·`install.sh`)·Electron 자체 업데이터 제거.
3. **무과금 절대 유지** — ad-hoc codesign만. Apple Developer ID·notarization·Cask·DMG 도입 금지.

> JVM 비유: `bun build --compile` = Spring Boot executable jar. native(`.node`)는 jar의 JNI native처럼 arch별 분리·동봉. `brew upgrade` = 새 fat-jar 통째 배포(의존성은 빌드 시 `bun.lock`으로 resolve).

---

## 2. 핵심 작업 원칙

### 2-1. 무과금 절대 제약 (Zero-Cost Contract)
- 어느 태스크에도 Apple Developer ID·notarization·Cask·DMG를 도입하지 않는다. native·실행파일은 ad-hoc codesign(`build-release-tarball.sh:125-128`)만.
- `spctl` 거부는 **정상**(CLI는 `.app`보다 Gatekeeper 마찰 적음). 무과금이 깨지는 변경은 즉시 중단·보고.

### 2-2. 번들 철학 (설치 한 번 = 전부)
- standalone bin에 **자동 번들되는 것**(순수 JS 의존성·SQLite·i18n locale)은 추가 작업 0.
- bin에 **못 들어가는 것**(fs 자원: web/migrations, native: `.node`)만 tarball에 동봉한다. 동봉 대상 SSoT는 §3 매트릭스.
- **LadybugDB는 필수 동봉**(사용자 확정). graph 기능이 brew 설치만으로 동작해야 한다.

### 2-3. 회귀 0 + 무인 갱신
- 머지 전/후 검증 게이트(§5) 통과 없이는 tap repo에 Formula를 push하지 않는다. sha256 불일치·placeholder push 금지.
- release tag push → tarball 게시 → Formula 자동 갱신까지 무인 파이프라인(02 §5 차용 워크플로우).

### 2-4. React 워크트리 비간섭
- web 정적자산 동봉은 **현재 `packages/web` 산출물 기준**으로 설계한다. React 전환(다른 워크트리 진행 중)이 완료되면 Vite `dist/`가 같은 동봉 자리에 들어오므로, 본 작업은 **동봉 경로 계약**만 고정하고 web 빌드 방식 변경은 건드리지 않는다(D 태스크 worktree 격리).

---

## 3. 번들 전수 매트릭스 (동봉 SSoT)

| 자원 | bin 자동 번들 | 별도 동봉 | 현재 | 조치 |
|------|:---:|:---:|------|------|
| 순수 JS 의존성 (`@anthropic-ai/sdk`·`eventsource`·`i18next`) | ✅ `bun --compile` | — | OK | 없음 |
| **SQLite** (`bun:sqlite`) | ✅ Bun 내장 | — | OK | 없음 |
| **i18n locale (en/ja/ko/zh)** | ✅ 정적 import | — | OK | 없음 ("jp" 걱정 해소) |
| web 정적자산 | ❌ | ✅ | 동봉됨 | 경로 계약 유지(React 대비) |
| migrations `*.sql` | ❌ | ✅ | 동봉됨 | 유지 |
| **LadybugDB native `lbugjs.node`** | ❌ (native) | ✅ **필수** | **미동봉** | **D2에서 동봉 신설** ★ |

→ **추가 동봉 대상은 LadybugDB native 하나.** 나머지는 자동 번들이거나 이미 동봉.

---

## 4. 페이즈 로드맵 (D1~D6 — 상세는 `tasks.json`)

| 페이즈 | 이름 | 목표 | 핵심 산출 |
|--------|------|------|----------|
| **D1** | Formula 동작 | sha256 충전 + version 동기화로 `brew install spyglass` 완전 동작 | tap repo Formula(v3.1.0, 실 sha256 2개) |
| **D2** | LadybugDB 번들 ★ | arch별 `.node` 동봉 + lazy import resolution + `GRAPH_MODE` 해제 | `build-release-tarball.sh` native 단계, Formula env |
| **D3** | 업데이트 일원화 | git pull 경로 제거(`install.sh`·`/api/update` brew 가드), web에 `brew upgrade` 안내 배너 | `version.ts`·`version-check.js`·`install.sh` |
| **D4** | release 자동화 | cmux식 `update-formula.yml` 차용(2-arch sha256 자동 갱신), matrix x64 prebuilt 확보 | `.github/workflows/update-formula.yml` |
| **D5** | desktop 폐기 | `packages/desktop`·`electron-builder`·`desktop:*` 제거, `updateChannel` packaged 분기 정리 | desktop 제거 커밋 |
| **D6** | **문서 현행화 (마지막)** | install-guide brew 1차화, README/01·02·03 정합, distribution SSoT 갱신 | 문서 일괄 |

> **D6은 반드시 마지막 태스크**다(사용자 규칙). 모든 구현 완료 후 문서를 현행화하고 태스크 보드를 닫는다.

의존: D1 → (D2 ∥ D3 ∥ D4) → D5 → **D6**. D2·D3·D4는 서로 독립 트랙(worktree 병렬 가능), D5는 D3(updateChannel 정리) 이후, D6은 전부 이후.

---

## 5. 안전성 전략

- **worktree 격리**: 모든 구현은 `git worktree`(`wt-d2-ladybug` 등). 메인·React 워크트리 불가침. 사용자 동시작업 감지 시 즉시 중단·보고.
- **검증 게이트(머지 전/후)**:
  1. `bun test` 전량 통과(회귀 0).
  2. `bun run typecheck` 에러 증분 0.
  3. `bash .claude/skills/detect-architecture-violation/scripts/check-architecture.sh` 통과.
  4. **배포 스모크**: `./scripts/build-release-tarball.sh` 산출 → 로컬 `brew install --formula <path>` 또는 tarball 압축해제 후 `spyglass status`/`/health`·`/api/graph/status`(D2 후 graph 동작) 확인.
- **무과금 가드**: 변경 후 `codesign -dv`로 ad-hoc 유지 확인. Developer ID 서명 명령이 추가되면 차단.
- **Tidy First**: 구조 변경(`refactor:`)과 동작 변경(`feat:`) 커밋 분리. bisect 해상도 보존.

---

## 6. 미결 Gap (휴먼 검증 포인트 — 임의 추측 구현 금지)

`.distribution-gap-report.md`로 남기고 결정한다:

1. **LadybugDB resolution 방식(D2 핵심)**: standalone bin엔 `node_modules` 없음 → `client.ts:120`의 `import('@ladybugdb/core')`가 동봉 `.node`를 못 찾음. 두 안 중 택1 —
   - **(a) Formula wrapper `NODE_PATH` 주입** — `spyglass.rb` `write_env_script`에 동봉 native 경로 추가. client 코드 무수정.
   - **(b) `client.ts` env 경로 로드** — `SPYGLASS_GRAPH_NATIVE_ROOT`에서 직접 로드하도록 lazy import 수정.
   - electron-builder의 extraResources+`process.resourcesPath` 패턴(검증됨)을 tarball에 이식. 권고: (a) 우선(코드 무수정).
2. **x64 prebuilt 확보(D2·D4)**: 로컬엔 arm64 prebuilt만 존재. release matrix x64 runner(또는 크로스)가 `@ladybugdb/core-darwin-x64`를 확보해야 x64 tarball에 동봉 가능.
3. **GRAPH_MODE 기본값(D2)**: Formula의 `SPYGLASS_GRAPH_MODE=off` → `shadow`(기본) 승격. native 동봉 후에도 회로차단기 폴백이 사용자 영향 0 보장하는지 검증.
4. **React 워크트리 web 빌드 접합(D2·D6)**: 현재 `packages/web` 동봉 → React 완료 시 Vite `dist/`. 동봉 경로 계약만 고정, 전환은 React 트랙 머지 후.
5. **version SSoT(D1·D4)**: Formula `version`·release tag·`package.json`·`SPYGLASS_APP_VERSION` 정합. update-formula.yml이 tag에서 일괄 주입.

---

## 7. 에이전트/스킬 할당 (메타 문서 기반 — 상세는 `tasks.json` owner)

| 페이즈 | 주담당 | 보조/검증 |
|--------|--------|----------|
| D1 Formula sha256 | `backend-agent` | `commit` 스킬 |
| D2 LadybugDB 번들 | `backend-agent` | `architecture-guard`·`scan-sensitive-at-rest`(native 권한) |
| D3 업데이트 일원화 | `backend-agent` | `refactoring-expert`(git pull 제거 Tidy) |
| D4 release 자동화 | `backend-agent` | `dependency-analyst`(workflow 영향) |
| D5 desktop 폐기 | `backend-agent` | `architecture-guard`·`detect-architecture-violation` |
| **D6 문서 현행화** | `doc-enricher` | `commit` 스킬 |

> spyglass 로컬 스킬: `architecture-guard`·`refactoring-expert`·`scan-sensitive-at-rest`·`detect-architecture-violation`·`commit`(`.claude/skills/`). `backend-agent`·`doc-enricher`·`dependency-analyst`는 claude-code-system 에이전트.

---

## 참조

- [`01-app-to-brew-rationale.md`](./01-app-to-brew-rationale.md) · [`02-brew-improvement-plan.md`](./02-brew-improvement-plan.md) · [`tasks.json`](./tasks.json)
- `scripts/build-release-tarball.sh` · `tap-template/Formula/spyglass.rb` · `.github/workflows/release.yml`
- `packages/storage-graph/src/client.ts`(native lazy import) · `packages/desktop/electron-builder.yml`(extraResources 패턴 참고)
- cmux: `cmux/.github/workflows/update-homebrew.yml`(차용 원본) · `cmux/scripts/sign-cmux-bundle.sh`(과금 노선 — 미차용)

---

*Generated by Claude Code (Opus 4.8) — 배포 마무리 설계. 구현은 `tasks.json` 기반 승인 후. 기준일 2026-05-31.*
