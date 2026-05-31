# 배포 작업 로그 (feat/distribution-brew)

> **목적**: 배포 마무리 작업의 착수 전/완료 후 상태를 태스크 단위로 기록한다. React 변환 작업(다른 세션)이 끝난 뒤 **사용자가 직접 머지**할 때, 본 로그 + 커밋 메시지가 통합 근거가 된다.
> **SSoT**: 설계 [`03-bundle-and-update-unification.md`](./03-bundle-and-update-unification.md) · 구현 명세 [`tasks.json`](./tasks.json).

---

## 운영 정책

- **워크트리**: `claude-spyglass-dist` (브랜치 `feat/distribution-brew`, main `e1f8266` 기준 분기).
- **격리**: React 워크트리(`claude-spyglass-rm`, `feat/react-migration`, `420c69a`)와 독립. 동시 진행, 상호 불가침.
- **머지 정책**: 본 세션은 **push·머지하지 않는다**. React 작업 종료 후 사용자가 직접 통합한다.
- **기록 원칙**: 모든 태스크 **착수 전 / 완료 후** 본 로그에 기록 + 커밋. 커밋 prefix(`feat:`/`refactor:`/`docs:`)로 bisect 회귀 유형 식별. Tidy First(구조/동작 커밋 분리).

## Baseline (착수 시점 2026-05-31)

| 항목 | 값 |
|------|-----|
| main HEAD | `e1f8266` · v3.1.0 |
| tap repo | `gmoon92/homebrew-claude-code-spyglass` (생성 완료, Formula sha256 placeholder) |
| release 자산 | v3.1.0 `spyglass-3.1.0-darwin-{arm64,x64}.tar.gz(+.sha256)` 존재 |
| 번들 현황 | SQLite·i18n locale = bin 내장 / web·migrations = 동봉됨 / **LadybugDB native = 미동봉(D2 대상)** |
| desktop | Electron DMG (폐기 대상 D5) |

## 머지 통합 가이드 (React 작업 후 — 충돌 예상 지점)

> React 변환으로 `packages/web` 구조·소스가 대폭 달라질 가능성이 크다. 머지 시 아래를 우선 재확인.

| 영역 | 충돌 위험 | 비고 |
|------|:---:|------|
| `tap-template/` · `.github/workflows/` · `scripts/build-release-tarball.sh` · `scripts/install.sh` | **낮음** | React가 건드리지 않는 배포 인프라 |
| `packages/web/assets/js/version-check.js` (D3-04 배너) | **높음** | React가 web 전면 재작성 → D3-04는 **React 머지 후 재구현 권장**(본 워크트리에선 보류 가능) |
| `build-release-tarball.sh` web staging 경로 (D2) | **중** | 현재 `packages/web` → React 후 Vite `dist/`. **동봉 경로 계약만 고정**, 빌드 방식 전환은 React 트랙 |
| `packages/server/src/routes/version.ts` (D3-02) | **낮음** | React는 백엔드 무수정 — 충돌 가능성 낮음 |
| `packages/desktop` 제거 (D5) | **낮음** | React 무관 |

---

## 작업 로그

### [착수] 2026-05-31 · 워크트리 셋업 + 설계 문서 이관
- `feat/distribution-brew` 워크트리 생성(main 기준).
- main의 미커밋 설계 문서 5종(`docs/distribution/01~03`, `tasks.json`, `README`) + `tap-template/Formula/spyglass.rb`(tap 이름 `claude-code-spyglass` 반영)를 워크트리로 이관. main 워킹트리 원복(배포 변경 0).
- 본 `work-log.md` 신설.
- **커밋(예정)**: `docs(distribution): 배포 마무리 설계·tasks·작업로그 착수`

