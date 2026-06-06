# spyglass 배포 전략 (Distribution Strategy)

> **범위**: `claude-spyglass` 배포 채널 전환 배경·현황·완성 계획  
> **형식**: Homebrew **Formula** (CLI standalone bin). Cask 아님  
> **서명**: **ad-hoc codesign** 만 — Apple Developer ID·notarization 미적용 = **과금 0원**  
> **기준일**: 2026-05-31 · 루트 v3.1.0 · desktop v2.11.0

---

## 1. 전환 배경 — 앱(Electron DMG) → Homebrew

### 1.1 "앱 배포"의 정체

`packages/desktop`은 Bun 서버 + 웹 대시보드를 macOS 네이티브 셸로 감싼 **Electron 42.x 데스크톱 앱**이다.

| 항목 | 근거 |
|------|------|
| Electron 42.x DMG 셸 | `packages/desktop/package.json` (`electron: ^42.2.0`, `build:mac → electron-builder --mac dmg`) |
| 패키징 설정 | `packages/desktop/electron-builder.yml` (`appId: com.spyglass.desktop`, `mac.target: dmg` arm64/x64) |
| 동봉 방식 | `bun build --compile` standalone bin을 `extraResources`로 동봉, child로 spawn (`server-process.js`) |
| 자동 업데이트 | `packages/desktop/src/main/auto-updater.js` (GitHub Releases API 폴리 기반 알림) |

Electron 앱은 커밋 `30cda7f`(2026-05-25, v2.10.0)에서 "Local agent mode"로 처음 도입됐고, 같은 커밋에서 Homebrew "Headless mode"도 함께 구축됐다. 처음부터 **brew가 recommended**였다.

### 1.2 "과금"의 정체 — Apple Developer Program 연 \$99

Electron DMG를 macOS에 정상 배포하려면 Apple Developer ID 코드 서명이 사실상 필수다. 이 인증서는 **Apple Developer Program 연 \$99 유료 멤버십**으로만 발급된다.

**현재 상태**:
- `electron-builder.yml`은 코드 서명을 명시적으로 비활성화: `mac.identity: null`, `hardenedRuntime: false`, `gatekeeperAssess: false`.
- 미서명 DMG는 Gatekeeper가 차단하므로, 사용자가 `xattr -cr /Applications/Claude\ Spyglass.app`을 수동 실행해야 한다.
- `auto-updater.js` 주석: *"electron-updater 는 macOS 에서 Apple Developer ID 코드 서명이 필수다. 서명을 적용하지 않은 현 상태에서는 무제로 동작하는 반자동 방식을 채택"*. 따라서 desktop은 반자동 방식(GitHub Releases API 조회 → 알림 → 수동 DMG 교체)으로 다운그레이드됐다.

| 항목 | 미서명(현재) | 정식 서명 |
|------|-------------|----------|
| 비용 | \$0 | **Apple Developer Program 연 \$99** |
| Gatekeeper | 차단/경고 → 사용자 `xattr -cr` 수동 | 통과 |
| notarization | 없음 | 필요(Apple 공증 서버 제출) |
| 자동 업데이트 | 반자동(수동 DMG 교체) | electron-updater 완전 자동 |

→ 이 딜레마가 **brew 전환의 동기**다.

### 1.3 Homebrew 배포가 과금을 회피하는 방식

| 메커니즘 | 근거 | 효과 |
|----------|------|------|
| **ad-hoc codesign** | `scripts/build-release-tarball.sh` (`codesign --sign - --force --options runtime`) | Developer ID 불필요 = **연 과금 0** |
| **standalone bin** | Formula `spyglass.rb`: *"동봉된 standalone bin 안에 Bun 런타임이 포함 → depends_on \"bun\" 불필요"* | 시스템 Bun 설치 불필요 |
| **tarball + GitHub Release** | `release.yml` → `build-release-tarball.sh` → `tar.gz` + `sha256` 업로드 | 호스팅 비용 0(GitHub Release 무제) |
| **brew services** | `spyglass.rb` `service do ... run [opt_bin/spyglass, serve]` | launchd 자동시작, 코드서명 무관 |
| **brew upgrade** | `spyglass.rb`: *"auto-update 는 `brew upgrade` 가 canonical"* | electron-updater 대체 |

**사용자 설치 흐름**:

```bash
brew tap gmoon92/claude-code-spyglass
brew install spyglass
brew services start spyglass   # 로그인 시 자동 시작
spyglass open
brew upgrade spyglass          # 업데이트
```

---

## 2. cmux 자동화 차용 매트릭스

cmux(`manaflow-ai/cmux`)는 네이티브 앱을 **Cask + DMG + Developer ID 서명(\$99)**으로 배포한다. spyglass는 그중 **자동화 골격만** 가져온다.

