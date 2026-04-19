# sse-ui-state-sync 작업 목록

> 기반 문서: plan.md, adr.md
> 작성일: 2026-04-19
> 총 태스크: 4개

---

## 태스크 목록

| ID | 태스크 | 예상 시간 | 선행 태스크 | 커밋 타입 |
|----|--------|----------|------------|----------|
| T-01 | `api.js`에 `getReqFilter()` getter export 추가 | 15m | - | fix |
| T-02 | `selectSession` isTransitioning을 async try/finally로 복구 | 30m | - | fix |
| T-03 | `prependRequest` 필터 연동 + `applyFeedSearch` 충돌 수정 | 45m | T-01 | fix |
| T-04 | 브라우저 수동 검증 | 20m | T-02, T-03 | - |

---

## T-01: `api.js` — `getReqFilter()` getter export 추가

**선행 조건**: 없음

### 작업 내용

`api.js`에 `reqFilter`를 반환하는 getter 함수를 추가한다.
setter(`setReqFilter`)와 대칭 구조를 만들어 캡슐화하고, `main.js`에서 live binding 오해를 방지한다.

### 구현 범위

- `packages/web/assets/js/api.js`
  - `setReqFilter` 아래에 `export function getReqFilter() { return reqFilter; }` 1줄 추가

### 커밋 메시지

```
fix(api): reqFilter getter export 추가
```

### 검증 명령어

```bash
grep -n 'getReqFilter' packages/web/assets/js/api.js
```

### 완료 기준

- [ ] `api.js`에 `export function getReqFilter()` 존재
- [ ] 기존 `setReqFilter`, `reqFilter` export 변경 없음

### 롤백 방법

```bash
git revert HEAD
```

---

## T-02: `main.js` — `selectSession` isTransitioning 복구 방식 교체

**선행 조건**: 없음 (T-01과 병렬 가능)

### 작업 내용

`selectSession` 함수의 `transitionend` 리스너를 제거하고, `async try/finally` 블록으로 `isTransitioning` 복구를 보장한다.
세션 로드가 완료되거나 실패해도 반드시 플래그가 해제되도록 한다.

### 구현 범위

- `packages/web/assets/js/main.js`
  - `selectSession` 내 `document.getElementById('detailView').addEventListener('transitionend', ...)` 블록 제거
  - `loadSessionDetail` 호출을 `try/finally`로 감싸 `finally` 블록에서 `uiState.isTransitioning = false`, `detailLoading.style.display = 'none'`, `setDetailView(uiState.detailTab)` 실행
  - `try` 블록 이후의 동일 코드 제거 (finally로 이전)

### 구현 예시

```js
async function selectSession(id) {
  if (uiState.isTransitioning) return;
  setSelectedSession(id);
  renderBrowserSessions();

  uiState.rightView   = 'detail';
  uiState.detailTab   = 'flat';
  uiState.isTransitioning = true;
  renderRightPanel();

  document.getElementById('detailLoading').style.display  = 'block';
  document.getElementById('detailFlatView').style.display = 'none';
  document.getElementById('detailTurnView').style.display = 'none';

  const session    = getAllSessions().find(s => s.id === id);
  // ... 세션 정보 UI 업데이트 ...

  setDetailFilter('all');
  document.querySelectorAll('#detailTypeFilterBtns .type-filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.detailFilter === 'all');
  });

  try {
    await loadSessionDetail(id);
  } catch {
    applyDetailFilter();
  } finally {
    uiState.isTransitioning = false;
    document.getElementById('detailLoading').style.display = 'none';
    setDetailView(uiState.detailTab);
  }
}
```

### 커밋 메시지

```
fix(web): selectSession isTransitioning을 async try/finally로 복구
```

### 검증 명령어

```bash
grep -n 'transitionend\|isTransitioning' packages/web/assets/js/main.js
```

### 완료 기준

- [ ] `transitionend` 리스너 코드 없음
- [ ] `selectSession` 내 `try/finally` 블록에서 `isTransitioning = false` 설정
- [ ] `detailLoading.style.display = 'none'`이 finally 블록에 위치
- [ ] `setDetailView` 호출이 finally 블록에 위치

### 롤백 방법

```bash
git revert HEAD
```

---

## T-03: `main.js` — `prependRequest` 필터 연동 + `applyFeedSearch` 충돌 수정

**선행 조건**: T-01 완료 (getReqFilter import 필요)

