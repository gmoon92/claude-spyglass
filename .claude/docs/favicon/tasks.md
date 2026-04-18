# Favicon 작업 목록

> 기반 문서: plan.md, adr.md
> 작성일: 2026-04-18
> 총 태스크: 7개

---

## 태스크 목록

| ID | 태스크 | 예상 시간 | 선행 태스크 | 커밋 타입 |
|----|--------|----------|------------|----------|
| T-01 | V1 초안: 렌즈+손잡이 돋보기 + `<link>` 삽입 | 30m | - | feat |
| T-02 | V1 적용 확인 및 검토 기록 | 10m | T-01 | docs |
| T-03 | V2 개선: 조준경(reticle) 형태로 재설계 | 30m | T-02 | feat |
| T-04 | V2 적용 확인 및 검토 기록 | 10m | T-03 | docs |
| T-05 | V3 최종: prefers-color-scheme + 비율 정제 | 30m | T-04 | feat |
| T-06 | V3 적용 확인 및 검토 기록 | 10m | T-05 | docs |
| T-07 | 이터레이션 이력 파일 정리 (v1~v3 보존) | 10m | T-06 | chore |

---

## T-01: V1 초안 — 렌즈+손잡이 돋보기 스타일

**선행 조건**: 없음

### 작업 내용
`packages/web/favicon-v1.svg` 생성 및 `favicon.svg`로 복사. `index.html` `<head>` 최상단에 `<link>` 추가.

### 구현 범위
- `packages/web/favicon-v1.svg`: 렌즈 원(cx=13,cy=13,r=7.5) + 손잡이 대각선
- `packages/web/favicon.svg`: v1과 동일 내용
- `packages/web/index.html`: `<link rel="icon">` 삽입

### 커밋 메시지
```
feat(web): favicon v1 초안 — 렌즈+손잡이 돋보기 스타일
```

### 검증 명령어
```bash
grep 'favicon' packages/web/index.html
ls packages/web/favicon*.svg
```

### 완료 기준
- [ ] favicon.svg 파일 존재
- [ ] index.html에 `<link rel="icon">` 태그 삽입됨
- [ ] 브라우저 탭에서 아이콘 표시 확인

---

## T-02: V1 검토 기록

**선행 조건**: T-01 완료

### 작업 내용
V1 디자인의 장단점을 `review.md`에 기록.

### 커밋 메시지
```
docs(web): favicon v1 검토 기록
```

---

## T-03: V2 개선 — 조준경(Reticle) 형태

**선행 조건**: T-02 완료

### 작업 내용
`favicon-v2.svg` 생성: 외곽 링 + 크로스헤어(중앙 공백 분리) + 중앙 점. 16px 가독성 극대화.

### 구현 범위
- `packages/web/favicon-v2.svg`: reticle 형태
- `packages/web/favicon.svg`: v2 내용으로 갱신
- `packages/web/index.html`: `href="favicon.svg?v=2"` 캐시 버스팅

### 커밋 메시지
```
feat(web): favicon v2 개선 — 조준경(reticle) 형태
```

### 완료 기준
- [ ] favicon-v2.svg 생성
- [ ] 외곽 링 + 크로스헤어 + 중앙점 구조
- [ ] 브라우저 탭 확인

---

## T-04: V2 검토 기록

**선행 조건**: T-03 완료

### 커밋 메시지
```
docs(web): favicon v2 검토 기록
```

---

## T-05: V3 최종 — prefers-color-scheme + 비율 정제

**선행 조건**: T-04 완료

### 작업 내용
`favicon-v3.svg` 생성: V2 기반에 `@media (prefers-color-scheme: light)` 추가. 둥근 사각(rx=6) 배경, 라이트 모드 대응, 비율 최적화.

### 구현 범위
- `packages/web/favicon-v3.svg`: 최종 버전
- `packages/web/favicon.svg`: v3으로 갱신
- `packages/web/index.html`: `href="favicon.svg?v=3"` 업데이트

### 커밋 메시지
```
feat(web): favicon v3 최종 — prefers-color-scheme + 비율 정제
```

### 완료 기준
- [ ] SVG 내 `@media (prefers-color-scheme: light)` 포함
- [ ] `<title>Claude Spyglass</title>` 포함
- [ ] 다크/라이트 모드 양쪽 확인

---

## T-06: V3 최종 검토

**선행 조건**: T-05 완료

### 커밋 메시지
```
docs(web): favicon v3 최종 검토 기록
```

---

## T-07: 이터레이션 이력 파일 정리

**선행 조건**: T-06 완료

### 작업 내용
favicon-v1~v3.svg 이력 파일을 `.claude/docs/favicon/` 디렉토리로 이동하여 `packages/web/`에는 `favicon.svg`만 남김.

### 커밋 메시지
```
chore(web): favicon 이터레이션 이력 정리
```
