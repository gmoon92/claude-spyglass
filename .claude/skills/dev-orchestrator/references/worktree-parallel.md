# git worktree 병렬 실행 절차

## 병렬화 조건 (모두 만족해야 함)

1. 그룹 간 수정 파일 집합이 교집합 없음
2. 그룹 B가 그룹 A의 런타임 결과물에 논리적으로 의존하지 않음
3. 각 그룹이 독립적으로 `bun test` 통과 가능

---

## 실행 절차

```bash
# 1. 각 브랜치용 worktree 생성 (현재 HEAD 기준)
git worktree add ../{feature}-branch-a -b {feature}/branch-a
git worktree add ../{feature}-branch-b -b {feature}/branch-b

# 2. 서브에이전트를 각 worktree에서 병렬 실행
#    Agent isolation: "worktree" 파라미터는 사용하지 않고,
#    각 에이전트 프롬프트에 worktree 경로를 명시함

# 3. 병렬 완료 후 main으로 순서대로 merge
git merge {feature}/branch-a
git merge {feature}/branch-b

# 4. 통합 검증
bun test
```

---

## ⚠️ 필수: worktree 정리 (merge 완료 직후 반드시 실행)

정리를 빠뜨리면 `git worktree list`에 고아 경로가 남고, 디렉토리가 디스크에 잔류합니다.
통합 검증(`bun test`) 직후, 사용자에게 결과를 보고하기 **전에** 반드시 실행하세요.

```bash
# worktree 디렉토리 제거
git worktree remove ../{feature}-branch-a
git worktree remove ../{feature}-branch-b

# 피처 브랜치 삭제
git branch -d {feature}/branch-a {feature}/branch-b

# 정리 완료 확인 — main worktree만 남아 있어야 함
git worktree list
git branch
```

---

## 서브에이전트 프롬프트 필수 포함 항목

- 작업 경로: `worktree 절대 경로` (예: `/path/to/{feature}-branch-a`)
- 태스크 범위: 담당할 태스크 ID 목록
- 커밋 규칙: 각 태스크 완료 시 해당 worktree에서 커밋
- 완료 신호: 마지막 태스크 커밋 후 "DONE" 반환

---

## 주의사항

- 각 서브에이전트는 자신의 worktree 내에서만 커밋
- main 브랜치나 다른 worktree 경로 접근 금지
- merge conflict 발생 시 오케스트레이터(메인)가 직접 해결
