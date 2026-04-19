# sse-ui-state-sync Architecture Decision Records

> 작성일: 2026-04-19
> 참여 전문가: 소프트웨어 아키텍트, 프론트엔드 엔지니어

---

## ADR-001: isTransitioning 복구 방식

### 상태
**결정됨** (2026-04-19)

### 배경

`selectSession`에서 `uiState.isTransitioning = true`로 설정 후 복구를 CSS `transitionend` 이벤트에만 의존한다.
SSE DOM 조작이 transition을 방해하면 `transitionend`가 발화되지 않아 플래그가 영구 `true`로 stuck된다.
결과적으로 이후 모든 세션 클릭이 `if (uiState.isTransitioning) return`으로 무시된다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A (현행) | `transitionend` 이벤트로 복구 | 코드 변경 최소 | SSE DOM 조작에 취약, stuck 가능 |
| B | `transitionend` + setTimeout fallback | 기존 구조 유지 | CSS transition 시간과 암묵적 결합, 타이머 경쟁 조건 |
| C | `async try/finally` 복구 | CSS와 완전 분리, 예측 가능 | transitionend 리스너 제거 필요 |

### 결정

**옵션 C 채택**: `selectSession`을 `try/finally` 블록으로 리팩토링하여 세션 로드 완료(또는 실패) 시 `isTransitioning = false`를 보장한다. `transitionend` 리스너는 완전히 제거한다.

```js
uiState.isTransitioning = true;
renderRightPanel();
try {
  // ... UI 초기화 ...
  await loadSessionDetail(id);
} finally {
  uiState.isTransitioning = false;
  document.getElementById('detailLoading').style.display = 'none';
  setDetailView(uiState.detailTab);
}
```

### 이유

1. `isTransitioning`의 실질적 목적은 "CSS transition 진행 중"이 아니라 "세션 로드 진행 중"이다 (프론트엔드 엔지니어 관찰).
2. CSS transition이 발화하는지 여부는 브라우저 환경, GPU 가속, `prefers-reduced-motion` 설정에 따라 달라진다. async 완료 시점은 명확한 프로그래밍 이벤트다 (아키텍트 관찰).
3. timeout fallback은 CSS 파일의 transition 시간 값과 암묵적 결합을 만들어 유지보수 부담이 생긴다.

### 대안 채택 시 영향

- 옵션 B 선택 시: timeout 값이 CSS transition 시간과 동기화되지 않으면 동일 버그가 특정 조건에서 재현될 수 있다.

---

## ADR-002: 신규 SSE 행의 필터 적용 방식

### 상태
**결정됨** (2026-04-19)

### 배경

`prependRequest`는 SSE 이벤트마다 새 `<tr>`를 DOM에 무조건 삽입한다.
검색 필터(`applyFeedSearch`)와 유형 필터(`reqFilter`)가 활성화된 상태에서도 관련 없는 행이 그대로 노출된다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `feed:updated` dispatch → `applyFeedSearch` 전체 재순회 | 기존 로직 재사용 | O(n) DOM 순회, 최대 200행 반복 |
| B | 신규 행 하나에만 직접 필터 적용 (O(1)) | 범위 명확, 성능 우수 | 검색 텍스트 추출 로직 중복 또는 리팩토링 필요 |
| C | 신규 행에 직접 적용 + 인플레이스 업데이트 시 `feed:updated` dispatch | 상황별 최적 방식 | 두 경로 관리 |

### 결정

**옵션 B 채택 (단순화 버전)**: 신규 행 삽입 후 스크롤 조정 완료 이후에 `feed:updated` 이벤트를 dispatch한다.
이유: `applyFeedSearch`가 이미 검색 텍스트 추출 로직을 온전히 보유하고 있어 중복이 발생하지 않는다.
200행 제한 내에서 전체 재순회 비용은 허용 가능하다.
단, dispatch 위치는 스크롤 조정 코드 이후여야 정확한 스크롤 보정이 가능하다.

```js
// 스크롤 조정 완료 후
if (!isNearTop && feedBody) {
  feedBody.scrollTop = prevScrollTop + addedHeight;
  addScrollLockCount();
  updateScrollLockBanner();
} else {
  resetScrollLockCount();
  updateScrollLockBanner();
}
// 스크롤 조정 완료 후 필터 재적용
document.dispatchEvent(new CustomEvent('feed:updated'));
```

### 이유

1. `applyFeedSearch`에 검색 텍스트 추출 로직이 이미 집중되어 있어 중복 없이 재사용 가능하다.
2. 스크롤 조정 이후 dispatch해야 행 숨김으로 인한 높이 변화가 스크롤 보정에 영향을 주지 않는다 (프론트엔드 엔지니어 지적).
3. 인플레이스 업데이트 분기(`existing`)도 동일하게 스크롤 관련 코드 없이 바로 dispatch한다.

### 전문가 이견

