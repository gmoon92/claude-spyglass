# spyglass 배포 개선 계획 — Homebrew Formula(무과금) 완성 + cmux 자동화 차용

> **목표**: Electron DMG(앱) 배포 의존을 끊고, **standalone Bun bin을 Homebrew Formula로 배포하는 무과금 노선**을 완성한다. cmux의 brew 자동화 패턴을 **차용(adapt)**하되, 과금을 유발하는 요소(Cask·DMG·Apple Developer ID 서명·notarization)는 **차용하지 않는다**.
> **선행 문서**: [`01-app-to-brew-rationale.md`](./01-app-to-brew-rationale.md) — 왜 앱 배포가 아니라 brew인가(과금 분석).
> **레퍼런스**: `manaflow-ai/cmux` (`/Users/.../IdeaProjects/cmux`) — brew 배포 자동화 원본.
> **기준일**: 2026-05-31 / 루트 v3.1.0 / desktop v2.11.0

---

## 0. 결정 사항 (사용자 확정)

| 항목 | 결정 |
|------|------|
| 배포 형식 | **Homebrew Formula** (CLI standalone bin). Cask 아님 |
| 서명 | **ad-hoc codesign 만** (무과금). Apple Developer ID·notarization 미적용 |
| cmux 활용 | **차용(adapt)** — 자동화 패턴만. 그대로 복사 금지 |
| 과금 | **0원** 유지가 절대 제약 |

---

## 1. cmux 차용 매트릭스

cmux(`manaflow-ai/cmux`)는 네이티브 앱을 **Cask + DMG + Developer ID 서명($99)**으로 배포한다. spyglass는 그중 **자동화 골격만** 가져온다.

| cmux 요소 | 근거 | spyglass 적용 |
|-----------|------|--------------|
| `update-homebrew.yml` — release 완료 후 `workflow_run` 트리거로 tap 정의 자동 갱신 | `.github/workflows/update-homebrew.yml:6-8` | ✅ **차용** — Formula 자동 갱신 워크플로우로 적응 |
| 커스텀 스크립트로 brew 정의 **전체 재생성**(heredoc) + SHA256 직접 계산 | 같은 파일 `:91-120` | ✅ **차용** — `mislav` action의 "단일 url" 한계를 우회(아래 §3) |
| SHA 검증 단계(다운로드 자산 vs 정의 일치) 후 commit·push | 같은 파일 `:122-147` | ✅ **차용** — placeholder 오게시 방지 |
| tap repo를 **git submodule**로 본 repo에 포함 | `cmux/.gitmodules` (`homebrew-cmux`) | ✅ **차용** — `homebrew-claude-code-spyglass` submodule |
| `HOMEBREW_TAP_TOKEN` PAT로 tap repo push | 같은 파일 `:83` | ✅ **차용** — tap-template/README가 이미 요구 |
| **Cask**(`brew install --cask`) + `app "cmux.app"` | `update-homebrew.yml:93-117` | ❌ **차용 안 함** — Formula(CLI bin) 유지 |
| **DMG** 빌드·`create-dmg` | `scripts/build-sign-upload.sh` | ❌ **차용 안 함** — tarball(`build-release-tarball.sh`) 유지 |
| **Developer ID 서명 + notarization** | `scripts/sign-cmux-bundle.sh` (`Developer ID Application: Manaflow, Inc.`) | ❌ **차용 안 함** — 과금. ad-hoc codesign 유지 |
| **Sparkle** appcast 자동 업데이트 | `release.yml` R2 appcast 업로드 | ❌ **차용 안 함** — `brew upgrade`가 canonical |

> **한 줄 요약**: "release 후 → 자산 SHA 계산 → tap repo의 brew 정의를 스크립트로 재생성·검증·push" 라는 **무인 갱신 파이프라인**만 가져오고, 그 파이프라인이 다루는 산출물을 DMG/Cask → tarball/Formula 로 바꾼다.

---

## 2. 현재 갭

[`01-app-to-brew-rationale.md`](./01-app-to-brew-rationale.md) §5~6에서 식별된, brew 배포 완성까지 끊긴 연결고리:

1. **tap repo 부재** — `gmoon92/homebrew-claude-code-spyglass`가 아직 없다. 이 때문에 `af3c959`에서 bump 잡이 제거됨(`release.yml` diff 근거).
2. **Formula sha256 placeholder** — `tap-template/Formula/spyglass.rb`의 `REPLACE_WITH_*_SHA256` 미충전 → `brew install` 실패.
3. **자동 갱신 잡 부재** — release.yml은 tarball을 GitHub Release에 게시까지만. tag push 후 Formula가 자동으로 갱신되지 않는다.
4. **install-guide.md 미현행화** — 아직 `git clone` 방식만 1차 안내. brew 절 없음.
5. **배포 시나리오 미정리** — 프로세스 방향(Formula+무과금)은 잡혔으나, 사용자 머신 기준 **설치/실행/업데이트/제거/포트·서비스** 시나리오가 한 곳에 정리돼 있지 않다. (§6에서 정리)

