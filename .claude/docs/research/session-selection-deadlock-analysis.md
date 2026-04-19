# 세션 선택 데드락 문제 분석 및 해결책

## 문제 개요

### 사용자 보고 증상
Claude Spyglass 웹 대시보드에서 사용자가 왼쪽 패널의 세션 목록을 클릭할 때 발생하는 UI 반응성 문제:

1. 첫 번째 세션 클릭 후 애니메이션(슬라이드 인) 중 두 번째 세션 클릭 → 아무 반응 없음
2. 사용자는 "클릭이 안 먹히는 것"으로 인식 → 버그로 판단
3. 빠르게 여러 세션을 탐색하려는 사용자에게 답답함 제공

### 원인 코드

```javascript
// /packages/web/assets/js/main.js (기존 문제 코드)
async function selectSession(id) {
  if (uiState.isTransitioning) return;  // ← 문제 지점: 애니메이션 중 모든 클릭 무시
  setSelectedSession(id);
  renderBrowserSessions();

  uiState.rightView   = 'detail';
  uiState.detailTab   = 'flat';
  uiState.isTransitioning = true;  // ← 플래그 설정
  renderRightPanel();

  document.getElementById('detailLoading').style.display  = 'block';
  document.getElementById('detailFlatView').style.display = 'none';
  document.getElementById('detailTurnView').style.display = 'none';

  // ← 치명적 문제: transitionend가 발생하지 않으면 isTransitioning이 true로 남음
  document.getElementById('detailView').addEventListener(
    'transitionend',
    () => { uiState.isTransitioning = false; },
    { once: true }
  );

  // ... 데이터 로드
  try {
    await loadSessionDetail(id);
  } catch {
    applyDetailFilter();
  }

  document.getElementById('detailLoading').style.display = 'none';
  setDetailView(uiState.detailTab);
}
```

## 근본 원인 분석

### 1. `transitionend` 이벤트의 불안정성

`transitionend` 이벤트는 다음 상황에서 **발생하지 않음**:

| 상황 | 결과 |
|------|------|
| 요소가 `display:none` 상태에서 시작 | 이벤트 미발생 |
| 트랜지션이 중단됨 | 이벤트 미발생 |
| 요소가 DOM에서 제거됨 | 이벤트 미발생 |
| 브라우저 탭이 백그라운드 | 이벤트 지연/미발생 |
| CSS 트랜지션 속성 변경 | 이벤트 미발생 |

**결과**: `isTransitioning`이 `true`로 영구히 남아 모든 후속 클릭 무시 (데드락)

### 2. Race Condition

사용자가 빠르게 A→B 세션을 클릭할 때:

```
[기존 코드 흐름]
  A 클릭 → isTransitioning=true → A의 transitionend 등록
  B 클릭 → isTransitioning=true → 무시됨 ❌
  A transitionend 발생 → isTransitioning=false (B는 이미 무시됨)
```

### 3. 사용자 경험 저하

- **인지 부하**: "왜 반응이 없지?"라는 혼란
- **탐색 효율성 저하**: 세션 목록 탐색 시 애니메이션 대기 필요
- **버그 인식**: 사용자는 이를 시스템 버그로 인식

## 전문가 회의 결과

### 참여 전문가

1. **JavaScript 비동기 처리 전문가** - Promise, AbortController, 상태 관리
2. **UX/인터랙션 디자인 전문가** - 사용자 경험, 인지적 측면, 현대적 UX 패턴
3. **시니어 프론트엔드 개발자** - 실무 경험, 안정성, 유지보수성

### 1라운드 제안

#### JavaScript 전문가
- **제안**: Promise + AbortController + transitionId stale 체크 패턴
- **핵심**: 각 selectSession 호출은 고유한 transitionId를 가지며, AbortController로 이전 작업 취소

#### UX 전문가
- **제안**: 옵션 A - "즉시 취소 + 즉시 반영" 패턴
- **핵심**: 사용자 입력이 애니메이션보다 우선순위가 높아야 함
- **근거**: iOS/Android 앱 전환, Chrome 탭 전환, VS Code 파일 전환 등 현대적 UX 표준

#### 시니어 개발자
- **제안**: Promise.race + finally 블록 + 500ms 타임아웃
- **핵심**: 안정성과 단순성 최우선, 동일 세션만 무시

### 2라운드 토론 및 합의

#### 토론 포인트 1: `finally` vs `AbortController`

| 접근법 | 입장 | 이유 |
|--------|------|------|
| **시니어 개발자** (finally) | ✅ **채택** | 예외 상황에서도 상태가 항상 정리되어 안정적 |
| **JS 전문가** (AbortController) | ✅ **채택** | fetch 요청을 실제로 취소하여 리소스 절약 |

**합의**: 둘을 결합
- `finally`로 UI 상태 플래그는 항상 정리
- `AbortController`로 네트워크 요청은 실제 취소

