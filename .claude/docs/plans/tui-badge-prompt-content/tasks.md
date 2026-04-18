# TUI 뱃지 및 프롬프트 내용 표시 개선 - 작업 목록

## 개요

ADR-010에 기반한 구현 작업 목록입니다. 각 태스크는 하나의 커밋으로 분리됩니다.

---

## 태스크 목록

### Phase 1: Formatter 클래스 구현

#### T-01: RequestTypeFormatter 클래스 생성
- **설명**: 타입 뱃지 색상/레이블 포맷터 클래스 구현
- **파일**: `packages/tui/src/formatters/RequestTypeFormatter.ts`
- **내용**:
  - `RequestType` union type 정의 ('prompt' | 'tool_call' | 'system')
  - `TYPE_CONFIG` const assertion으로 중앙화
  - 정적 메서드: getLabel(), getColor(), getDescription(), formatBadge(), getAllTypes()
- **검증**: 클래스가 정상 export되고 메서드가 올바른 값 반환
- **커밋**: `feat(tui): RequestTypeFormatter 클래스 추가`

#### T-02: TokenFormatter 클래스 생성
- **설명**: 토큰 수량 포맷팅 유틸리티
- **파일**: `packages/tui/src/formatters/TokenFormatter.ts`
- **내용**:
  - static format(tokens: number): string (1K, 1M 단위)
  - 중복된 formatTokens 함수들 대체
- **검증**: 1000 -> '1K', 1000000 -> '1M' 변환 확인
- **커밋**: `feat(tui): TokenFormatter 클래스 추가`

#### T-03: TimeFormatter 클래스 생성
- **설명**: 시간/날짜 포맷팅 유틸리티
- **파일**: `packages/tui/src/formatters/TimeFormatter.ts`
- **내용**:
  - static formatDate(timestamp: number): string
  - static formatTime(timestamp: number): string
  - static formatDuration(startedAt: number, endedAt?: number): string
- **검증**: 각 포맷팅 함수가 일관된 형식 반환
- **커밋**: `feat(tui): TimeFormatter 클래스 추가`

#### T-04: formatters index.ts 생성
- **설명**: 통합 export 파일
- **파일**: `packages/tui/src/formatters/index.ts`
- **내용**:
  - export { RequestTypeFormatter } from './RequestTypeFormatter'
  - export { TokenFormatter } from './TokenFormatter'
  - export { TimeFormatter } from './TimeFormatter'
- **검증**: 모든 클래스가 정상 export
- **커밋**: `feat(tui): formatters 통합 export 추가`

### Phase 2: 컴포넌트 리팩토링

#### T-05: LiveTab 리팩토링
- **설명**: 중복 로직 제거 및 Formatter 사용
- **파일**: `packages/tui/src/components/LiveTab.tsx`
- **내용**:
  - 기존 formatType(), typeColor(), formatTokens() 함수 제거
  - RequestTypeFormatter.getLabel(), getColor() 적용
  - TokenFormatter.format() 적용
- **검증**: LiveTab이 정상 렌더링되고 뱃지가 올바르게 표시
- **커밋**: `refactor(tui): LiveTab에 Formatter 클래스 적용`

#### T-06: HistoryTab 리팩토링
- **설명**: 중복 로직 제거 및 Formatter 사용
- **파일**: `packages/tui/src/components/HistoryTab.tsx`
- **내용**:
  - 기존 typeColor(), typeLabel(), formatDate(), formatTime(), formatDuration(), formatTokens() 제거
  - RequestTypeFormatter, TimeFormatter, TokenFormatter 적용
- **검증**: HistoryTab 정상 동작, 세션/요청 목록 정상 표시
- **커밋**: `refactor(tui): HistoryTab에 Formatter 클래스 적용`

#### T-07: RequestList 리팩토링
- **설명**: 중복 로직 제거 및 Formatter 사용
- **파일**: `packages/tui/src/components/RequestList.tsx`
- **내용**:
  - 기존 getTypeColor(), getTypeLabel(), formatTokens() 제거
  - RequestTypeFormatter, TokenFormatter 적용
- **검증**: RequestList 정상 렌더링
- **커밋**: `refactor(tui): RequestList에 Formatter 클래스 적용`

#### T-08: AnalysisTab 리팩토링
- **설명**: 중복 로직 제거 및 Formatter 사용
- **파일**: `packages/tui/src/components/AnalysisTab.tsx`
- **내용**:
  - 기존 formatTokens(), getTypeColor() 제거
  - RequestTypeFormatter, TokenFormatter 적용
- **검증**: AnalysisTab 통계 데이터 정상 표시
- **커밋**: `refactor(tui): AnalysisTab에 Formatter 클래스 적용`

### Phase 3: 프롬프트 내용 표시 (P1 — Phase 1·2 완료 후 별도 진행)

#### T-09: Request 스키마에 preview 필드 추가
- **설명**: 데이터 모델 확장
- **파일**: `packages/storage/src/schema.ts`
- **내용**:
  - Request 인터페이스에 `preview?: string` 필드 추가
- **검증**: 타입 정상 컴파일
- **커밋**: `feat(storage): Request에 preview 필드 추가`

#### T-10: collect 로직에 preview 생성 추가
- **설명**: 데이터 수집 시 preview 생성
- **파일**: `packages/server/src/collect.ts`, `hooks/spyglass-collect.sh`
- **내용**:
  - 프롬프트 내용 100자로 축약하여 preview 필드에 저장
- **검증**: 수집된 데이터에 preview 포함 확인
- **커밋**: `feat(collect): 프롬프트 preview 생성 로직 추가`

#### T-11: LiveTab에 preview 표시
- **설명**: 실시간 요청에 프롬프트 내용 표시
- **파일**: `packages/tui/src/components/LiveTab.tsx`
- **내용**:
  - Recent Requests 영역에 preview 2줄 표시
  - Box height={2}로 확장
- **검증**: 프롬프트 내용이 tool_name 아래에 표시됨
- **커밋**: `feat(tui): LiveTab에 프롬프트 preview 표시`

#### T-12: HistoryTab에 description 컬럼 추가
- **설명**: 상세 뷰에 description 컬럼 추가
- **파일**: `packages/tui/src/components/HistoryTab.tsx`
- **내용**:
  - 상세 요청 목록에 Description 컬럼 추가
  - 너비 재조정
- **검증**: 프롬프트 내용이 Description 컬럼에 표시됨
- **커밋**: `feat(tui): HistoryTab에 description 컬럼 추가`

---

## 의존성 그래프

```
T-01 ─┬── T-05
      ├── T-06
      ├── T-07
      └── T-08

T-02 ─┬── T-05
      ├── T-06
      ├── T-07
      └── T-08

T-03 ──── T-06

T-01, T-02, T-03 ──── T-04

T-09 ──── T-10 ──── T-11
              └──── T-12
```

---

## 완료 기준

- [x] T-01 ~ T-08: Formatter 클래스 적용 완료
- [x] T-09 ~ T-12: 프롬프트 내용 표시 완료
- [x] 모든 중복 로직 제거
- [x] 기존 컴포넌트 정상 동작