---

## 3. 핵심 설계 결정 — cmux 커스텀 스크립트 방식 채택

**문제**: spyglass Formula는 macOS 2타겟(darwin-arm64 + darwin-x64) 각각의 `sha256`을 가진다(`spyglass.rb` `on_arm`/`on_intel`). 그런데 과거 spyglass가 쓰던 `mislav/bump-homebrew-formula-action`은 **단일 download-url의 url+sha256만 패치**한다(제거된 잡 주석 근거: "darwin-arm64 만 자동 bump 되고 … 나머지 placeholder 는 수동 갱신"). → arm64만 자동, x64는 매 릴리스마다 수동.

**해결**: cmux의 **커스텀 스크립트 방식**을 차용한다. cmux처럼 release 산출물의 SHA256을 워크플로우에서 직접 계산하고, Formula 전체를 스크립트로 재생성하면 **2개 arch sha256을 한 번에** 채울 수 있다. `mislav` action 의존을 버리는 것이 차용의 핵심 가치다.

| 방식 | 다중 arch sha256 | 검증 | spyglass 적합성 |
|------|----------------|------|----------------|
| `mislav/bump-homebrew-formula-action` (구) | ❌ 단일 url만 → arm64만 자동 | action 내부 | ✗ x64 수동 잔존 |
| **cmux식 커스텀 스크립트 (차용)** | ✅ arch별 SHA 계산·주입 | 명시적 SHA 대조 단계 | ✓ 2-arch 완전 자동 |

---

## 4. 단계별 실행 계획

> 각 단계는 독립 커밋. Phase 1~2는 1회성 부트스트랩, Phase 3~4가 자동화·문서 본체.

### Phase 1 — tap repo 부트스트랩 *(예상 20분)*
- `gmoon92/homebrew-claude-code-spyglass` public repo 생성 (`tap-template/README.md` §1~2 절차).
- `tap-template/Formula/spyglass.rb`·`README.md`를 초기 콘텐츠로 push.
- 본 repo에 submodule 등록: `git submodule add https://github.com/gmoon92/homebrew-claude-code-spyglass.git homebrew-claude-code-spyglass` (cmux `.gitmodules` 구조 차용).
- **산출물**: tap repo + `.gitmodules` 항목.
- **검증**: `brew tap gmoon92/claude-code-spyglass` 성공(Formula sha256은 아직 placeholder라 install은 미검증).

### Phase 2 — 첫 릴리스 + sha256 1회 충전 *(예상 30분)*
- `git tag v3.1.1 && git push origin v3.1.1` → 현재 `release.yml`이 darwin arm64/x64 tarball + `.sha256`을 GitHub Release에 게시.
- 게시된 `*.tar.gz.sha256` 2개 값을 `spyglass.rb`의 `REPLACE_WITH_ARM64_SHA256` / `REPLACE_WITH_DARWIN_X64_SHA256`에 수기 반영 후 tap repo push.
- **산출물**: 설치 가능한 첫 Formula.
- **검증**: `brew install spyglass && spyglass status` 정상. `spctl`은 ad-hoc이라 거부가 정상(무과금 전제 확인).

### Phase 3 — Formula 자동 갱신 워크플로우 차용 *(예상 1.5시간)* ★핵심
- cmux `update-homebrew.yml`을 spyglass용으로 적응한 `update-formula.yml` 신설(§5 골격).
- 기존 `release` 워크플로우 완료 후 `workflow_run`으로 트리거.
- darwin arm64/x64 tarball 다운로드 → 각 SHA256 계산 → `spyglass.rb` 재생성(2-arch 주입) → SHA 대조 → tap repo commit·push.
- `HOMEBREW_TAP_TOKEN` secret 등록.
- pre-release(`-rc` 등) tag는 skip(cmux의 semver 검증 분기 차용).
- **산출물**: tag push만으로 Formula까지 자동 갱신되는 무인 파이프라인.
- **검증**: 다음 tag push 시 tap repo에 자동 커밋 생성 + `brew upgrade spyglass` 동작.

### Phase 4 — install-guide.md 현행화 *(예상 40분)*
- 1차 설치 경로를 **brew**로 교체: `brew tap`/`brew install`/`brew services start`/`spyglass open`/`brew upgrade`.
- 현재 git clone 절은 **"From source (contributors)"**로 격하(README와 동일 구조).
- ad-hoc 서명 안내(`spctl` 거부는 정상, 필요 시 안내 문구) 명시.
- **산출물**: README ↔ install-guide 정합.
- **검증**: 문서 링크·명령 실제 실행 확인.

### Phase 5 — 배포 시나리오 정리 *(예상 40분)*
- §6의 시나리오 매트릭스를 `docs/distribution/`에 정식 문서로 확정(미완성분 마감).
- `docs/architecture/deployment.md`의 로컬/데몬/Docker 시나리오와 **brew 설치 시나리오**를 교차 링크.
- **산출물**: 설치~제거 전 구간 시나리오 문서.

