# TUI 뱃지 및 프롬프트 내용 표시 개선

## 1. 개요

### 1.1 배경
현재 spyglass TUI에는 여러 컴포넌트(LiveTab, HistoryTab, RequestList, AnalysisTab)에 타입 뱃지('P'/'T'/'S') 표시 로직이 중복되어 있습니다. 또한 사용자가 어떤 프롬프트를 입력했는지 내용이 표시되지 않아 사용성이 제한적입니다.

### 1.2 목표
- 중복된 타입 뱃지/색상/포맷팅 로직을 클래스 기반으로 모듈화
- 사용자 프롬프트 내용을 함께 표시하는 기능 추가
- Java 개발자가 익숙한 클래스/모듈 패턴 적용

### 1.3 대상 사용자
- Java 개발자 관점에서 TypeScript/React 프로젝트 구조 개선

## 2. 현재 문제점

### 2.1 중복 로직
```typescript
// LiveTab.tsx:36-47
function formatType(type: string): string {
  if (type === 'prompt') return 'P';
  if (type === 'tool_call') return 'T';
  return type.slice(0, 1).toUpperCase();
}

function typeColor(type: string): string {
  if (type === 'prompt') return 'cyan';
  if (type === 'tool_call') return 'yellow';
  return 'gray';
}

// HistoryTab.tsx:62-72 (동일 로직 중복)
function typeColor(type: string): string { ... }
function typeLabel(type: string): string { ... }

// AnalysisTab.tsx:34-41 (또 중복)
function getTypeColor(type: string): string { ... }

// RequestList.tsx:36-46 (또 중복)
function getTypeColor(type: string): string { ... }
function getTypeLabel(type: string, toolName?: string): string { ... }
```

### 2.2 누락 기능
- 사용자 프롬프트 내용(preview/content) 미표시
- 요청별 상세 내용 확인 불가

## 3. 요구사항

### 3.1 기능 요구사항
| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| R1 | 타입 뱃지 로직을 클래스로 모듈화 | P0 |
| R2 | 사용자 프롬프트 내용 표시 | P0 |
| R3 | 포맷팅 유틸리티 통합 | P1 |

### 3.2 기술 요구사항
- 클래스 기반 설계 (Java 개발자 친화적)
- 단일 책임 원칙 (SRP)
- 확장 가능한 구조 (새로운 타입 추가 용이)

## 4. 참고 파일

- packages/tui/src/components/LiveTab.tsx
- packages/tui/src/components/HistoryTab.tsx
- packages/tui/src/components/RequestList.tsx
- packages/tui/src/components/AnalysisTab.tsx
- packages/storage/src/schema.ts

## 5. 제약사항

- 개발은 문서 작성 후 별도 진행
- 이 문서는 ADR 및 작업 분할을 위한 입력 자료
