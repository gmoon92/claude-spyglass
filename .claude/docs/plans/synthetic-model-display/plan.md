# synthetic 모델 표시 개선 계획

> Feature: synthetic-model-display
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

Model 컬럼에 표시되는 'synthetic' 값을 사용자 친화적인 방식으로 변경하여 혼란을 줄이고 정보 가독성을 높인다.

## 범위

- 포함:
  - `makeModelCell()` 함수 수정
  - 'synthetic' 값 처리 로직 추가
  - 적절한 시각적 표현(CSS) 적용
- 제외:
  - DB 스키마 변경
  - 서버 API 로직 변경
  - 'synthetic' 외 다른 모델 값 처리 변경

## 단계별 계획

### 1단계: UI 개선 방향 결정
- 'synthetic' 값의 의미 분석
- 표시 옵션별 장단점 비교
- 권장안 선정

### 2단계: 구현
- `renderers.js:makeModelCell()` 수정
- 필요시 CSS 변수 추가
- `screen-inventory.md` 업데이트

### 3단계: 검증
- 'synthetic' 값이 적절히 표시되는지 확인
- 기존 모델 값 표시에 영향 없는지 확인

## 완료 기준

- [ ] 'synthetic' 값이 사용자 친화적으로 표시됨
- [ ] 기존 모델 표시 로직에 회귀 없음
- [ ] CSS 변수만 사용 (하드코딩 색상 없음)
- [ ] `screen-inventory.md` 업데이트 완료