### 작업 내용

세 가지를 하나의 커밋으로 처리한다 (모두 같은 SSE-필터 동기화 문제의 파생이므로 원자성 단위로 묶음):

1. `main.js` import에 `getReqFilter` 추가
2. `prependRequest` 신규 행 삽입 후 스크롤 조정 완료 이후 `feed:updated` dispatch
3. `prependRequest` 인플레이스 업데이트(`existing`) 분기에서도 `feed:updated` dispatch
4. `applyFeedSearch`의 `display: ''` 복구 로직에 유형 필터 상태 확인 추가

### 구현 범위

- `packages/web/assets/js/main.js`

  **import 추가** (상단):
  ```js
  import { ..., getReqFilter } from './api.js';
  ```

  **prependRequest — 인플레이스 업데이트 분기**:
  ```js
  if (existing) {
    const targetCell = existing.querySelector('.cell-target');
    if (targetCell) targetCell.outerHTML = makeTargetCell(r);
    const tokenCells = existing.querySelectorAll('.cell-token.num');
    const durationCell = tokenCells[tokenCells.length - 1];
    if (durationCell) durationCell.textContent = formatDuration(r.duration_ms);
    // 검색 필터 재적용 (tool_detail 등 텍스트 변경 반영)
    document.dispatchEvent(new CustomEvent('feed:updated'));
    return;
  }
  ```

  **prependRequest — 신규 행 삽입 후 스크롤 조정 완료 이후**:
  ```js
  if (!isNearTop && feedBody) {
    const addedHeight = feedBody.scrollHeight - prevScrollHeight;
    feedBody.scrollTop = prevScrollTop + addedHeight;
    addScrollLockCount();
    updateScrollLockBanner();
  } else {
    resetScrollLockCount();
    updateScrollLockBanner();
  }
  // 스크롤 조정 완료 후 검색+유형 필터 재적용
  document.dispatchEvent(new CustomEvent('feed:updated'));
  ```

  **applyFeedSearch 내 복구 로직**:
  ```js
  rows.forEach(tr => {
    const typeFiltered = getReqFilter() !== 'all' && tr.dataset.type !== getReqFilter();
    if (!q) {
      tr.style.display = typeFiltered ? 'none' : '';
      return;
    }
    const text = [ ... ].filter(Boolean).join(' ').toLowerCase();
    tr.style.display = (!text.includes(q) || typeFiltered) ? 'none' : '';
  });
  ```

### 커밋 메시지

```
fix(web): SSE prependRequest에 검색·유형 필터 동기화 추가
```

### 검증 명령어

```bash
grep -n 'feed:updated\|getReqFilter\|typeFiltered' packages/web/assets/js/main.js
```

### 완료 기준

- [ ] `prependRequest` 신규 삽입 분기에서 스크롤 조정 후 `feed:updated` dispatch
- [ ] `prependRequest` 인플레이스 업데이트 분기에서 `feed:updated` dispatch
- [ ] `applyFeedSearch`가 검색어 없을 때 유형 필터 상태를 함께 확인
- [ ] `applyFeedSearch`가 검색어 있을 때 유형 필터 AND 조건 적용
- [ ] `getReqFilter()`를 함수 호출 시마다 평가 (모듈 상단 snapshot 아님)

### 롤백 방법

```bash
git revert HEAD
```

---

## T-04: 브라우저 수동 검증

**선행 조건**: T-02, T-03 완료

### 검증 시나리오

1. **Bug 1 검증**: 세션 클릭 → 닫기 → 다시 클릭 → SSE 이벤트가 오는 중에도 정상 동작
2. **Bug 2 검증**: 검색어 입력 → SSE 대기 → 검색 조건 불일치 행 미노출 확인
3. **Bug 3 검증**: 유형 필터 선택(예: `tool_call`) → SSE 대기 → 다른 타입 행 미노출 확인
4. **충돌 검증**: 검색어 + 유형 필터 동시 활성화 → SSE 대기 → 양쪽 조건 모두 만족하는 행만 노출 → 검색어 지웠을 때 유형 필터 유지 확인

### 완료 기준

- [ ] Bug 1 시나리오 통과
- [ ] Bug 2 시나리오 통과
- [ ] Bug 3 시나리오 통과
- [ ] 검색+유형 필터 동시 충돌 없음
- [ ] 기존 기능(세션 상세 진입, 검색 초기화, 필터 해제) 회귀 없음
