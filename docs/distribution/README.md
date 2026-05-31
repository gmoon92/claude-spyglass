# docs/distribution — spyglass 배포 전략 문서

spyglass 배포 채널을 **Electron DMG(앱) → Homebrew Formula(무과금)** 로 전환하는 분석·계획 문서 모음입니다.

## 문서 목록 (읽는 순서)

| # | 문서 | 내용 |
|---|------|------|
| 01 | [`01-app-to-brew-rationale.md`](./01-app-to-brew-rationale.md) · [html](./01-app-to-brew-rationale.html) | **왜 앱이 아니라 brew인가** — Electron DMG의 정식 배포가 요구하는 Apple Developer Program(연 $99) 코드 서명·notarization 분석, brew(ad-hoc codesign 무과금) 회피 근거, 전환 타임라인 |
| 02 | [`02-brew-improvement-plan.md`](./02-brew-improvement-plan.md) · [html](./02-brew-improvement-plan.html) | **어떻게 완성할 것인가** — cmux(`manaflow-ai/cmux`) brew 자동화 차용 매트릭스(차용 O / 미차용), 자동 갱신 워크플로우 적응 설계, 배포 시나리오 매트릭스 |
| 03 | [`03-bundle-and-update-unification.md`](./03-bundle-and-update-unification.md) · [html](./03-bundle-and-update-unification.html) | **배포 마무리 설계 (현행 SSoT)** — 전 의존성 번들(LadybugDB 필수 동봉)·Homebrew 업데이트 일원화·desktop 폐기. 번들 전수 매트릭스, 페이즈 D1~D6, 미결 Gap, 에이전트/스킬 할당 |
| — | [`tasks.json`](./tasks.json) | **TaskCreate 1:1 등록용** 구현 명세 — D1~D6 17개 태스크. 각 태스크 owner(에이전트/스킬)·depends_on·verify·worktree·risk. 마지막 D6=문서 현행화 |

## 핵심 결정 (현행)

- **형식**: Homebrew **Formula**(CLI standalone bin). Cask 아님.
- **서명**: **ad-hoc codesign 만** — Apple Developer ID·notarization 미적용 = **과금 0원**.
- **tap repo**: `gmoon92/homebrew-claude-code-spyglass` (**생성 완료**, public). 설치: `brew tap gmoon92/claude-code-spyglass && brew install spyglass`.
- **번들**: 모든 의존성을 tarball에 번들. SQLite·i18n은 이미 bin 내장, web·migrations 동봉됨, **LadybugDB native는 필수 동봉(D2)**.
- **업데이트**: `brew upgrade` 일원화. git pull(`install.sh`·`/api/update`) 제거.
- **desktop**: Electron DMG **폐기(D5)** — 업데이트 일원화·무과금.
- **cmux**: 자동화 패턴만 **차용(adapt)**. Cask·DMG·Developer ID 서명은 미차용(과금 노선).

## 관련 문서

- [`../install-guide.md`](../install-guide.md) — 설치 가이드 (Phase 4에서 brew 절 현행화 대상)
- [`../architecture/deployment.md`](../architecture/deployment.md) — 로컬/데몬/Docker 배포 시나리오
- [`../../tap-template/`](../../tap-template/) — Homebrew tap repo 부트스트랩 자산
- [`../../README.md`](../../README.md) — 프로젝트 README (이미 brew 1순위)
