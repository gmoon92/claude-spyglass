# 확인 세션용 프롬프트 — 작업 결과 검증

> 이 프롬프트는 다른 Claude 세션이 작업 결과를 **검증·리뷰**할 때 사용합니다.
> 작업 세션과 **별도로** 실행하여 독립적인 검증을 수행합니다.

---

## 🎯 검증 목표

작업 세션이 "React 마이그레이션 잔여 바닐라 정리"를 완료했다고 보고한 후, **독립적으로** 다음을 검증합니다:

1. 보고된 변경사항이 실제로 코드에 반영되었는가?
2. `typecheck`/`test`/`build`가 모두 통과하는가?
3. 새로운 바닐라 흔적이 추가되지 않았는가?
4. 기존 기능이 회귀되지 않았는가?

---

## 📋 검증 전 준비

먼저 다음 문서를 읽고 검증 범위를 파악하세요:

```
1. /Users/moongyeom/IdeaProjects/claude-spyglass/docs/react-migration/handoff-prompt.md
2. /Users/moongyeom/IdeaProjects/claude-spyglass/docs/react-migration/remaining-vanilla-audit.md
3. 작업 세션의 보고서(변경 파일 목록)
```

---

## 🔍 검증 체크리스트

### 1. 변경 파일 확인

작업 세션이 보고한 파일들이 실제로 변경되었는지 확인:

```bash
cd /Users/moongyeom/IdeaProjects/claude-spyglass
git diff --stat HEAD
```

**확인 항목:**
- [ ] 보고된 파일 목록과 `git diff` 결과가 일치하는가?
- [ ] 예상치 못한 파일이 변경되지 않았는가?
- [ ] 삭제된 파일이 `git status`에 반영되었는가?

---

### 2. 바닐라 흔적 감소 확인

작업 전후로 잔여 바닐라 패턴이 줄었는지 직접 계수:

```bash
cd /Users/moongyeom/IdeaProjects/claude-spyglass

echo "=== innerHTML (src/ 낸부) ==="
grep -rn "innerHTML" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//" | wc -l

echo "=== dangerouslySetInnerHTML ==="
grep -rn "dangerouslySetInnerHTML" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | wc -l

echo "=== document.getElementById/querySelector ==="
grep -rn "document\.getElementById\|document\.querySelector" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//" | wc -l

echo "=== window.I18n ==="
grep -rn "window\.I18n" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//" | wc -l

echo "=== CustomEvent ==="
grep -rn "CustomEvent" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | wc -l

echo "=== src → assets/js import ==="
grep -rn "from.*assets/js" packages/web/src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "//" | wc -l
```

**확인 항목:**
- [ ] 작업 전 수치보다 **감소**했는가?
- [ ] 새로운 패턴이 **추가되지 않았**는가?

**기준(커밋 8681b45 기준):**
| 패턴 | 기준값 | 목표 |
|---|---|---|
| innerHTML | 12 | 8 (MetaDocsFlow 제외) |
| dangerouslySetInnerHTML | 9 | 0 |
| document.getElementById/querySelector | 7 | 3 (main.tsx·use-panel-resize 제외) |
| window.I18n | 20+ | 0 |
| CustomEvent | 2 | 0 |
| src→assets/js import | 37 | 20 이하 |

---

### 3. 빌드 파이프라인 검증

```bash
cd /Users/moongyeom/IdeaProjects/claude-spyglass

# 타입 체크
echo "=== typecheck ==="
bun run --cwd packages/web typecheck

# 테스트
echo "=== test ==="
bun run --cwd packages/web test

# 빌드
echo "=== build ==="
bun run --cwd packages/web build
```

**통과 기준:**
- [ ] typecheck: **0 error**
- [ ] test: **1,082 pass 이상** (현재 기준), **fail 0**
- [ ] build: **정상 종료**

---

### 4. 기능적 회귀 검증 (샘플)

핵심 화면이 여전히 정상 렌더링되는지 확인:

```bash
# 빌드 산출물 확인
ls -la /Users/moongyeom/IdeaProjects/claude-spyglass/packages/web/dist/

# index.html에 react-root가 있는지 확인
grep "react-root" /Users/moongyeom/IdeaProjects/claude-spyglass/packages/web/dist/index.html
```

**확인 항목:**
- [ ] `dist/index.html`이 생성되었는가?
- [ ] `dist/assets/index-*.js` (Vite 번들)이 생성되었는가?
- [ ] `dist/assets/css/` (classic CSS)가 복사되었는가?

---

### 5. 코드 품질 검증

변경된 코드를 읽고 다음을 확인:

**A. React 패턴 준수**
- [ ] `useRef`가 적절히 사용되었는가?
- [ ] `useEffect` cleanup이 누락되지 않았는가?
- [ ] 메모이제이션(`useMemo`, `useCallback`)이 필요한 곳에 적용되었는가?

**B. DOM 조작 최소화**
- [ ] `querySelector`/`getElementById`가 정당한 경우(진입점, 리사이즈) 외에 남아있지 않은가?
- [ ] `innerHTML`이 완전히 제거되었거나, 정당한 경우(MetaDocsFlow SVG)만 남았는가?

**C. i18n 패턴**
- [ ] `useTranslation()`이 적절히 사용되었는가?
- [ ] `window.I18n` 직접 참조가 제거되었는가?

---

## ⚠️ 주의 사항

1. **작업 세션의 보고를 맹신하지 마세요.**
   - 직접 `git diff`와 `grep`으로 확인하세요.

2. **"테스트 통과"만으로 충분하지 않습니다.**
   - 테스트 커버리지 밖의 DOM 조작은 테스트로 잡히지 않을 수 있습니다.

3. **새로운 바닐라 패턴이 추가되지 않았는지 확인하세요.**
   - 작업 과정에서 `document.createElement`, `el.innerHTML = ...` 등이 새로 추가되었을 수 있습니다.

---

## 📤 검증 보고 형식

검증 완료 후 다음 형식으로 보고하세요:

```markdown
## 검증 보고

### 검증 범위
- 검증 대상 작업: (작업 세션의 요약)
- 검증 기준 커밋: (작업 완료 후 커밋 해시)

### 감소 확인
| 패턴 | 작업 전 | 작업 후 | 변화 | 판정 |
|---|---|---|---|---|
| innerHTML | 12 | X | ±Y | ✅/⚠️ |
| dangerouslySetInnerHTML | 9 | X | ±Y | ✅/⚠️ |
| ... | ... | ... | ... | ... |

### 빌드 파이프라인
- typecheck: X error → ✅/❌
- test: X pass / X fail → ✅/❌
- build: OK/FAIL → ✅/❌

### 코드 품질
- React 패턴 준수: ✅/⚠️/❌
- DOM 조작 최소화: ✅/⚠️/❌
- i18n 패턴: ✅/⚠️/❌

### 발견된 문제
- (있다면 구체적으로 기술)

### 최종 판정
- ✅ 승인 — 다음 작업으로 진행 가능
- ⚠️ 조건부 승인 — 다음 문제 해결 후 재검증 필요
- ❌ 반려 — (구체적인 이유)
```

---

**참고 문서:**
- `/Users/moongyeom/IdeaProjects/claude-spyglass/docs/react-migration/handoff-prompt.md` — 작업 위임 프롬프트
- `/Users/moongyeom/IdeaProjects/claude-spyglass/docs/react-migration/remaining-vanilla-audit.md` — 잔여 항목 상세 분석