### D1 — Formula 동작 · ✅ 완료 (2026-05-31)
**착수 전**: Formula version `2.10.0`, sha256 placeholder, `on_linux` 4타겟(release는 macOS 전용이라 불일치). `brew install` sha 불일치로 실패.
**변경** (`tap-template/Formula/spyglass.rb`):
- version `2.10.0`→`3.1.0`
- darwin arm64 sha256 `3f11aed5…`, x64 `3e636141…` (v3.1.0 release 자산 `.sha256` 기준)
- `on_linux` 블록 제거 + 헤더 주석 macOS 전용 정합(`e1f8266`)
**tap repo**: `gmoon92/homebrew-claude-code-spyglass` `2a19fa0` push — **수동 1회**(D4 `update-formula.yml` 자동화 대상). git push는 `gh auth setup-git`(git credential helper를 gh 토큰으로)로 인증.
**검증(D1-02)**: `brew install spyglass`→`Cellar/spyglass/3.1.0` ✅ · `spyglass status` 실행 ✅ · `codesign -dv`: `Signature=adhoc`·`TeamIdentifier=not set`(무과금) ✅ · `spctl` rejected(ad-hoc 정상).
**머지 주의**: `tap-template/Formula`는 React 무관(충돌 없음). tap repo는 별도 repo라 머지 대상 아님.
**커밋**: (아래 워크트리 커밋)

### D2 — LadybugDB 번들 · ✅ 완료 (2026-05-31, 필수)
**resolution 결정**: (a) NODE_PATH (gap-report D2-01). PoC — standalone bin이 `NODE_PATH`로 `@ladybugdb/core` 로드 성공(Connection/Database API 노출), 미설정 시 "Cannot find module". client.ts 무수정.
**변경**:
- `scripts/build-release-tarball.sh`: migrations 다음에 native staging — arch별 `@ladybugdb/core` + `core-${OS}-${ARCH}` → `share/spyglass/native/node_modules/@ladybugdb` (`cp -RL` .bun 캐시).
- `tap-template/Formula/spyglass.rb`: `write_env_script`에 `NODE_PATH=share/spyglass/native/node_modules`, `SPYGLASS_GRAPH_MODE` `off`→`shadow`, 헤더/install 주석 정합.
- `.distribution-gap-report.md`: D2-01 결정 기록.
**빌드 검증**: `./scripts/build-release-tarball.sh --arch arm64` → `native staged: core core-darwin-arm64`, tarball 31M(native 포함).
**graph 스모크**: 격리 serve(port 9988·임시 HOME·GRAPH_MODE=shadow·NODE_PATH 주입) → `/health` ok, `/api/graph/status` mode=shadow·circuit CLOSED·sync running, `[graph-sync] worker starting`. native 로드·projection 동작 확인.
**⚠️ 함정 기록**: `--skip-codesign` 빌드 bin은 불완전 서명(flags=runtime, non-adhoc)이라 macOS가 SIGKILL(출력·로그 0, 즉시 종료). `codesign --sign -` ad-hoc 재서명 후 정상. **실제 release.yml/build script 정상 경로는 ad-hoc codesign 포함이라 무영향** — 로컬 검증 시 `--skip-codesign` 주의.
**머지 주의**: build script·Formula·client.ts(무수정) 모두 React 무관. native 동봉은 `packages/web`과 독립.
**커밋**: (아래)

### D3~D6 — ⏸ 보류 (사용자 결정 2026-05-31)
**상태: 미착수.** React 변환 작업(`feat/react-migration`) 우선 진행 → **종료 후 사용자 요청 시 재개**. 본 워크트리는 D1·D2 커밋 상태로 대기.
- **D3-01~03** (`install.sh` git clone 격하 · `/api/update` brew 가드 · `version-checker` 정합): React 무관 파일 → 머지 충돌 0. 재개 시 우선.
- **D3-04** (`version-check.js` brew 배너): React가 `packages/web` 재작성 → 머지 충돌+재작업 위험. **React 머지 후** 진행.
- **D4** release 자동화(`update-formula.yml`) · **D5** desktop 폐기 · **D6** 문서 현행화: 재개 시 진행.

<!-- 이후 태스크(D2 ~ D6) 진행 시 본 로그에 동일 형식으로 추가 -->