**아키텍트 관점**: debounce 추가를 권장했으나, 최대 200행 제한과 SSE 빈도를 고려하면 현재 규모에서는 불필요한 복잡도 증가다.  
**해소**: YAGNI 원칙에 따라 현재 규모에서 debounce 없이 진행. 성능 문제 발생 시 추가.

---

## ADR-003: reqFilter 상태 접근 방식

### 상태
**결정됨** (2026-04-19)

### 배경

`api.js`의 `reqFilter`는 `export let`으로 선언되어 직접 접근 가능하지만, setter(`setReqFilter`)만 있고 getter가 없는 비대칭 구조다.
`prependRequest`가 현재 필터 값을 읽어야 하는데, 접근 방식이 계획에서 "선택"으로 표기되어 있다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `reqFilter` live binding 직접 import | 코드 추가 없음 | 캡슐화 위반, snapshot 실수 위험 |
| B | `getReqFilter()` getter export 추가 | 캡슐화, setter와 대칭 | `api.js` 1줄 추가 |

### 결정

**옵션 B 채택**: `api.js`에 `export function getReqFilter() { return reqFilter; }` 추가. `main.js`에서는 `getReqFilter()`를 호출한다.

### 이유

1. 두 전문가 모두 getter 추가를 권장했다.
2. `setReqFilter`와 대칭 구조를 만들어 상태 접근 경로를 명확히 한다.
3. `import { reqFilter }` + `const snap = reqFilter` 실수로 인한 live binding 오해를 방지한다 (아키텍트 지적).
4. 향후 `reqFilter` 변경 시 side effect를 getter 내부에서 처리할 수 있다.

---

## ADR-004: 두 필터 간 가시성 충돌 처리

### 상태
**결정됨** (2026-04-19)

### 배경

검색 필터와 유형 필터 모두 `tr.style.display`를 직접 조작한다.
- 유형 필터가 `display: none`으로 숨긴 행을 검색어 초기화 시 `applyFeedSearch`가 `display: ''`로 복구한다.
- 결과: 유형 필터가 무력화됨.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `applyFeedSearch`의 복구 로직에 `reqFilter` 확인 추가 | 구조 변경 최소 | 두 필터 간 의존성 발생 |
| B | `data-hidden-by-type`, `data-hidden-by-search` 속성 + `updateRowVisibility` 함수 | 완전한 분리 | 모든 필터 적용 지점 수정 필요 |

### 결정

**옵션 A 채택 (최소 변경)**: `applyFeedSearch` 내 복구 로직(`display: ''`)에서 `reqFilter` 상태를 함께 확인한다.

```js
rows.forEach(tr => {
  if (!q) {
    // 유형 필터 활성화 시 해당 타입이 아닌 행은 복구하지 않음
    tr.style.display = (reqFilter !== 'all' && tr.dataset.type !== reqFilter) ? 'none' : '';
    return;
  }
  // 기존 검색 로직 ...
  const matches = text.includes(q);
  tr.style.display = (!matches || (reqFilter !== 'all' && tr.dataset.type !== reqFilter)) ? 'none' : '';
});
```

### 이유

1. 옵션 B(`data-*` 속성)는 모든 필터 적용 지점의 수정이 필요해 변경 범위가 커진다.
2. 옵션 A는 `applyFeedSearch` 하나만 수정하여 두 필터의 AND 조건을 통일한다.
3. CLAUDE.md "동일 판단 로직은 한 곳에만" 원칙에 따라 가시성 최종 결정을 `applyFeedSearch` 한 곳에 집중한다.

### 전문가 이견

**프론트엔드 엔지니어 관점**: `data-*` 속성 방식이 더 확장성 있다고 주장.  
**해소**: 현재 필터가 2개이고 추가 예정이 없으므로 YAGNI 원칙 적용. 필터가 3개 이상이 될 경우 `data-*` 방식으로 리팩토링한다.

---

## ADR-005: 인플레이스 업데이트 분기의 필터 재평가 정책

### 상태
**결정됨** (2026-04-19)

### 배경

`prependRequest`의 `existing` 분기(같은 request id 행이 이미 DOM에 있는 경우)에서 셀 일부만 업데이트한다.
이 행의 가시성을 재평가해야 하는지, 기존 상태를 유지해야 하는지 정책이 없다.

### 결정

**인플레이스 업데이트 분기에서는 가시성을 재평가하지 않는다.**
단, 셀 업데이트 완료 후 `feed:updated` 이벤트를 dispatch하여 검색 필터가 갱신된 텍스트 내용에 맞게 재적용되도록 한다.

### 이유

1. 인플레이스 업데이트는 `event_type='pre_tool' → tool` 전환으로, 같은 request id의 상태 변경이다. `r.type`이 바뀌는 경우는 없다.
2. 따라서 유형 필터 재평가는 불필요하다. 기존 `display` 상태를 건드리지 않는 것이 안전하다.
3. 검색 필터는 `tool_detail`(도구 실행 결과 힌트)이 업데이트될 수 있으므로 `feed:updated` dispatch로 재평가한다.