| cmux 요소 | spyglass 적용 | 비고 |
|-----------|--------------|------|
| `update-homebrew.yml` — release 완료 후 `workflow_run` 트리거로 tap 정의 자동 갱신 | ✅ **차용** | Formula 자동 갱신 워크플로우로 적응 |
| 커스텀 스크립트로 brew 정의 **전체 재생성**(heredoc) + SHA256 직접 계산 | ✅ **차용** | `mislav` action의 "단일 url" 한계를 우회 |
| SHA 검증 단계(다운로드 자산 vs 정의 일치) 후 commit·push | ✅ **차용** | placeholder 오게시 방지 |
| tap repo를 **git submodule**로 본 repo에 포함 | ✅ **차용** | `homebrew-claude-code-spyglass` submodule |
| `HOMEBREW_TAP_TOKEN` PAT로 tap repo push | ✅ **차용** | tap-template/README가 이미 요구 |
| **Cask**(`brew install --cask`) + `app "cmux.app"` | ❌ **미차용** | Formula(CLI bin) 유지 |
| **DMG** 빌드·`create-dmg` | ❌ **미차용** | tarball(`build-release-tarball.sh`) 유지 |
| **Developer ID 서명 + notarization** | ❌ **미차용** | 과금. ad-hoc codesign 유지 |
| **Sparkle** appcast 자동 업데이트 | ❌ **미차용** | `brew upgrade`가 canonical |

> "release 후 → 자산 SHA 계산 → tap repo의 brew 정의를 스크립트로 재생성·검증·push" 라는 **무인 갱신 파이프라인**만 가져오고, 산출물을 DMG/Cask → tarball/Formula 로 바꾼다.

---

## 3. 번들 전수 매트릭스 (동봉 SSoT)

| 자원 | bin 자동 번들 | 별도 동봉 | 현재 | 조치 |
|------|:---:|:---:|------|------|
| 순수 JS 의존성 (`@anthropic-ai/sdk`·`eventsource`·`i18next`) | ✅ `bun --compile` | — | OK | 없음 |
| **SQLite** (`bun:sqlite`) | ✅ Bun 내장 | — | OK | 없음 |
| **i18n locale (en/ja/ko/zh)** | ✅ 정적 import | — | OK | 없음 |
| web 정적자산 | ❌ | ✅ | 동봉됨 | 경로 계약 유지(React 대비) |
| migrations `*.sql` | ❌ | ✅ | 동봉됨 | 유지 |
| **LadybugDB native `lbugjs.node`** | ❌ (native) | ✅ **필수** | **미동봉** | **D2에서 동봉 신설** |

→ **추가 동봉 대상은 LadybugDB native 하나.** 나머지는 자동 번들이거나 이미 동봉.

**LadybugDB native resolution** (D2-01 결정):
- **(a) Formula wrapper `NODE_PATH` 주입** 채택. `client.ts` 무수정.
- PoC(2026-05-31, darwin-arm64)로 standalone bin이 `NODE_PATH`로 `@ladybugdb/core` 로드 성공 확인.
- 동봉 구조: `share/spyglass/native/node_modules/@ladybugdb/{core, core-darwin-<arch>}`

---

## 4. 페이즈 로드맵 (D1~D6)

| 페이즈 | 이름 | 목표 | 핵심 산출 | 상태 |
|--------|------|------|----------|:----:|
| **D1** | Formula 동작 | sha256 충전 + version 동기화로 `brew install spyglass` 완전 동작 | tap repo Formula(v3.1.0, 실 sha256 2개) | ✅ 완료 |
| **D2** | LadybugDB 번들 | arch별 `.node` 동봉 + lazy import resolution + `GRAPH_MODE` 해제 | `build-release-tarball.sh` native 단계, Formula env | ✅ 완료 |
| **D3** | 업데이트 일원화 | git pull 경로 제거(`install.sh`·`/api/update` brew 가드), web에 `brew upgrade` 안내 배너 | `version.ts`·`version-check.js`·`install.sh` | ⏸ 보류 |
| **D4** | release 자동화 | cmux식 `update-formula.yml` 차용(2-arch sha256 자동 갱신), matrix x64 prebuilt 확보 | `.github/workflows/update-formula.yml` | ⏸ 보류 |
| **D5** | desktop 폐기 | `packages/desktop`·`electron-builder`·`desktop:*` 제거, `updateChannel` packaged 분기 정리 | desktop 제거 커밋 | ⏸ 보류 |
| **D6** | **문서 현행화 (마지막)** | install-guide brew 1차화, README/배포문서 정합, distribution SSoT 갱신 | 문서 일괄 | ⏸ 보류 |

**의존**: D1 → (D2 ∥ D3 ∥ D4) → D5 → **D6**.  
**재개 트리거**: 사용자 요청. D3-01~03·D4·D5는 React 무관이라 React 머지 전에도 가능하나, D6(문서)·`build-release-tarball.sh` web staging은 React 최종 구조 확정 후가 정확하다.

### 4.1 완료 상세 (D1·D2)

