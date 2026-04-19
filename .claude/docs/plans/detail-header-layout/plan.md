# detail-header-layout 개발 계획

> Feature: detail-header-layout
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

세션 상세 뷰(detailView)의 헤더 영역(`detail-header`)이 항목이 많을 때 2줄로 줄바꿈되는 문제를 해결하고, 모든 항목을 1줄에 예쁘게 배치한다.

## 현황

```html
<div class="detail-header">        <!-- flex-wrap: wrap 적용됨 -->
  <div class="detail-meta">        <!-- flex-wrap: wrap 적용됨 -->
    <span class="detail-session-id">세션 ID (monospace, accent 색상)</span>
    <span class="detail-project">프로젝트명</span>
    <span class="detail-tokens">토큰 정보 (margin-left: auto)</span>
    <span class="detail-tokens" style="color:var(--text-muted)">종료 시각</span>
    <div class="detail-agg-badges">집계 배지들 (display:none → 데이터 로드 후 표시)</div>
  </div>
  <button class="btn-close">닫기</button>
</div>
```

**문제:** `detail-header`와 `detail-meta` 모두 `flex-wrap: wrap`이어서 배지 등이 추가되면 2줄 이상으로 늘어남.

## 범위

- 포함:
  - `detail-header` 영역 1줄 고정 레이아웃 재설계
  - 각 항목(세션 ID, 프로젝트명, 토큰, 종료 시각, 배지) 배치 최적화
  - 인라인 스타일 CSS 클래스 이관
  - `detail-view.css` 수정
  - `index.html` detail-header 마크업 조정 (필요 시)

- 제외:
  - 표시 데이터 내용 변경
  - JS 로직 변경

## 단계별 계획

### 1단계: 현황 분석 및 레이아웃 전략 수립
- 항목별 중요도/우선순위 파악
- 공간 부족 시 생략(truncate) 또는 축소 전략 결정
- 1줄 고정 레이아웃 방식 결정

### 2단계: HTML 구조 정리
- `detail-agg-badges`의 `display:none` 인라인 스타일 → CSS 클래스로 이관
- `detail-tokens` 두 번째 요소의 `color` 인라인 스타일 → CSS 클래스로 이관
- 필요 시 항목 래퍼 구조 추가

### 3단계: CSS 개선
- `flex-wrap` 제거 → 1줄 고정
- 각 항목 `min-width: 0` + `overflow: hidden; text-overflow: ellipsis` 처리
- 배지 영역 공간 효율적 배치

## 완료 기준

- [ ] 배지 포함 상태에서도 detail-header가 1줄 유지
- [ ] 항목이 길어질 경우 적절히 truncate 처리
- [ ] 인라인 스타일 제거
- [ ] 시각적으로 균형 잡힌 1줄 레이아웃