#### 토론 포인트 2: `transitionend` 대기 vs 즉시 데이터 로드

| 접근법 | 입장 | 이유 |
|--------|------|------|
| **시니어 개발자** (500ms 타임아웃) | ❌ **거부** | 여전히 사용자 입력을 500ms 무시함 |
| **JS 전문가** (즉시 시작 + stale 체크) | ✅ **채택** | 데이터 로드는 즉시 시작, 애니메이션과 병렬 처리 |

**합의**: 즉시 데이터 로드 시작
- 네트워크 I/O는 병렬로 시작
- 사용자는 왼쪽 패널 하이라이트 변화로 즉각적 피드백
- `currentSessionId`로 간단한 stale 체크

#### 토론 포인트 3: 동일 세션 클릭 처리

| 접근법 | 입장 | 이유 |
|--------|------|------|
| **시니어 개발자** (동일 세션 무시) | ✅ **채택** | 불필요한 네트워크 요청 방지, 실수 클릭 처리 |

**합의**: 동일 세션은 early return으로 무시
- 새로고침이 필요하다면 별도 UI 제공
- 조용히 무시 (시각적 피드백 불필요)

## 최종 해결책

### 핵심 원칙

> **사용자 입력 > 애니메이션**

- 사용자의 클릭은 명령이며 즉시 반영되어야 함
- 애니메이션은 보조적 역할이며 사용자 의도를 방해해서는 안 됨
- 현대적 UX 표준(iOS, Android, Chrome, VS Code) 따름

### 구현 코드

```javascript
// /packages/web/assets/js/main.js (개선된 코드)

// 모듈 수준 상태
let currentSessionId = null;
let abortController = null;

async function selectSession(id) {
  // 1. 동일 세션 클릭 무시
  if (id === currentSessionId) return;
  
  // 2. 이전 요청 즉시 취소
  abortController?.abort();
  abortController = new AbortController();
  
  // 3. 즉각적 피드백: 왼쪽 패널 하이라이트
  currentSessionId = id;
  setSelectedSession(id);
  renderBrowserSessions();
  
  // 4. UI 전환
  uiState.rightView = 'detail';
  uiState.detailTab = 'flat';
  renderRightPanel();
  
  // 5. 데이터 로드
  document.getElementById('detailLoading').style.display = 'block';
  document.getElementById('detailFlatView').style.display = 'none';
  document.getElementById('detailTurnView').style.display = 'none';
  
  try {
    // 즉시 데이터 로드 시작 (애니메이션과 병렬)
    await loadSessionDetail(id, abortController.signal);
    
    // stale 체크: 요청 중 다른 세션 선택됐으면 무시
    if (id !== currentSessionId) return;
    
    setDetailView(uiState.detailTab);
  } catch (err) {
    if (err.name === 'AbortError') return; // 정상 취소
    applyDetailFilter(); // 에러 시 폴백
  } finally {
    // 항상 상태 정리 (시니어 개발자의 안정성 패턴)
    document.getElementById('detailLoading').style.display = 'none';
  }
}
```

### 변경 사항 비교

| 항목 | 기존 코드 | 수정 후 |
|------|----------|---------|
| `isTransitioning` 플래그 | transitionend 기반 | **제거됨** |
| 동일 세션 클릭 | 무시 | **early return** |
| 다른 세션 클릭 | 무시됨 | **즉시 취소 후 전환** |
| 데이터 로드 타이밍 | transitionend 이후 | **즉시 시작** |
| 취소 메커니즘 | 없음 | **AbortController** |
| 상태 정리 | 불확실 | **finally 블록 보장** |

## 참고 자료

### 현대적 UX 패턴 사례

1. **iOS/Android 앱 전환**: 사용자가 빠르게 앱을 전환할 때 이전 애니메이션이 취소되고 새 전환이 즉시 시작됨
2. **Chrome 탭 전환**: 빠른 탭 클릭 시 이전 전환이 취소되고 새 탭이 즉시 표시됨
3. **VS Code 파일 전환**: 파일을 빠르게 클릭하면 이전 로딩이 취소되고 새 파일이 표시됨

### 관련 파일

- `/packages/web/assets/js/main.js` - `selectSession()` 함수
- `/packages/web/assets/js/session-detail.js` - `loadSessionDetail()` 함수
- `/packages/web/assets/js/left-panel.js` - `setSelectedSession()`, `renderBrowserSessions()` 함수

### 해결된 문제 목록

- [x] `transitionend` 미발생으로 인한 데드락
- [x] 빠른 세션 전환 시 클릭 무시
- [x] Race condition으로 인한 잘못된 상태 복구
- [x] 불필요한 네트워크 요청 (AbortController로 취소)
- [x] 예외 상황에서의 상태 정리

---

**작성일**: 2026-04-19  
**회의 라운드**: 3라운드  
**참여 전문가**: JavaScript 전문가, UX 전문가, 시니어 프론트엔드 개발자