### Phase 6 (선택) — desktop 노선 정리 *(예상 30분, 의사결정 필요)*
- `packages/desktop`(Electron) 유지/deprecate 결정.
- 유지 시: README 2순위로 두되 "미서명·`xattr -cr` 필요" 명시.
- deprecate 시: `desktop:*` 스크립트·`electron-builder.yml` 제거, README 2순위 삭제.
- **미확인** — 공식 중단 결정 문서 없음(01 문서 §8). 사용자 결정 대기.

**총 예상 소요**: Phase 1~5 약 4시간(부트스트랩 + 자동화 + 문서). Phase 6 별도.

---

## 5. 차용 워크플로우 적응 설계 (`update-formula.yml` 골격)

cmux `update-homebrew.yml`을 spyglass Formula·2-arch로 적응한 **골격**(원본 복사가 아닌 적응안):

```yaml
name: Update Homebrew Formula
on:
  workflow_run:
    workflows: ["release"]        # spyglass release.yml 의 name
    types: [completed]
  workflow_dispatch:
    inputs: { version: { required: true } }

jobs:
  update-formula:
    runs-on: ubuntu-latest
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    steps:
      # 1) 버전 결정 + semver 검증(pre-release 는 skip) — cmux 분기 차용
      # 2) darwin-arm64 / darwin-x64 두 tarball 다운로드 → 각 sha256 계산   ← cmux는 DMG 1개, 여기선 2개
      # 3) homebrew-claude-code-spyglass checkout (HOMEBREW_TAP_TOKEN)
      # 4) Formula/spyglass.rb 재생성:
      #      on_macos { on_arm  → url+ARM64_SHA ; on_intel → url+X64_SHA }   ← 2-arch 동시 주입
      # 5) SHA 대조 검증(arm64·x64 각각) — 불일치 시 exit 1
      # 6) git commit -m "spyglass <ver>" && push
```

핵심 차이(cmux 대비): **자산이 DMG 1개 → tarball 2개**, **정의가 Cask → Formula의 `on_arm`/`on_intel` 2블록**. 나머지(트리거·SHA검증·PAT·semver skip)는 동일 골격.

> 구현 시 Formula 재생성 로직은 `homebrew-claude-code-spyglass` repo의 스크립트 또는 본 워크플로우 inline으로 둔다. 실제 코드는 본 계획 승인 후 작성.

---

## 6. 배포 시나리오 매트릭스 (미완성분 정리)

사용자가 "완벽히 정리되지 않았다"고 한 부분. brew Formula 기준 전 구간 시나리오:

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

> **미정리였던 핵심 공백** — ① brew services와 `spyglass start`(detached) 동시 사용 시 포트 충돌 가드, ② `brew upgrade` 시 서버 자동 재시작 여부(brew services는 자동, 수동 모드는 사용자 재시작), ③ `SPYGLASS_GRAPH_MODE=off`(brew tarball에 native 미동봉) 기본값 일관성. Phase 5에서 확정.

---

## 7. 리스크 & 무과금 보장 체크리스트

- [ ] **무과금** — 어느 단계에도 Apple Developer ID·notarization·Cask·DMG 도입 금지. ad-hoc codesign만.
- [ ] **arm64 회귀 0** — Formula 재생성이 darwin-arm64 url/이름(`spyglass-<v>-darwin-arm64.tar.gz`)을 깨지 않을 것(`release.yml` 산출물 이름 의존).
- [ ] **pre-release 격리** — `-rc` tag는 tap 갱신 skip(stable 사용자에 RC 미노출).
- [ ] **SHA 검증** — placeholder/불일치 Formula가 push되지 않도록 대조 단계 필수.
- [ ] **PAT 스코프** — `HOMEBREW_TAP_TOKEN`은 tap repo에 한정(최소 권한).

---

## 8. 참조

- [`01-app-to-brew-rationale.md`](./01-app-to-brew-rationale.md) — 앱→brew 전환 배경·과금 분석(선행 문서).
- `tap-template/README.md` — tap repo 부트스트랩 절차.
- `tap-template/Formula/spyglass.rb` — Formula 본체(sha256 placeholder).
- `scripts/build-release-tarball.sh` — tarball + ad-hoc codesign 산출.
- `.github/workflows/release.yml` — 현재 tarball 게시(자동 갱신 미포함).
- `docs/architecture/deployment.md` — 로컬/데몬/Docker 시나리오(brew와 교차 링크 대상).
- cmux 레퍼런스: `cmux/.github/workflows/update-homebrew.yml`, `cmux/.gitmodules`, `cmux/scripts/sign-cmux-bundle.sh`(과금 노선 — 미차용).

---

*Generated by Claude Code (Opus 4.8) — 계획 문서. 구현은 승인 후. 기준일 2026-05-31.*