**D1 — Formula 동작**:
- `tap-template/Formula/spyglass.rb`: version `2.10.0`→`3.1.0`, darwin arm64/x64 실 sha256 충전, `on_linux` 제거.
- tap repo `gmoon92/homebrew-claude-code-spyglass`에 Formula v3.1.0 push 완료.
- 검증: `brew install spyglass` → `Cellar/spyglass/3.1.0` ✅, `codesign -dv`: `Signature=adhoc`·`TeamIdentifier=not set`(무과금) ✅.

**D2 — LadybugDB 번동**:
- `scripts/build-release-tarball.sh`: arch별 `@ladybugdb/core`+`core-darwin-<arch>`를 `share/spyglass/native/node_modules`에 동봉.
- `tap-template/Formula/spyglass.rb`: `write_env_script`에 `NODE_PATH` 주입 + `SPYGLASS_GRAPH_MODE` `off`→`shadow`.
- 빌드 검증: `./scripts/build-release-tarball.sh --arch arm64` → tarball 31M(native 포함).
- graph 스모크: `/api/graph/status` mode=shadow·circuit CLOSED·sync running ✅.

---

## 5. 배포 시나리오 매트릭스 (brew Formula 기준)

| 시나리오 | 명령 | 비고 |
|---------|------|------|
| **설치** | `brew tap gmoon92/claude-code-spyglass && brew install spyglass` | standalone bin(Bun 내장), 시스템 Bun 불필요 |
| **수동 실행** | `spyglass start && spyglass open` | detached 백그라운드 데몬 |
| **자동 시작** | `brew services start spyglass` | launchd → `spyglass serve`(foreground). `spyglass.rb` `service do` |
| **상태/중지** | `spyglass status` / `spyglass stop` / `brew services stop spyglass` | 포트(9999) LISTEN 기준 |
| **업데이트** | `brew upgrade spyglass` | canonical. electron-updater 대체 |
| **제거** | `brew uninstall spyglass` (+ `rm -rf ~/.spyglass` 선택) | 데이터는 `~/.spyglass`에 잔존 |
| **Gatekeeper** | ad-hoc 서명 — CLI는 `.app`보다 마찰 적음 | `spctl` 거부는 정상, 무과금 전제 |
| **데이터 경로** | `~/.spyglass/` (Formula env 주입: `SPYGLASS_WEB_ROOT`/`SPYGLASS_MIGRATIONS_ROOT`) | 로컬/데몬/Docker와 동일 |

---

## 6. 안전성 전략

- **worktree 격리**: 모든 구현은 `git worktree`(`wt-d2-ladybug` 등). 메인·React 워크트리 불가침.
- **검증 게이트(머지 전/후)**:
  1. `bun test` 전량 통과(회귀 0).
  2. `bun run typecheck` 에러 증분 0.
  3. `bash .claude/skills/detect-architecture-violation/scripts/check-architecture.sh` 통과.
  4. **배포 스모크**: `./scripts/build-release-tarball.sh` 산출 → 로컬 `brew install --formula <path>` 또는 tarball 압축해제 후 `spyglass status`/`/health`·`/api/graph/status`(D2 후 graph 동작) 확인.
- **무과금 가드**: 변경 후 `codesign -dv`로 ad-hoc 유지 확인. Developer ID 서명 명령이 추가되면 차단.
- **Tidy First**: 구조 변경(`refactor:`)과 동작 변경(`feat:`) 커밋 분리. bisect 해상도 보존.

---

## 7. 리스크 & 무과금 보장 체크리스트

- [ ] **무과금** — 어느 단계에도 Apple Developer ID·notarization·Cask·DMG 도입 금지. ad-hoc codesign만.
- [ ] **arm64 회귀 0** — Formula 재생성이 darwin-arm64 url/이름(`spyglass-<v>-darwin-arm64.tar.gz`)을 깨지 않을 것(`release.yml` 산출물 이름 의존).
- [ ] **pre-release 격리** — `-rc` tag는 tap 갱신 skip(stable 사용자에 RC 미노출).
- [ ] **SHA 검증** — placeholder/불일치 Formula가 push되지 않도록 대조 단계 필수.
- [ ] **PAT 스코프** — `HOMEBREW_TAP_TOKEN`은 tap repo에 한정(최소 권한).

---

## 8. 참조

- [`docs/architecture/deployment.md`](./deployment.md) — 로컬/데몬/Docker 배포 시나리오(brew와 교차 링크)
- `scripts/build-release-tarball.sh` — tarball + ad-hoc codesign 산출
- `tap-template/Formula/spyglass.rb` — Formula 본체
- `.github/workflows/release.yml` — 현재 tarball 게시
- `packages/storage-graph/src/client.ts` — native lazy import
- `packages/desktop/electron-builder.yml` — extraResources 패턴 참고
- cmux 레퍼런스: `cmux/.github/workflows/update-homebrew.yml`(차용 원본) · `cmux/scripts/sign-cmux-bundle.sh`(과금 노선 — 미차용)

---

*Generated by Claude Code — 소스 직접 Read 기반. 기준일 2026-05-31.*
